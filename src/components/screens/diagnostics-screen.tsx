"use client";

import * as React from "react";
import Link from "next/link";
import type { KnxMbmSignal } from "@/gateway-families/knx-mbm/model";
import { formatGroupAddress } from "@/protocols/knx/address";
import { useCurrentProject } from "@/lib/current-project";
import {
  sendConsoleCommand,
  setGatewayMonitor,
  type GatewaySessionStatus,
} from "@/lib/gateway-api";
import { useGatewaySession } from "@/lib/gateway-session";
import {
  formatClock,
  formatConsoleStamp,
  formatFrameTime,
  formatRates,
  formatUptime,
  isFailureText,
  isTimeoutText,
  knxConsoleId,
  mbmConsoleId,
  parseKnxPush,
  parseMbmPush,
  parseMonitorLine,
  parseReadValue,
  rollingRates,
  type MonitorFrame,
  type MonitorProto,
} from "@/lib/diagnostics-parsing";
import { useSessionEvents } from "@/lib/use-session-events";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";

const TRAFFIC_LIMIT = 300;
const CONSOLE_LIMIT = 140;
const SV_MAX_SIGNALS = 60;
const SV_REFRESH_MAX = 20;
const SV_STORAGE_KEY = "maps.diagnostics.signalsOpen";
/** Signals column width: default fits the proposal (700 px, max 55%). */
const SV_MIN_WIDTH = 340;
const SV_MAX_WIDTH = 1180;
/** Console peer height (proposal: 320 px default, clamped 120–760). */
const CON_DEFAULT_HEIGHT = 320;
const CON_MIN_HEIGHT = 120;
const CON_MAX_HEIGHT = 760;

const CON_ECHO = "#1DC3EB";
const CON_ANSWER = "rgba(255,255,255,.86)";
const CON_SILENT = "rgba(255,255,255,.4)";
const CON_WARN = "#F0C674";
const CON_ERROR = "#FF9E91";
const CON_LOG = "rgba(255,255,255,.45)";

const PROTO_BADGE: Record<MonitorProto, string> = {
  KNX: "bg-[#3B2A08] text-[#E7B75A]",
  MODBUS: "bg-[rgba(29,195,235,.15)] text-[#1DC3EB]",
  SYS: "bg-[rgba(255,255,255,.2)] text-white",
};

const PROTO_DESC: Record<MonitorProto, string> = {
  KNX: "KNX TP1 telegram, standard frame",
  MODBUS: "Modbus Master ADU",
  SYS: "internal event",
};

const FILTER_TABS: { key: "all" | MonitorProto; label: string }[] = [
  { key: "all", label: "All" },
  { key: "KNX", label: "KNX" },
  { key: "MODBUS", label: "Modbus" },
  { key: "SYS", label: "System" },
];

const QUICK_COMMANDS = ["INFO?", "APPINFO?", "DIAGS?", "HARDINFO?"];

interface ConsoleLine {
  t: string;
  color: string;
  text: string;
}

interface SignalOp {
  ok: boolean;
  text: string;
  t: string;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Prototype MAPPING cell: `1/0/1 ⇄ s<deviceIndex>:<address>`. */
function signalMapping(signal: KnxMbmSignal): string {
  const ga = signal.knx.groupAddress > 0 ? formatGroupAddress(signal.knx.groupAddress) : "—";
  const device = signal.modbus.isBroadcast
    ? "BC"
    : signal.modbus.deviceIndex >= 0
      ? String(signal.modbus.deviceIndex)
      : "—";
  return `${ga} ⇄ s${device}:${signal.modbus.address}`;
}

/**
 * Live diagnostics: bus traffic monitor (SPONS/COMMS pushes over SSE), a
 * signals viewer with read/write cells against the current project, and the
 * free-text gateway console. Everything shown comes from the gateway — no
 * simulated traffic.
 */
export function DiagnosticsScreen() {
  const { session, loading } = useGatewaySession();

  if (loading) {
    return <p className="text-sm text-fg-muted">Checking gateway session…</p>;
  }

  if (!session) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Diagnostics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-fg-muted">
            No gateway session is open. Diagnostics shows live data only — bus traffic, signal
            values and the console — so it needs an active connection.
          </p>
          <p className="text-sm text-fg-muted">
            Connect from the{" "}
            <Link href="/connection" className="font-medium text-hms-accent hover:underline">
              Connection
            </Link>{" "}
            screen. Without a gateway you can keep working with the demo project.
          </p>
        </CardContent>
      </Card>
    );
  }

  return <LiveDiagnostics key={session.id} session={session} />;
}

function LiveDiagnostics({ session }: { session: GatewaySessionStatus }) {
  const { view } = useCurrentProject();
  const { log, monitor, status } = useSessionEvents(session.id);

  const liveStatus = status ?? session;
  const monitoring = liveStatus.connected && liveStatus.monitoring;

  /* ----- signals of the current project (knx-mbm only) ----- */
  const signals = view?.family === "knx-mbm" ? view.project.signals : null;
  const activeSignals = React.useMemo(() => signals?.filter((s) => s.active) ?? [], [signals]);
  const activeIndexById = React.useMemo(
    () => new Map(activeSignals.map((s, index) => [s.id, index])),
    [activeSignals],
  );
  const tableSignals = React.useMemo(
    () => (activeSignals.length > 0 ? activeSignals : (signals ?? [])).slice(0, SV_MAX_SIGNALS),
    [activeSignals, signals],
  );

  /* ----- monitor lifecycle: stream only while this screen is open ----- */
  // Firmware debug lines (DEBUG=1) are opt-in, like the MAPS "Debug" checkbox.
  const [debug, setDebug] = React.useState(false);
  const debugRef = React.useRef(debug);
  React.useEffect(() => {
    if (!session.connected) return;
    setGatewayMonitor(session.id, true, debugRef.current).catch(() => {});
    return () => {
      setGatewayMonitor(session.id, false).catch(() => {});
    };
  }, [session.id, session.connected]);

  function toggleDebug() {
    const next = !debug;
    setDebug(next);
    debugRef.current = next;
    // Re-enabling re-applies the toggles (setMonitor disables first).
    if (session.connected) setGatewayMonitor(session.id, true, next).catch(() => {});
  }

  /* ----- traffic buffer (own copy so Clear/Pause are local) ----- */
  const [frames, setFrames] = React.useState<MonitorFrame[]>([]);
  const lastMonitorRef = React.useRef<(typeof monitor)[number] | null>(null);
  React.useEffect(() => {
    if (monitor.length === 0) {
      if (lastMonitorRef.current !== null) {
        lastMonitorRef.current = null;
        setFrames([]);
      }
      return;
    }
    const last = lastMonitorRef.current;
    const idx = last === null ? -1 : monitor.lastIndexOf(last);
    // Session switched or the capped SSE window slid past what we consumed.
    const resync = last !== null && idx === -1;
    const fresh = resync ? monitor : monitor.slice(idx + 1);
    if (fresh.length === 0) return;
    lastMonitorRef.current = monitor[monitor.length - 1];
    setFrames((prev) => {
      const base = resync ? [] : prev;
      const start = base.length > 0 ? base[base.length - 1].i + 1 : 0;
      const appended = fresh.map((entry, k) =>
        parseMonitorLine(entry.line, start + k, entry.at),
      );
      return [...base, ...appended].slice(-TRAFFIC_LIMIT);
    });
  }, [monitor]);

  /* ----- toolbar state ----- */
  const [paused, setPaused] = React.useState(false);
  const [pausedFrames, setPausedFrames] = React.useState<MonitorFrame[] | null>(null);
  const [autoScroll, setAutoScroll] = React.useState(true);
  const [holdCount, setHoldCount] = React.useState<number | null>(null);
  const [showTs, setShowTs] = React.useState(true);
  const [filter, setFilter] = React.useState<"all" | MonitorProto>("all");
  const [query, setQuery] = React.useState("");
  const [openIdx, setOpenIdx] = React.useState<number | null>(null);
  const [resetOpen, setResetOpen] = React.useState(false);

  const source = pausedFrames ?? frames;
  const heldCount = holdCount !== null ? Math.max(0, source.length - holdCount) : 0;
  const heldSource = holdCount !== null ? source.slice(0, holdCount) : source;
  const needle = query.trim().toLowerCase();
  const visibleFrames = heldSource.filter(
    (frame) =>
      (filter === "all" || frame.proto === filter) &&
      (!needle || (frame.dec + frame.frame + frame.obj).toLowerCase().includes(needle)),
  );
  // Newest frames at the bottom (console convention; AutoScroll pins it).
  const renderedFrames = visibleFrames;

  const trafficScrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (autoScroll && trafficScrollRef.current) {
      trafficScrollRef.current.scrollTop = trafficScrollRef.current.scrollHeight;
    }
  }, [autoScroll, renderedFrames.length]);

  function togglePause() {
    if (paused) {
      setPaused(false);
      setPausedFrames(null);
    } else {
      setPausedFrames(frames);
      setPaused(true);
    }
  }

  function toggleAutoScroll() {
    if (autoScroll) {
      setAutoScroll(false);
      setHoldCount(source.length);
    } else {
      setAutoScroll(true);
      setHoldCount(null);
    }
  }

  function clearTraffic() {
    setFrames([]);
    setPausedFrames(null);
    setHoldCount(null);
    setOpenIdx(null);
  }

  /* ----- 1 s tick for rates / uptime ----- */
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  React.useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const rates = rollingRates(frames, nowMs);
  const timeoutCount = React.useMemo(
    () => frames.filter((frame) => isTimeoutText(frame.dec)).length,
    [frames],
  );

  /* ----- live signal values from the stream ----- */
  const streamValues = React.useMemo(() => {
    const values = new Map<string, string>();
    if (!signals) return values;
    const byKnxObject = new Map(
      signals.map((s) => [`${s.id + 1}:${s.knx.groupAddress}`, s] as const),
    );
    const byObjIdx = new Map(signals.map((s) => [s.id + 1, s] as const));
    for (const frame of frames) {
      const knx = parseKnxPush(frame.dec);
      if (knx) {
        const signal =
          byKnxObject.get(`${knx.objIdx}:${knx.groupAddress}`) ?? byObjIdx.get(knx.objIdx);
        if (signal) values.set(`${signal.id}|knx`, knx.value);
        continue;
      }
      const mbm = parseMbmPush(frame.dec);
      if (mbm) {
        // Best-effort (docs/reference/console-protocol.md §2): the MBM extId is
        // the index among active signals in config order.
        const signal = activeSignals[mbm.extId];
        if (signal) values.set(`${signal.id}|mb`, mbm.value);
      }
    }
    return values;
  }, [frames, signals, activeSignals]);

  // Values confirmed by console reads/writes override the stream snapshot.
  const [valueOverrides, setValueOverrides] = React.useState<Record<string, string>>({});
  const liveValue = React.useCallback(
    (signalId: number, side: "knx" | "mb") =>
      valueOverrides[`${signalId}|${side}`] ?? streamValues.get(`${signalId}|${side}`),
    [valueOverrides, streamValues],
  );

  /* ----- console ----- */
  const [conOpen, setConOpen] = React.useState(false);
  const [conInput, setConInput] = React.useState("");
  const [conLines, setConLines] = React.useState<ConsoleLine[]>([]);
  const conLogRef = React.useRef<HTMLDivElement>(null);

  const echo = React.useCallback((color: string, text: string) => {
    const line: ConsoleLine = { t: formatConsoleStamp(new Date()), color, text };
    setConLines((prev) => [...prev, line].slice(-CONSOLE_LIMIT));
  }, []);

  // Mirror the session transfer/connection log as gray `# …` lines.
  const lastLogRef = React.useRef<(typeof log)[number] | null>(null);
  React.useEffect(() => {
    if (log.length === 0) {
      lastLogRef.current = null;
      return;
    }
    const last = lastLogRef.current;
    const idx = last === null ? -1 : log.lastIndexOf(last);
    const fresh = last !== null && idx === -1 ? log : log.slice(idx + 1);
    if (fresh.length === 0) return;
    lastLogRef.current = log[log.length - 1];
    // The session keepalive tick is log noise, not console content.
    const visible = fresh.filter((entry) => entry.line !== "keepalive");
    if (visible.length === 0) return;
    setConLines((prev) =>
      [
        ...prev,
        ...visible.map((entry) => ({
          t: `[${formatFrameTime(entry.at)}]`,
          color: CON_LOG,
          text: `# ${entry.line}`,
        })),
      ].slice(-CONSOLE_LIMIT),
    );
  }, [log]);

  React.useEffect(() => {
    if (conOpen && conLogRef.current) {
      conLogRef.current.scrollTop = conLogRef.current.scrollHeight;
    }
  }, [conOpen, conLines.length]);

  const runConsoleCommand = React.useCallback(
    async (raw: string) => {
      const cmd = raw.trim();
      if (!cmd) return;
      setConInput("");
      setConOpen(true);
      // MAPS convention: `<` sent, `>` received (frmMain.cs:3281, 3416).
      echo(CON_ECHO, `< ${cmd}`);
      try {
        const result = await sendConsoleCommand(session.id, cmd);
        if (result.lines.length === 0) {
          echo(CON_SILENT, "> (no answer — this firmware ignores unknown commands)");
        } else {
          for (const answer of result.lines) echo(CON_ANSWER, `> ${answer}`);
        }
        if (result.timedOut) {
          echo(CON_WARN, "> (answer may be incomplete — timed out waiting for it to settle)");
        }
      } catch (err) {
        echo(CON_ERROR, `> ${errorMessage(err, "Command failed")}`);
      }
    },
    [echo, session.id],
  );

  /* ----- signals viewer (right column) ----- */
  const [svWidth, setSvWidth] = React.useState<number | null>(null);
  const [svFilter, setSvFilter] = React.useState("");
  const [showMapping, setShowMapping] = React.useState(true);
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [opStats, setOpStats] = React.useState<Record<number, SignalOp>>({});
  const [refreshing, setRefreshing] = React.useState(false);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const columnRef = React.useRef<HTMLDivElement>(null);

  /* ----- console peer height ----- */
  const [conHeight, setConHeight] = React.useState(CON_DEFAULT_HEIGHT);

  function onConPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startY = event.clientY;
    const start = conHeight;
    const colH = columnRef.current?.getBoundingClientRect().height ?? 600;
    const max = Math.min(CON_MAX_HEIGHT, Math.max(CON_MIN_HEIGHT, Math.round(colH * 0.62)));
    const onMove = (ev: PointerEvent) => {
      setConHeight(Math.max(CON_MIN_HEIGHT, Math.min(max, start + (startY - ev.clientY))));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function onSvPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const start =
      svWidth ??
      Math.min(700, Math.round((bodyRef.current?.getBoundingClientRect().width ?? 1200) * 0.55));
    const bodyW = bodyRef.current?.getBoundingClientRect().width ?? 1200;
    const max = Math.min(SV_MAX_WIDTH, Math.round(bodyW * 0.55));
    const onMove = (ev: PointerEvent) => {
      setSvWidth(Math.max(SV_MIN_WIDTH, Math.min(max, start + (startX - ev.clientX))));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  async function writeSignal(signal: KnxMbmSignal, side: "knx" | "mb", value: string) {
    const command =
      side === "knx"
        ? `0KX:${knxConsoleId(signal.id + 1, signal.knx.groupAddress)}=${value}`
        : `1MM:${mbmConsoleId(activeIndexById.get(signal.id) ?? signal.id)}=${value};`;
    try {
      const result = await sendConsoleCommand(session.id, command);
      const answer = result.lines.map((line) => line.trim()).find((line) => line !== "") ?? "";
      const ok = /(^|:)OK$/i.test(answer);
      setOpStats((prev) => ({
        ...prev,
        [signal.id]: {
          ok,
          text: answer || "no answer — signal unknown or the gateway stayed silent",
          t: formatClock(new Date()),
        },
      }));
      if (ok) {
        setValueOverrides((prev) => ({ ...prev, [`${signal.id}|${side}`]: value }));
      }
    } catch (err) {
      setOpStats((prev) => ({
        ...prev,
        [signal.id]: {
          ok: false,
          text: errorMessage(err, "Write failed"),
          t: formatClock(new Date()),
        },
      }));
    }
  }

  function onValueKey(
    event: React.KeyboardEvent<HTMLInputElement>,
    signal: KnxMbmSignal,
    side: "knx" | "mb",
  ) {
    if (event.key !== "Enter") return;
    const key = `${signal.id}|${side}`;
    const value = (drafts[key] ?? "").trim();
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (value) void writeSignal(signal, side, value);
  }

  async function refreshSignalValues() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      for (const signal of tableSignals.slice(0, SV_REFRESH_MAX)) {
        const knxResult = await sendConsoleCommand(
          session.id,
          `0KX:${knxConsoleId(signal.id + 1, signal.knx.groupAddress)}?`,
        ).catch(() => null);
        const knxValue = knxResult?.lines.map(parseReadValue).find((v) => v !== null);
        const activeIndex = activeIndexById.get(signal.id);
        let mbValue: string | null | undefined;
        if (activeIndex !== undefined) {
          const mbResult = await sendConsoleCommand(
            session.id,
            `1MM:${mbmConsoleId(activeIndex)}?`,
          ).catch(() => null);
          mbValue = mbResult?.lines.map(parseReadValue).find((v) => v !== null);
        }
        setValueOverrides((prev) => {
          const next = { ...prev };
          if (knxValue) next[`${signal.id}|knx`] = knxValue;
          if (mbValue) next[`${signal.id}|mb`] = mbValue;
          return next;
        });
      }
    } finally {
      setRefreshing(false);
    }
  }

  /* ----- signals column (right) open state ----- */
  const [svOpen, setSvOpen] = React.useState(true);
  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SV_STORAGE_KEY);
      if (stored === "0") setSvOpen(false);
      // Below ~1400 px the column squeezes the monitor: start collapsed unless
      // the user explicitly opened it before.
      else if (stored === null && window.innerWidth < 1400) setSvOpen(false);
    } catch {
      // localStorage unavailable — keep the default.
    }
  }, []);
  function toggleSv() {
    setSvOpen((open) => {
      const next = !open;
      try {
        window.localStorage.setItem(SV_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Non-fatal.
      }
      return next;
    });
  }

  const svNeedle = svFilter.trim().toLowerCase();
  const shownSignals = svNeedle
    ? tableSignals.filter((s) =>
        `${s.description} ${signalMapping(s)}`.toLowerCase().includes(svNeedle),
      )
    : tableSignals;

  const streamState = paused ? "paused" : monitoring ? "live" : "monitor off";
  const familyLine =
    view?.family === "knx-mbm"
      ? "BMS protocol KNX · Device protocol Modbus Master"
      : view?.family === "me-mbs"
        ? "BMS protocol Modbus · Device protocol ME-AC"
        : null;

  return (
    <div className="flex h-full min-h-[540px] flex-col">
      {/* ---------- toolbar ---------- */}
      <div className="flex shrink-0 flex-wrap items-center gap-[9px] border-b border-border bg-white px-[18px] py-[9px]">
        <button
          type="button"
          onClick={togglePause}
          className={cn(
            "cursor-pointer rounded-[4px] border px-[13px] py-[7px] text-[12.5px] font-bold",
            paused
              ? "border-hms-accent bg-hms-accent text-white"
              : "border-border bg-white text-hms-blue",
          )}
        >
          {paused ? "Resume stream" : "Pause"}
        </button>
        <button
          type="button"
          onClick={clearTraffic}
          className="cursor-pointer rounded-[4px] border border-border px-[11px] py-[7px] text-[12.5px] font-bold text-hms-blue hover:border-hms-accent"
        >
          Clear
        </button>
        <ChipButton on={autoScroll} onClick={toggleAutoScroll}>
          AutoScroll
        </ChipButton>
        <ChipButton on={showTs} onClick={() => setShowTs((v) => !v)}>
          Time stamp
        </ChipButton>
        <ChipButton
          on={debug}
          onClick={toggleDebug}
          title="Firmware debug lines: bus timeouts, plus internal traces"
        >
          Debug
        </ChipButton>
        <div className="h-[22px] w-px bg-border" />
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={cn(
              "cursor-pointer rounded-[4px] px-[10px] py-[6px] text-[12.5px]",
              filter === tab.key
                ? "bg-info-bg font-bold text-hms-blue"
                : "font-normal text-fg-muted",
            )}
          >
            {tab.label}
          </button>
        ))}
        <Input
          search
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter frames (text or regex)"
          aria-label="Filter frames"
          className="ml-[6px] w-[210px]"
        />
        <div className="flex-1" />
        <button
          type="button"
          onClick={toggleSv}
          className={cn(
            "cursor-pointer whitespace-nowrap rounded-[4px] border px-[11px] py-[7px] text-[12.5px] font-bold",
            svOpen
              ? "border-hms-accent bg-info-bg text-hms-accent"
              : "border-border bg-white text-hms-blue",
          )}
        >
          Signals viewer
        </button>
        <button
          type="button"
          onClick={() => setResetOpen(true)}
          className="cursor-pointer rounded-[4px] border border-error-border px-[11px] py-[7px] text-[12.5px] font-bold text-error hover:bg-error-bg"
        >
          Reset gateway
        </button>
      </div>

      {/* ---------- body: left column + signals viewer column ---------- */}
      <div ref={bodyRef} className="flex min-h-0 flex-1">
        <div ref={columnRef} className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* traffic monitor */}
          <div className="flex min-h-[160px] flex-1 flex-col bg-[#0B2233]">
            <div ref={trafficScrollRef} className="flex-1 overflow-auto pb-5">
              <div className="sticky top-0 z-[2] flex min-w-[640px] bg-[#122B3B] px-[14px] py-[6px] font-mono text-[10px] font-semibold tracking-[.08em] text-[rgba(255,255,255,.45)]">
                {showTs && <div className="w-[88px] shrink-0">TIME</div>}
                <div className="w-[74px] shrink-0">SOURCE</div>
                <div className="w-[46px] shrink-0">DIR</div>
                <div className="w-[150px] shrink-0">FRAME</div>
                <div className="min-w-[260px] flex-1">DECODED</div>
                <div className="w-[96px] shrink-0">OBJECT</div>
              </div>
              {renderedFrames.length === 0 && (
                <div className="px-[14px] py-6 font-mono text-[11.5px] leading-[1.7] text-[rgba(255,255,255,.3)]">
                  {frames.length === 0
                    ? "No frames yet — the monitor streams when the gateway pushes data."
                    : "No frames match the current filter."}
                </div>
              )}
              {renderedFrames.map((frame) => {
                const open = openIdx === frame.i;
                const failed = isFailureText(frame.dec);
                return (
                  <div key={frame.i}>
                    <button
                      type="button"
                      onClick={() => setOpenIdx(open ? null : frame.i)}
                      className={cn(
                        "flex w-full min-w-[640px] cursor-pointer items-start px-[14px] py-[4px] text-left font-mono text-[11.5px]",
                        open && "bg-[rgba(29,195,235,.10)]",
                      )}
                    >
                      {showTs && (
                        <div className="w-[88px] shrink-0 text-[rgba(255,255,255,.42)]">
                          {formatFrameTime(frame.at)}
                        </div>
                      )}
                      <div className="w-[74px] shrink-0">
                        <span
                          className={cn(
                            "rounded-[2px] px-[5px] py-[1px] font-mono text-[9.5px] font-semibold",
                            PROTO_BADGE[frame.proto],
                          )}
                        >
                          {frame.proto}
                        </span>
                      </div>
                      <div
                        className={cn(
                          "w-[46px] shrink-0",
                          frame.dir === "TX"
                            ? "text-[#F0C674]"
                            : frame.dir === "RX"
                              ? "text-[#7FD8B0]"
                              : "text-[rgba(255,255,255,.35)]",
                        )}
                      >
                        {frame.dir}
                      </div>
                      <div
                        title={frame.frame}
                        className="w-[150px] shrink-0 truncate pr-[8px] text-[rgba(255,255,255,.6)]"
                      >
                        {frame.frame || "—"}
                      </div>
                      <div
                        title={frame.dec}
                        className={cn(
                          "min-w-[260px] flex-1 whitespace-normal break-words leading-[1.5]",
                          failed ? "text-[#FF9E91]" : "text-[rgba(255,255,255,.9)]",
                        )}
                      >
                        {frame.dec}
                      </div>
                      <div className="w-[96px] shrink-0 text-[#1DC3EB]">{frame.obj}</div>
                    </button>
                    {open && (
                      <div className="border-l-2 border-[#1DC3EB] bg-[rgba(255,255,255,.04)] px-[14px] pb-[12px] pl-[24px] pt-[10px] font-mono text-[11.5px] leading-[1.7] text-[rgba(255,255,255,.7)]">
                        <div>Raw frame {frame.frame || "—"}</div>
                        <div>
                          Protocol {frame.proto} · {PROTO_DESC[frame.proto]}
                        </div>
                        <div className="whitespace-normal break-words">
                          Interpretation {frame.dec}
                        </div>
                        <div>Object {frame.obj || "—"}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex shrink-0 gap-4 bg-[rgba(255,255,255,.05)] px-[14px] py-[6px] font-mono text-[11px] text-[rgba(255,255,255,.5)]">
              <span>{frames.length} frames</span>
              <span>{formatRates(rates)}</span>
              {heldCount > 0 && (
                <span className="text-[#F0C674]">
                  AutoScroll off · {heldCount} new frames held
                </span>
              )}
              {timeoutCount > 0 && (
                <span className="text-[#FF9E91]">{timeoutCount} timeouts</span>
              )}
              <div className="flex-1" />
              <span>{streamState}</span>
            </div>
          </div>

          {/* console — peer of the monitor, resizable */}
          {conOpen && (
            <div
              style={{ height: conHeight }}
              className="flex min-h-0 shrink-0 flex-col border-t-2 border-[#06161F] bg-[#0B2233]"
            >
              <div
                onPointerDown={onConPointerDown}
                title="Drag to resize the console"
                className="flex h-[8px] shrink-0 cursor-row-resize items-center justify-center bg-border-strong hover:bg-hms-accent"
              >
                <div className="h-[2px] w-[34px] rounded-[2px] bg-[rgba(255,255,255,.6)]" />
              </div>
              <div className="flex shrink-0 items-center gap-3 bg-[rgba(255,255,255,.05)] px-[14px] py-[6px]">
                <span className="whitespace-nowrap font-mono text-[10px] font-semibold tracking-[.08em] text-[rgba(255,255,255,.45)]">
                  CONSOLE
                </span>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-[rgba(255,255,255,.34)]">
                  commands you send to the gateway and its answers — not bus traffic
                </span>
                <div className="flex-1" />
                {QUICK_COMMANDS.map((cmd) => (
                  <button
                    key={cmd}
                    type="button"
                    onClick={() => void runConsoleCommand(cmd)}
                    className="cursor-pointer whitespace-nowrap font-mono text-[11px] text-[#1DC3EB]"
                  >
                    {cmd}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setConLines([])}
                  className="cursor-pointer font-mono text-[11px] text-[rgba(255,255,255,.42)]"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setConOpen(false)}
                  aria-label="Close console"
                  className="cursor-pointer px-[2px] text-[15px] leading-none text-[rgba(255,255,255,.42)]"
                >
                  ×
                </button>
              </div>
              <div ref={conLogRef} className="min-h-0 flex-1 overflow-auto px-[14px] py-[8px]">
                {conLines.length === 0 && (
                  <div className="font-mono text-[11.5px] leading-[1.7] text-[rgba(255,255,255,.3)]">
                    No commands sent yet — try INFO? to ask the gateway who it is.
                  </div>
                )}
                {conLines.map((line, index) => (
                  <div key={index} className="flex gap-[8px] font-mono text-[11.5px] leading-[1.7]">
                    <span className="whitespace-nowrap text-[rgba(255,255,255,.28)]">
                      {showTs ? line.t : ""}
                    </span>
                    <span className="min-w-0 flex-1 whitespace-pre-wrap" style={{ color: line.color }}>
                      {line.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* console input bar — always visible */}
          <div
            className={cn(
              "flex shrink-0 items-center gap-[9px] bg-[#0B2233] px-[14px] py-[7px]",
              conOpen ? "border-t border-[rgba(255,255,255,.08)]" : "border-t-2 border-[#06161F]",
            )}
          >
            <button
              type="button"
              onClick={() => setConOpen((v) => !v)}
              className="cursor-pointer whitespace-nowrap font-mono text-[10px] font-semibold tracking-[.08em] text-[rgba(255,255,255,.45)]"
            >
              {conOpen ? "CONSOLE ▾" : "CONSOLE ▸"}
            </button>
            <span className="font-mono text-[12px] font-semibold text-[#1DC3EB]">&gt;</span>
            <input
              value={conInput}
              onChange={(event) => setConInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void runConsoleCommand(conInput);
              }}
              placeholder="Type a gateway command and press Enter — INFO?"
              aria-label="Gateway console command"
              className="min-w-0 flex-1 rounded-[4px] border border-[rgba(255,255,255,.14)] bg-[rgba(255,255,255,.06)] px-[9px] py-[6px] font-mono text-[11.5px] text-white placeholder:text-[rgba(255,255,255,.35)]"
            />
            <button
              type="button"
              onClick={() => void runConsoleCommand(conInput)}
              className="cursor-pointer rounded-[4px] bg-hms-accent px-[15px] py-[6px] text-[12px] font-bold text-white hover:bg-hms-accent-hover"
            >
              Send
            </button>
          </div>
        </div>

        {/* signals viewer — right column, resizable */}
        {svOpen ? (
          <>
            <div
              onPointerDown={onSvPointerDown}
              title="Drag to resize the signals viewer"
              className="flex w-[8px] shrink-0 cursor-col-resize items-center justify-center bg-border-strong hover:bg-hms-accent"
            >
              <div className="h-[34px] w-[2px] rounded-[2px] bg-[rgba(255,255,255,.6)]" />
            </div>
            <div
              style={svWidth !== null ? { width: svWidth } : undefined}
              className={cn(
                "flex min-h-0 shrink-0 flex-col border-l border-border bg-white",
                svWidth === null && "w-[min(700px,55%)]",
              )}
            >
              <div className="flex shrink-0 items-center gap-[9px] border-b border-border px-[14px] py-[8px]">
                <span className="whitespace-nowrap font-display text-[14px] font-medium text-hms-blue">
                  Signals viewer
                </span>
                <span className="whitespace-nowrap text-[11.5px] text-fg-subtle">
                  {shownSignals.length} of {tableSignals.length} signals
                </span>
                <div className="flex-1" />
                <button
                  type="button"
                  aria-pressed={showMapping}
                  onClick={() => setShowMapping((v) => !v)}
                  className={cn(
                    "cursor-pointer whitespace-nowrap rounded-[4px] border px-[8px] py-[3px] text-[11px] font-bold",
                    showMapping
                      ? "border-hms-accent bg-info-bg text-hms-accent"
                      : "border-border bg-white text-fg-muted",
                  )}
                >
                  Mapping
                </button>
                <button
                  type="button"
                  onClick={() => void refreshSignalValues()}
                  disabled={refreshing || !signals}
                  className="cursor-pointer whitespace-nowrap text-[12px] font-bold text-hms-accent disabled:pointer-events-none disabled:opacity-50"
                >
                  {refreshing ? "Refreshing…" : "Refresh"}
                </button>
                <button
                  type="button"
                  onClick={toggleSv}
                  aria-label="Close signals viewer"
                  className="cursor-pointer px-[3px] text-[16px] leading-none text-fg-subtle"
                >
                  ×
                </button>
              </div>
              <div className="flex shrink-0 items-center gap-[9px] border-b border-border px-[14px] py-[7px]">
                <Input
                  search
                  size="sm"
                  value={svFilter}
                  onChange={(event) => setSvFilter(event.target.value)}
                  placeholder="Filter signals"
                  aria-label="Filter signals"
                  className="w-[190px] shrink-0"
                />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-fg-subtle">
                  type a value and press Enter to write from that side
                </span>
              </div>
              {signals === null ? (
                <p className="px-[14px] py-4 text-[12px] leading-[1.6] text-fg-muted">
                  No KNX ↔ Modbus Master project is open — open a project to read and write its
                  signals from here.
                </p>
              ) : tableSignals.length === 0 ? (
                <p className="px-[14px] py-4 text-[12px] leading-[1.6] text-fg-muted">
                  The current project has no signals.
                </p>
              ) : (
                <div className="min-h-0 flex-1 overflow-auto">
                  <div
                    className={cn(
                      "sticky top-0 z-[2] flex items-center border-b border-border bg-table-header px-[14px] py-[6px] font-mono text-[10.5px] font-semibold tracking-[.06em] text-fg-muted",
                      showMapping ? "min-w-[730px]" : "min-w-[600px]",
                    )}
                  >
                    <div className="w-[36px] shrink-0">#</div>
                    <div className="min-w-[150px] flex-[1.1]">DESCRIPTION</div>
                    {showMapping && <div className="w-[124px] shrink-0">MAPPING</div>}
                    <div className="w-[96px] shrink-0 text-warning-text">KNX VALUE</div>
                    <div className="w-[96px] shrink-0 text-hms-accent">MODBUS VALUE</div>
                    <div className="min-w-[200px] flex-[1.3]">LAST OPERATION</div>
                  </div>
                  {shownSignals.map((signal, index) => {
                    const mapping = signalMapping(signal);
                    const stat = opStats[signal.id];
                    const liveKnx = liveValue(signal.id, "knx");
                    const liveMb = liveValue(signal.id, "mb");
                    const statText = stat
                      ? `${stat.t}  ${stat.ok ? "✓" : "✗"} ${stat.text}`
                      : "—";
                    return (
                      <div
                        key={signal.id}
                        className={cn(
                          "flex items-start border-b border-row-rule px-[14px] py-[5px]",
                          showMapping ? "min-w-[730px]" : "min-w-[600px]",
                          stat ? (stat.ok ? "bg-[#F8FCFA]" : "bg-row-error") : "bg-white",
                        )}
                      >
                        <div className="w-[36px] shrink-0 font-mono text-[11px] text-fg-subtle">
                          {index + 1}
                        </div>
                        <div
                          title={signal.description}
                          className="min-w-[150px] flex-[1.1] truncate pr-[8px] text-[12px] text-text-body"
                        >
                          {signal.description || `Signal ${signal.id + 1}`}
                        </div>
                        {showMapping && (
                          <div
                            title={mapping}
                            className="w-[124px] shrink-0 truncate pr-[8px] font-mono text-[10.5px] text-fg-subtle"
                          >
                            {mapping}
                          </div>
                        )}
                        <div className="w-[96px] shrink-0">
                          <input
                            value={drafts[`${signal.id}|knx`] ?? liveKnx ?? ""}
                            placeholder="—"
                            aria-label={`${signal.description || `Signal ${signal.id + 1}`} KNX value`}
                            onChange={(event) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [`${signal.id}|knx`]: event.target.value,
                              }))
                            }
                            onKeyDown={(event) => onValueKey(event, signal, "knx")}
                            className="w-[86px] rounded-[3px] border border-bms-border bg-bms-surface px-[7px] py-[3px] font-mono text-[11.5px] text-hms-blue placeholder:text-fg-subtle"
                          />
                        </div>
                        <div className="w-[96px] shrink-0">
                          <input
                            value={drafts[`${signal.id}|mb`] ?? liveMb ?? ""}
                            placeholder="—"
                            aria-label={`${signal.description || `Signal ${signal.id + 1}`} Modbus value`}
                            onChange={(event) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [`${signal.id}|mb`]: event.target.value,
                              }))
                            }
                            onKeyDown={(event) => onValueKey(event, signal, "mb")}
                            className="w-[86px] rounded-[3px] border border-device-border bg-device-surface px-[7px] py-[3px] font-mono text-[11.5px] text-hms-blue placeholder:text-fg-subtle"
                          />
                        </div>
                        <div
                          title={statText}
                          className={cn(
                            "min-w-[200px] flex-[1.3] whitespace-normal break-words font-mono text-[10.5px] leading-[1.45]",
                            stat
                              ? stat.ok
                                ? "text-success"
                                : "text-error"
                              : "text-fg-subtle",
                          )}
                        >
                          {statText}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={toggleSv}
            title="Show the signals viewer"
            className="flex w-[30px] shrink-0 cursor-pointer items-center justify-center border-l border-border bg-white hover:bg-device-surface"
          >
            <span className="font-mono text-[10px] font-semibold tracking-[.1em] text-hms-accent [writing-mode:vertical-rl] rotate-180 whitespace-nowrap">
              SIGNALS VIEWER
            </span>
          </button>
        )}
      </div>

      {/* ---------- status bar ---------- */}
      <div className="flex h-[28px] shrink-0 items-center justify-between gap-4 bg-hms-blue px-[14px] font-mono text-[11px] text-[rgba(255,255,255,.85)]">
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">
          Connected to {session.host}:{session.port}
          {familyLine ? ` · ${familyLine}` : ""}
        </span>
        <span className="whitespace-nowrap">
          Session uptime {formatUptime(liveStatus.connectedAt, nowMs)}
        </span>
      </div>

      {resetOpen && (
        <Modal
          title="Reset gateway"
          description="Sends RESET! to the gateway console. The gateway restarts (about 12 s) and this console session drops — reconnect from the Connection screen afterwards."
          foot="The configuration in the gateway is kept"
          ctaLabel="Reset gateway"
          onConfirm={() => {
            setResetOpen(false);
            void runConsoleCommand("RESET!");
          }}
          onClose={() => setResetOpen(false)}
        >
          <p className="text-[12.5px] leading-[1.6] text-text-body">
            Live monitoring stops while the gateway restarts. The answer from the gateway appears
            in the console below.
          </p>
        </Modal>
      )}
    </div>
  );
}

function ChipButton({
  on,
  onClick,
  title,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      title={title}
      className={cn(
        "cursor-pointer whitespace-nowrap rounded-[4px] border px-[10px] py-[7px] text-[12.5px] font-bold",
        on ? "border-hms-accent bg-info-bg text-hms-accent" : "border-border bg-white text-fg-muted",
      )}
    >
      {children}
    </button>
  );
}
