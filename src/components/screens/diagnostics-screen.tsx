"use client";

import * as React from "react";
import Link from "next/link";
import { diagnosticSignals, createDiagnosticValueResolver, signalCommand, type DiagnosticSignal, type SignalSide } from "@/lib/diagnostics-signals";
import { createDiagnosticTrafficResolver } from "@/lib/diagnostics-traffic";
import { RingBuffer } from "@/lib/ring-buffer";
import { DIAGNOSTICS_WINDOW } from "@/lib/diagnostics-history";
import { createDiagnosticRateCounter } from "@/lib/diagnostics-rates";
import { TrafficList } from "@/components/diagnostics/traffic-list";
import { SavedDiagnosticLogs } from "@/components/diagnostics/saved-logs";
import { useCurrentProject } from "@/lib/current-project";
import {
  sendConsoleCommand,
  setGatewayMonitor,
  setGatewayRecording,
  getDiagnosticHistory,
  diagnosticDownloadUrl,
  type GatewaySessionStatus,
} from "@/lib/gateway-api";
import { useGatewaySession } from "@/lib/gateway-session";
import {
  formatClock,
  formatConsoleStamp,
  formatFrameTime,
  formatRates,
  formatUptime,
  isTimeoutText,
  parseMonitorLine,
  parseReadValue,
  type MonitorFrame,
  type MonitorProto,
} from "@/lib/diagnostics-parsing";
import { useSessionEvents } from "@/lib/use-session-events";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";

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

const CON_ECHO = "text-console-accent";
const CON_ANSWER = "text-console-fg/86";
const CON_SILENT = "text-console-fg/40";
const CON_WARN = "text-console-warn";
const CON_ERROR = "text-console-error";
const CON_LOG = "text-console-fg/45";

const FILTER_TABS: { key: "all" | MonitorProto; label: string }[] = [
  { key: "all", label: "All" },
  { key: "KNX", label: "KNX" },
  { key: "MODBUS", label: "Modbus" },
  { key: "SYS", label: "System" },
];

const QUICK_COMMANDS = ["INFO?", "APPINFO?", "DIAGS?", "HARDINFO?"];

interface ConsoleLine {
  t: string;
  /** Console text class (CON_*). */
  tone: string;
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
          <SavedDiagnosticLogs />
        </CardContent>
      </Card>
    );
  }

  return <LiveDiagnostics key={session.id} session={session} />;
}

function LiveDiagnostics({ session }: { session: GatewaySessionStatus }) {
  const { view } = useCurrentProject();
  const deviceSide = view?.family === "me-mbs" ? "me" : "knx";
  const deviceLabel = deviceSide === "me" ? "ME" : "KNX";
  const filterTabs = FILTER_TABS.map((tab) => tab.key === "KNX" && deviceSide === "me"
    ? { key: "ME" as const, label: "ME" } : tab);
  const { log, monitor, status, dropped = 0, streamError } = useSessionEvents(session.id);

  const liveStatus = status ? { ...session, ...status, archive: session.archive ?? status.archive } : session;
  const monitoring = liveStatus.connected && liveStatus.monitoring;

  /* ----- family-specific runtime signal ids ----- */
  const signals = React.useMemo(() => diagnosticSignals(view), [view]);
  const activeSignals = React.useMemo(() => signals?.filter((s) => s.active) ?? [], [signals]);
  const tableSignals = React.useMemo(
    () => (activeSignals.length > 0 ? activeSignals : (signals ?? [])).slice(0, SV_MAX_SIGNALS),
    [activeSignals, signals],
  );

  /* ----- monitor lifecycle: stream only while this screen is open ----- */
  // Bus frames (COMMS=1) are on by default; firmware debug lines (DEBUG=1)
  // are opt-in, like the MAPS "Debug" checkbox.
  const [monitorError, setMonitorError] = React.useState<string | null>(null);
  const [streams, setStreams] = React.useState({
    comms: session.monitoring ? (session.monitorComms ?? true) : true,
    debug: session.monitoring ? (session.monitorDebug ?? false) : false,
  });
  const streamsRef = React.useRef(streams);
  // StrictMode replays setup/cleanup; rapid toolbar clicks also overlap.
  // The server rejects concurrent operations, so apply toggles in order.
  const monitorQueue = React.useRef<Promise<unknown>>(Promise.resolve());
  const queueMonitor = React.useCallback((enabled: boolean, options = streamsRef.current) => {
    const operation = monitorQueue.current.then(() => setGatewayMonitor(session.id, enabled, options));
    monitorQueue.current = operation.catch(() => {});
    return operation;
  }, [session.id]);
  React.useEffect(() => {
    if (!session.connected) return;
    let disposed = false;
    queueMonitor(true)
      .then(() => { if (!disposed) setMonitorError(null); })
      .catch((err) => { if (!disposed) setMonitorError(errorMessage(err, "Could not start the monitor")); });
    return () => {
      disposed = true;
      queueMonitor(false).catch(() => {});
    };
  }, [session.connected, queueMonitor]);

  function toggleStream(key: "comms" | "debug") {
    const next = { ...streams, [key]: !streams[key] };
    setStreams(next);
    streamsRef.current = next;
    // Re-enabling re-applies the toggles (setMonitor disables first).
    if (session.connected) {
      queueMonitor(true, next)
        .then(() => setMonitorError(null))
        .catch((err) => setMonitorError(errorMessage(err, "Could not start the monitor")));
    }
  }

  /* ----- traffic buffer (own copy so Clear/Pause are local) ----- */
  const [frames, setFrames] = React.useState<MonitorFrame[]>([]);
  const frameBuffer = React.useRef(new RingBuffer<MonitorFrame>(DIAGNOSTICS_WINDOW));
  const rateCounter = React.useRef(createDiagnosticRateCounter());
  const nextFrameIndex = React.useRef(0);
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
    for (const entry of fresh) {
      const index = entry.seq ?? nextFrameIndex.current++;
      const frame = parseMonitorLine(entry.line, index, entry.at);
      frameBuffer.current.push(frame);
      rateCounter.current.add(frame);
    }
    setFrames(frameBuffer.current.snapshot());
  }, [monitor]);

  /* ----- toolbar state ----- */
  const [paused, setPaused] = React.useState(false);
  const [pausedFrames, setPausedFrames] = React.useState<MonitorFrame[] | null>(null);
  const [autoScroll, setAutoScroll] = React.useState(true);
  const [readingFrames, setReadingFrames] = React.useState<MonitorFrame[] | null>(null);
  const [heldAt, setHeldAt] = React.useState<number | null>(null);
  const [loadingHistory, setLoadingHistory] = React.useState(false);
  const [historyError, setHistoryError] = React.useState<string | null>(null);
  const [recordingBusy, setRecordingBusy] = React.useState(false);
  const [showTs, setShowTs] = React.useState(true);
  const showTrafficSignals = signals !== null;
  const [filter, setFilter] = React.useState<"all" | MonitorProto>("all");
  const [query, setQuery] = React.useState("");
  const [resetOpen, setResetOpen] = React.useState(false);

  const source = pausedFrames ?? readingFrames ?? frames;
  const resolver = React.useMemo(() => createDiagnosticTrafficResolver(view), [view]);
  const trafficSignals = React.useMemo(() => new Map(source.map((frame) => [frame.i, resolver.resolve(frame)])), [resolver, source]);
  const heldCount = heldAt !== null ? Math.max(0, (frames.at(-1)?.i ?? heldAt) - heldAt) : 0;
  const needle = query.trim().toLowerCase();
  const visibleFrames = source.filter(
    (frame) =>
      (filter === "all" || frame.proto === filter) &&
      (!needle || [frame.dec, frame.frame, frame.obj, trafficSignals.get(frame.i)?.detail].join(" ").toLowerCase().includes(needle)),
  );
  function togglePause() {
    if (paused) {
      followLatest();
    } else {
      setPausedFrames(source);
      setPaused(true);
      setHeldAt(frames.at(-1)?.i ?? 0);
    }
  }

  function readHistory() {
    setAutoScroll(false);
    setReadingFrames(source);
    setHeldAt(frames.at(-1)?.i ?? 0);
  }

  function followLatest() {
    setAutoScroll(true);
    setPaused(false);
    setPausedFrames(null);
    setReadingFrames(null);
    setHeldAt(null);
  }

  function toggleAutoScroll() {
    if (autoScroll) readHistory(); else followLatest();
  }

  async function loadOlderHistory() {
    if (loadingHistory || !source[0]) return;
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const page = await getDiagnosticHistory(session.id, source[0].i);
      const older = page.entries.map((entry) => parseMonitorLine(entry.line, entry.seq, entry.at));
      if (!older.length) { setHistoryError("Beginning of saved capture reached."); return; }
      setAutoScroll(false);
      setPaused(false);
      setPausedFrames(null);
      setHeldAt(frames.at(-1)?.i ?? 0);
      // Keep browsing bounded; the complete recording remains on disk.
      setReadingFrames([...older, ...source].slice(0, DIAGNOSTICS_WINDOW));
    } catch (error) { setHistoryError(errorMessage(error, "Could not load earlier traffic")); }
    finally { setLoadingHistory(false); }
  }

  async function toggleRecording() {
    if (recordingBusy) return;
    setRecordingBusy(true);
    try {
      const operation = monitorQueue.current.then(() => setGatewayRecording(session.id, !liveStatus.recording));
      monitorQueue.current = operation.catch(() => {});
      await operation;
      setHistoryError(null);
    } catch (error) { setHistoryError(errorMessage(error, "Could not change recording")); }
    finally { setRecordingBusy(false); }
  }

  function clearTraffic() {
    setFrames([]);
    frameBuffer.current.clear();
    rateCounter.current.clear();
    setPausedFrames(null);
    setReadingFrames(null);
    setHeldAt(null);
  }

  /* ----- 1 s tick for rates / uptime ----- */
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  React.useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const rates = rateCounter.current.read(nowMs);
  const timeoutCount = React.useMemo(
    () => frames.filter((frame) => isTimeoutText(frame.dec)).length,
    [frames],
  );

  /* ----- live signal values from the stream ----- */
  const valueResolver = React.useMemo(() => createDiagnosticValueResolver(signals), [signals]);
  const streamValues = React.useMemo(() => valueResolver.consume(frames), [frames, valueResolver]);

  // Values confirmed by console reads/writes override the stream snapshot.
  const [valueOverrides, setValueOverrides] = React.useState<Record<string, string>>({});
  const liveValue = React.useCallback(
    (signalId: number, side: SignalSide) =>
      valueOverrides[`${signalId}|${side}`] ?? streamValues.get(`${signalId}|${side}`),
    [valueOverrides, streamValues],
  );

  /* ----- console ----- */
  const [conOpen, setConOpen] = React.useState(false);
  const [conInput, setConInput] = React.useState("");
  const [conLines, setConLines] = React.useState<ConsoleLine[]>([]);
  const conLogRef = React.useRef<HTMLDivElement>(null);

  const echo = React.useCallback((tone: string, text: string) => {
    const line: ConsoleLine = { t: formatConsoleStamp(new Date()), tone, text };
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
          tone: CON_LOG,
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

  async function writeSignal(signal: DiagnosticSignal, side: SignalSide, value: string) {
    const command = signalCommand(signal, side, value);
    if (!command) return;
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
    signal: DiagnosticSignal,
    side: SignalSide,
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
        const knxCommand = signalCommand(signal, deviceSide);
        const mbCommand = signalCommand(signal, "mb");
        if (!knxCommand || !mbCommand) continue;
        const knxResult = await sendConsoleCommand(session.id, knxCommand).catch(() => null);
        const knxValue = knxResult?.lines.map(parseReadValue).find((v) => v !== null);
        const mbResult = await sendConsoleCommand(session.id, mbCommand).catch(() => null);
        const mbValue = mbResult?.lines.map(parseReadValue).find((v) => v !== null);
        setValueOverrides((prev) => {
          const next = { ...prev };
          if (knxValue) next[`${signal.id}|${deviceSide}`] = knxValue;
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
        `${s.description} ${s.mapping}`.toLowerCase().includes(svNeedle),
      )
    : tableSignals;

  const streamState = paused ? "paused" : monitoring ? "live" : "monitor off";
  const familyLine =
    view?.family === "knx-mbm"
      ? "BMS protocol KNX · Device protocol Modbus Master"
      : view?.family === "me-mbs"
        ? "BMS protocol Modbus · Device protocol ME-AC"
        : view?.family === "mbs-knx"
          ? "BMS protocol Modbus · Device protocol KNX"
          : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {monitorError && (
        <p role="alert" className="shrink-0 border-b border-border bg-error-bg px-[18px] py-[9px] text-sm text-error">
          Monitor could not start: {monitorError}
        </p>
      )}
      {(streamError || historyError || liveStatus.archive?.error) && <p role="status" className="shrink-0 border-b border-border bg-warning-bg px-[18px] py-2 text-sm text-warning">{liveStatus.archive?.error || historyError || streamError}</p>}
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
        <button type="button" disabled={recordingBusy} onClick={toggleRecording} title="Keep capturing on the server when you leave this screen" className={cn("cursor-pointer rounded border px-3 py-2 text-xs font-bold", liveStatus.recording ? "border-hms-accent bg-hms-accent text-white" : "border-border text-hms-blue")}>{liveStatus.recording ? "Stop background recording" : "Record in background"}</button>
        {liveStatus.archive && <a href={diagnosticDownloadUrl(session.id)} download className="rounded border border-border px-3 py-2 text-xs font-bold text-hms-blue">Download log</a>}
        <SavedDiagnosticLogs />
        <ChipButton on={showTs} onClick={() => setShowTs((v) => !v)}>
          Time stamp
        </ChipButton>
        <ChipButton
          on={streams.comms}
          onClick={() => toggleStream("comms")}
          title="Raw bus frames in hex, polling included"
        >
          Comms
        </ChipButton>
        <ChipButton
          on={streams.debug}
          onClick={() => toggleStream("debug")}
          title="Firmware debug lines: bus timeouts, plus internal traces"
        >
          Debug
        </ChipButton>
        <div className="h-[22px] w-px bg-border" />
        {filterTabs.map((tab) => (
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
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-console-bg">
            {!showTrafficSignals && (
              <p className="shrink-0 px-[14px] py-[6px] text-[11px] text-console-fg/45">
                Open a project to identify signals in the traffic log.
              </p>
            )}
            <TrafficList frames={visibleFrames} matches={trafficSignals} showSignals={showTrafficSignals}
              showTimestamp={showTs} following={autoScroll && !paused} onReadHistory={readHistory}
              emptyMessage={frames.length === 0 ? "No frames yet — the monitor streams when the gateway pushes data." : "No frames match the current filter."} />
            <div className="flex shrink-0 gap-4 bg-console-fg/5 px-[14px] py-[6px] font-mono text-[11px] text-console-fg/50">
              <span>{source.length.toLocaleString()} frames{liveStatus.archive ? ` · ${liveStatus.archive.count.toLocaleString()} saved` : ""}</span>
              <span>{formatRates(rates)}</span>
              {heldCount > 0 && (
                <button type="button" onClick={followLatest} className="cursor-pointer font-semibold text-console-accent">↓ {heldCount.toLocaleString()} new entries · Jump to latest</button>
              )}
              {timeoutCount > 0 && (
                <span className="text-console-error">{timeoutCount} timeouts</span>
              )}
              {dropped > 0 && <span className="text-console-warn">{dropped.toLocaleString()} preview lines skipped · download the full capture</span>}
              {liveStatus.archive && source[0]?.i > 1 && <button type="button" disabled={loadingHistory} onClick={loadOlderHistory} className="cursor-pointer text-console-accent">{loadingHistory ? "Loading…" : "Load older"}</button>}
              {!autoScroll && heldCount === 0 && <button type="button" onClick={followLatest} className="cursor-pointer text-console-accent">↓ Jump to latest</button>}
              <div className="flex-1" />
              <span>{liveStatus.recording ? "recording on server" : streamState}</span>
            </div>
          </div>

          {/* console — peer of the monitor, resizable */}
          {conOpen && (
            <div
              style={{ height: conHeight }}
              className="flex min-h-0 shrink-0 flex-col border-t-2 border-console-rule bg-console-bg"
            >
              <div
                onPointerDown={onConPointerDown}
                title="Drag to resize the console"
                className="flex h-[8px] shrink-0 cursor-row-resize items-center justify-center bg-border-strong hover:bg-hms-accent"
              >
                <div className="h-[2px] w-[34px] rounded-[2px] bg-console-fg/60" />
              </div>
              <div className="flex shrink-0 items-center gap-3 bg-console-fg/5 px-[14px] py-[6px]">
                <span className="whitespace-nowrap font-mono text-[10px] font-semibold tracking-[.08em] text-console-fg/45">
                  CONSOLE
                </span>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-console-fg/34">
                  commands you send to the gateway and its answers — not bus traffic
                </span>
                <div className="flex-1" />
                {QUICK_COMMANDS.map((cmd) => (
                  <button
                    key={cmd}
                    type="button"
                    onClick={() => void runConsoleCommand(cmd)}
                    className="cursor-pointer whitespace-nowrap font-mono text-[11px] text-console-accent"
                  >
                    {cmd}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setConLines([])}
                  className="cursor-pointer font-mono text-[11px] text-console-fg/42"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setConOpen(false)}
                  aria-label="Close console"
                  className="cursor-pointer px-[2px] text-[15px] leading-none text-console-fg/42"
                >
                  ×
                </button>
              </div>
              <div ref={conLogRef} className="min-h-0 flex-1 overflow-auto px-[14px] py-[8px]">
                {conLines.length === 0 && (
                  <div className="font-mono text-[11.5px] leading-[1.7] text-console-fg/30">
                    No commands sent yet — try INFO? to ask the gateway who it is.
                  </div>
                )}
                {conLines.map((line, index) => (
                  <div key={index} className="flex gap-[8px] font-mono text-[11.5px] leading-[1.7]">
                    <span className="whitespace-nowrap text-console-fg/28">
                      {showTs ? line.t : ""}
                    </span>
                    <span className={cn("min-w-0 flex-1 whitespace-pre-wrap", line.tone)}>
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
              "flex shrink-0 items-center gap-[9px] bg-console-bg px-[14px] py-[7px]",
              conOpen ? "border-t border-console-fg/8" : "border-t-2 border-console-rule",
            )}
          >
            <button
              type="button"
              onClick={() => setConOpen((v) => !v)}
              className="cursor-pointer whitespace-nowrap font-mono text-[10px] font-semibold tracking-[.08em] text-console-fg/45"
            >
              {conOpen ? "CONSOLE ▾" : "CONSOLE ▸"}
            </button>
            <span className="font-mono text-[12px] font-semibold text-console-accent">&gt;</span>
            <input
              value={conInput}
              onChange={(event) => setConInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void runConsoleCommand(conInput);
              }}
              placeholder="Type a gateway command and press Enter — INFO?"
              aria-label="Gateway console command"
              className="min-w-0 flex-1 rounded-[4px] border border-console-fg/14 bg-console-fg/6 px-[9px] py-[6px] font-mono text-[11.5px] text-console-fg placeholder:text-console-fg/35"
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
                  editable cells: type a value and press Enter to send
                </span>
              </div>
              {signals === null ? (
                <p className="px-[14px] py-4 text-[12px] leading-[1.6] text-fg-muted">
                  Open a project to read and write its signals from here.
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
                    <div className="w-[96px] shrink-0 text-warning-text">{deviceLabel} VALUE</div>
                    <div className="w-[96px] shrink-0 text-hms-accent">MODBUS VALUE</div>
                    <div className="min-w-[200px] flex-[1.3]">LAST OPERATION</div>
                  </div>
                  {shownSignals.map((signal, index) => {
                    const mapping = signal.mapping;
                    const stat = opStats[signal.id];
                    const liveKnx = liveValue(signal.id, deviceSide);
                    const liveMb = liveValue(signal.id, "mb");
                    const pendingKnx = drafts[`${signal.id}|${deviceSide}`] !== undefined;
                    const pendingMb = drafts[`${signal.id}|mb`] !== undefined;
                    const pending = pendingKnx || pendingMb;
                    const statText = pending
                      ? "Pending — press Enter to send"
                      : stat
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
                            value={drafts[`${signal.id}|${deviceSide}`] ?? liveKnx ?? ""}
                            placeholder="—"
                            aria-label={`${signal.description || `Signal ${signal.id + 1}`} ${deviceLabel} value`}
                            disabled={!signal.endpoints[deviceSide]}
                            readOnly={!signal.writable[deviceSide]}
                            title={!signal.writable[deviceSide] ? `Read-only from the ${deviceLabel} side` : pendingKnx ? "Pending — press Enter to send" : "Type a value and press Enter to send"}
                            onChange={(event) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [`${signal.id}|${deviceSide}`]: event.target.value,
                              }))
                            }
                            onKeyDown={(event) => onValueKey(event, signal, deviceSide)}
                            className={cn("w-[86px] rounded-[3px] border border-bms-border bg-bms-surface px-[7px] py-[3px] font-mono text-[11.5px] text-hms-blue placeholder:text-fg-subtle read-only:cursor-default read-only:bg-white", pendingKnx && "border-warning-text")}
                          />
                        </div>
                        <div className="w-[96px] shrink-0">
                          <input
                            value={drafts[`${signal.id}|mb`] ?? liveMb ?? ""}
                            placeholder="—"
                            aria-label={`${signal.description || `Signal ${signal.id + 1}`} Modbus value`}
                            disabled={!signal.endpoints.mb}
                            readOnly={!signal.writable.mb}
                            title={!signal.writable.mb ? "Read-only from the Modbus side" : pendingMb ? "Pending — press Enter to send" : "Type a value and press Enter to send"}
                            onChange={(event) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [`${signal.id}|mb`]: event.target.value,
                              }))
                            }
                            onKeyDown={(event) => onValueKey(event, signal, "mb")}
                            className={cn("w-[86px] rounded-[3px] border border-device-border bg-device-surface px-[7px] py-[3px] font-mono text-[11.5px] text-hms-blue placeholder:text-fg-subtle read-only:cursor-default read-only:bg-white", pendingMb && "border-warning-text")}
                          />
                        </div>
                        <div
                          title={statText}
                          className={cn(
                            "min-w-[200px] flex-[1.3] whitespace-normal break-words font-mono text-[10.5px] leading-[1.45]",
                            pending
                              ? "text-warning-text"
                              : stat
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
          Connected to {session.host}{session.transport === "usb" ? " · USB" : `:${session.port}`}
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
