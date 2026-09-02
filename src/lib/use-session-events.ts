"use client";

import * as React from "react";
import type { GatewaySessionStatus, SessionEvent } from "./gateway-api";

export interface LogEntry {
  at: string;
  line: string;
}

export interface TransferProgress {
  receivedBytes: number;
  totalBytes: number;
}

const LOG_LIMIT = 300;
const MONITOR_LIMIT = 300;

interface EventsState {
  sessionId: string | null;
  log: LogEntry[];
  progress: TransferProgress | null;
  /** Raw lines pushed by the diagnostics monitor (SPONS/COMMS). */
  monitor: LogEntry[];
  /** Latest status event (monitor toggles); session state itself is REST-fetched. */
  status: GatewaySessionStatus | null;
}

const EMPTY: EventsState = { sessionId: null, log: [], progress: null, monitor: [], status: null };

/**
 * Subscribes to the session SSE stream (`GET .../events`). The server replays
 * recent history on subscribe, so mounting this hook shows the full current
 * operation. Returns the accumulated log lines, the latest XMODEM progress,
 * the diagnostics monitor lines and the last pushed status. State is tagged
 * with the session id so switching sessions never shows stale entries (no
 * reset-in-effect needed).
 */
export function useSessionEvents(sessionId: string | null) {
  const [state, setState] = React.useState<EventsState>(EMPTY);

  React.useEffect(() => {
    if (!sessionId || typeof EventSource === "undefined") return;

    const source = new EventSource(
      `/api/gateway/sessions/${encodeURIComponent(sessionId)}/events`,
    );
    source.onmessage = (message: MessageEvent<string>) => {
      let event: SessionEvent;
      try {
        event = JSON.parse(message.data) as SessionEvent;
      } catch {
        return;
      }
      setState((prev) => {
        const base = prev.sessionId === sessionId ? prev : { ...EMPTY, sessionId };
        if (event.type === "log") {
          return {
            ...base,
            log: [...base.log.slice(-(LOG_LIMIT - 1)), { at: event.at, line: event.line }],
          };
        }
        if (event.type === "progress") {
          return {
            ...base,
            progress: { receivedBytes: event.receivedBytes, totalBytes: event.totalBytes },
          };
        }
        if (event.type === "monitor") {
          return {
            ...base,
            monitor: [
              ...base.monitor.slice(-(MONITOR_LIMIT - 1)),
              { at: event.at, line: event.line },
            ],
          };
        }
        if (event.type === "status") {
          return { ...base, status: event.status };
        }
        return base;
      });
    };
    return () => source.close();
  }, [sessionId]);

  return state.sessionId === sessionId
    ? { log: state.log, progress: state.progress, monitor: state.monitor, status: state.status }
    : { log: EMPTY.log, progress: null, monitor: EMPTY.monitor, status: null };
}
