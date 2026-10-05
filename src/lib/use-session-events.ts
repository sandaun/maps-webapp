"use client";

import * as React from "react";
import type { GatewaySessionStatus, SessionEvent } from "./gateway-api";
import { RingBuffer } from "./ring-buffer";
import { DIAGNOSTICS_BATCH_MS, DIAGNOSTICS_WINDOW } from "./diagnostics-history";

export interface LogEntry { at: string; line: string; seq?: number }
export interface TransferProgress { receivedBytes: number; totalBytes: number }
type IncomingEvent = SessionEvent | { type: "gap"; dropped: number };
interface EventsState {
  sessionId: string | null;
  log: LogEntry[];
  progress: TransferProgress | null;
  monitor: LogEntry[];
  status: GatewaySessionStatus | null;
  dropped: number;
  streamError: string | null;
}
const EMPTY: EventsState = { sessionId: null, log: [], progress: null, monitor: [], status: null, dropped: 0, streamError: null };

/** Coalesce transport events into one React update per 100 ms. The disk
 * capture is independent of this bounded live window and SSE reconnection. */
export function useSessionEvents(sessionId: string | null) {
  const [state, setState] = React.useState<EventsState>(EMPTY);
  React.useEffect(() => {
    if (!sessionId || typeof EventSource === "undefined") return;
    const monitor = new RingBuffer<LogEntry>(DIAGNOSTICS_WINDOW);
    const log = new RingBuffer<LogEntry>(300);
    let pending: IncomingEvent[] = [];
    let progress: TransferProgress | null = null;
    let status: GatewaySessionStatus | null = null;
    let lastSeq = 0;
    let dropped = 0;
    let streamError: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const flush = () => {
      timer = undefined;
      if (disposed) return;
      let monitorChanged = false;
      let logChanged = false;
      for (const event of pending) {
        if (event.type === "monitor") {
          if (event.seq !== undefined && event.seq <= lastSeq) continue;
          lastSeq = event.seq ?? lastSeq;
          monitor.push({ at: event.at, line: event.line, seq: event.seq });
          monitorChanged = true;
        } else if (event.type === "log") {
          log.push({ at: event.at, line: event.line });
          logChanged = true;
        } else if (event.type === "progress") progress = { receivedBytes: event.receivedBytes, totalBytes: event.totalBytes };
        else if (event.type === "status") status = event.status;
        else if (event.type === "gap") dropped += event.dropped;
      }
      pending = [];
      setState((prev) => ({
        sessionId, progress, status, dropped, streamError,
        monitor: monitorChanged ? monitor.snapshot() : prev.sessionId === sessionId ? prev.monitor : [],
        log: logChanged ? log.snapshot() : prev.sessionId === sessionId ? prev.log : [],
      }));
    };
    const schedule = () => { timer ??= setTimeout(flush, DIAGNOSTICS_BATCH_MS); };
    const source = new EventSource(`/api/gateway/sessions/${encodeURIComponent(sessionId)}/events`);
    source.onmessage = (message: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(message.data);
        const events: IncomingEvent[] = payload.type === "batch" ? payload.events : [payload];
        if (!Array.isArray(events)) return;
        pending.push(...events);
        if (pending.length > 20_000) {
          const excess = pending.splice(0, pending.length - 20_000);
          dropped += excess.filter((event) => event.type === "monitor").length;
        }
        streamError = null;
        schedule();
      } catch { /* malformed event is not a gateway failure */ }
    };
    source.onerror = () => { streamError = "Live preview interrupted — reconnecting. Server capture continues."; schedule(); };
    source.onopen = () => { streamError = null; schedule(); };
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      pending = [];
      source.close();
    };
  }, [sessionId]);
  const current = state.sessionId === sessionId ? state : EMPTY;
  return { log: current.log, progress: current.progress, monitor: current.monitor, status: current.status, dropped: current.dropped, streamError: current.streamError };
}
