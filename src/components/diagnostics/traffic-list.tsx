"use client";

import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { formatFrameTime, isFailureText, type MonitorFrame, type MonitorProto } from "@/lib/diagnostics-parsing";
import type { TrafficSignalMatch } from "@/lib/diagnostics-traffic";

const BADGES: Record<MonitorProto, string> = {
  KNX: "bg-console-bms text-console-bms-fg", MODBUS: "bg-console-device text-console-device-fg",
  ME: "bg-console-device text-console-device-fg", SYS: "bg-console-fg/20 text-console-fg",
};
const DESCRIPTIONS: Record<MonitorProto, string> = {
  KNX: "KNX TP1 telegram, standard frame", MODBUS: "Modbus ADU", ME: "Mitsubishi Electric AC", SYS: "internal event",
};

interface Props {
  frames: MonitorFrame[];
  matches: Map<number, TrafficSignalMatch>;
  showSignals: boolean;
  showTimestamp: boolean;
  following: boolean;
  onReadHistory: () => void;
  emptyMessage: string;
}

/** Height and scroll belong to this viewport, never the surrounding page.
 * Stable sequence keys and end anchoring preserve a row through prepends. */
export function TrafficList({ frames, matches, showSignals, showTimestamp, following, onReadHistory, emptyMessage }: Props) {
  const viewport = React.useRef<HTMLDivElement>(null);
  const [openId, setOpenId] = React.useState<number | null>(null);
  const latest = frames.at(-1)?.i;
  const firstLatest = React.useRef(latest);
  const userScroll = React.useRef(false);
  const suppressScroll = React.useRef(false);
  const suppressTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const contentClass = showSignals ? "w-[480px] shrink-0" : "min-w-[240px] flex-1";
  const minWidth = 142 + (showSignals ? 660 : 240) + (showTimestamp ? 104 : 0);
  // TanStack exposes mutable measurement functions; keep this outside compiler memoization.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: frames.length,
    getScrollElement: () => viewport.current,
    getItemKey: (index) => frames[index].i,
    estimateSize: () => 28,
    measureElement: (element) => element.getBoundingClientRect().height || 28,
    overscan: 8,
    paddingStart: 28,
    anchorTo: "end",
    followOnAppend: false,
    useFlushSync: false,
  });

  React.useLayoutEffect(() => {
    if (!following || !frames.length) return;
    suppressScroll.current = true;
    virtualizer.scrollToEnd({ behavior: "auto" });
    if (suppressTimer.current) clearTimeout(suppressTimer.current);
    suppressTimer.current = setTimeout(() => { suppressScroll.current = false; }, 100);
  }, [following, latest, frames.length, openId, virtualizer]);
  React.useEffect(() => () => { if (suppressTimer.current) clearTimeout(suppressTimer.current); }, []);

  // Highlight only genuinely arriving rows; mounting historical rows while
  // scrolling must not replay an entrance effect. No geometry animation.
  React.useEffect(() => { firstLatest.current ??= latest; }, [latest]);
  function handleScroll() {
    const element = viewport.current;
    if (!element || !following || !userScroll.current || suppressScroll.current) return;
    if (element.scrollHeight - element.scrollTop - element.clientHeight > 80) onReadHistory();
  }

  return (
      <div ref={viewport} data-testid="traffic-viewport" className="min-h-0 flex-1 overflow-auto overscroll-contain"
        style={{ overflowAnchor: "none" }} onScroll={handleScroll}
        onWheel={(event) => {
          userScroll.current = true;
          suppressScroll.current = false;
          // Freeze before the browser scrolls: a new batch must not race the gesture.
          if (following && event.deltaY < 0) onReadHistory();
        }}
        onTouchStart={() => { userScroll.current = true; suppressScroll.current = false; }}
        onTouchMove={() => { if (following) onReadHistory(); }}
        onPointerDown={(event) => {
          userScroll.current = true;
          suppressScroll.current = false;
          if (following && event.target === event.currentTarget) onReadHistory();
        }}
        onKeyDown={(event) => {
          userScroll.current = true;
          suppressScroll.current = false;
          if (following && ["ArrowUp", "PageUp", "Home"].includes(event.key)) onReadHistory();
        }} tabIndex={0} aria-label="Bus traffic log">
        <div style={{ minWidth, height: 28 }} className="sticky top-0 z-[2] flex bg-console-header px-[14px] py-[6px] font-mono text-[10px] font-semibold tracking-[.08em] text-console-fg/45">
          {showTimestamp && <div className="w-[104px] shrink-0 pr-4">TIME</div>}
          <div className="w-[74px] shrink-0">SOURCE</div><div className="w-[40px] shrink-0">DIR</div>
          <div className={cn(contentClass, "pr-3")}>FRAME / MESSAGE</div>
          {showSignals && <div className="w-[180px] shrink-0" title="Signals identified from the current project.">SIGNAL</div>}
        </div>
        {frames.length === 0 && <div className="px-[14px] py-6 font-mono text-[11.5px] text-console-fg/40">{emptyMessage}</div>}
        <div style={{ height: Math.max(0, virtualizer.getTotalSize() - 28), minWidth, position: "relative" }}>
          {virtualizer.getVirtualItems().map((row) => {
            const frame = frames[row.index];
            const match = matches.get(frame.i) ?? { label: "—", detail: "No matching signal." };
            const open = openId === frame.i;
            const age = Math.max(0, Date.now() - Date.parse(frame.at));
            const arrived = following && firstLatest.current !== undefined && frame.i > firstLatest.current && age < 300 && frames.length - row.index <= 30;
            return (
              <div key={row.key} ref={virtualizer.measureElement} data-index={row.index} data-frame-id={frame.i}
                className={arrived ? "diagnostic-arrival" : undefined}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${row.start - 28}px)`, animationDelay: arrived ? `-${age}ms` : undefined }}>
                <button type="button" onClick={() => setOpenId(open ? null : frame.i)}
                  className={cn("flex w-full cursor-pointer items-start px-[14px] py-[4px] text-left font-mono text-[11.5px]", open && "bg-console-accent/10")}>
                  {showTimestamp && <div className="w-[104px] shrink-0 whitespace-nowrap pr-4 tabular-nums text-console-fg/42">{formatFrameTime(frame.at)}</div>}
                  <div className="w-[74px] shrink-0"><span className={cn("rounded-[2px] px-[5px] py-[1px] text-[9.5px] font-semibold", BADGES[frame.proto])}>{frame.proto}</span></div>
                  <div className={cn("w-[40px] shrink-0", frame.dir === "TX" ? "text-console-tx" : frame.dir === "RX" ? "text-console-rx" : "text-console-fg/35")}>{frame.dir}</div>
                  <div title={frame.frame || frame.dec} className={cn(contentClass, "whitespace-normal break-words pr-3 leading-[1.5]", isFailureText(frame.dec) ? "text-console-error" : "text-console-fg/90")}>{frame.frame || frame.dec}</div>
                  {showSignals && <div title={match.detail} className="w-[180px] shrink-0 truncate text-console-object">{match.label}</div>}
                </button>
                {open && <div className="border-l-2 border-console-accent bg-console-fg/4 px-[14px] pb-[12px] pl-[24px] pt-[10px] font-mono text-[11.5px] leading-[1.7] text-console-fg/70">
                  <div>Raw frame {frame.frame || "—"}</div><div>Protocol {frame.proto} · {DESCRIPTIONS[frame.proto]}</div>
                  <div className="whitespace-normal break-words">Console message {frame.dec}</div>
                  {showSignals && <><div>Signal {match.label}</div><div className="whitespace-pre-line">{match.detail}</div></>}
                  {frame.obj && <div>Runtime signal ID {frame.obj}</div>}
                </div>}
              </div>
            );
          })}
        </div>
      </div>
  );
}
