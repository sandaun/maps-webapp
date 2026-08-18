"use client";

import * as React from "react";
import type { SessionEvent } from "./gateway-api";

export interface LogEntry {
  at: string;
  line: string;
}

export interface TransferProgress {
  receivedBytes: number;
  totalBytes: number;
}

const LOG_LIMIT = 300;

interface EventsState {
  sessionId: string | null;
  log: LogEntry[];
  progress: TransferProgress | null;
}

const EMPTY: EventsState = { sessionId: null, log: [], progress: null };

/**
 * Subscribes to the session SSE stream (`GET .../events`). The server replays
 * recent history on subscribe, so mounting this hook shows the full current
 * operation. Returns the accumulated log lines and the latest XMODEM progress.
 * State is tagged with the session id so switching sessions never shows stale
 * entries (no reset-in-effect needed).
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
        // "status" events are ignored: session state is fetched via REST.
        return base;
      });
    };
    return () => source.close();
  }, [sessionId]);

  return state.sessionId === sessionId
    ? { log: state.log, progress: state.progress }
    : { log: EMPTY.log, progress: null };
}
