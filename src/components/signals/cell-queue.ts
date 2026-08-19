import type { SignalPatchInput } from "@/lib/project-types";

export type CellStatusKind = "saving" | "ok" | "err";

export interface CellStatus {
  kind: CellStatusKind;
  message?: string;
}

/**
 * Per-cell save queue: one in-flight request; newer values replace the pending
 * payload and are sent after the current request so the server keeps the last edit.
 */
export function createCellSaveQueue<TSend>(send: (payload: TSend) => Promise<void>) {
  const inflight = new Map<string, Promise<void>>();
  const pending = new Map<string, TSend>();

  function enqueue(key: string, payload: TSend): Promise<void> {
    pending.set(key, payload);
    const existing = inflight.get(key);
    if (existing) return existing;

    const run = (async () => {
      let lastError: unknown;
      while (pending.has(key)) {
        const next = pending.get(key);
        if (next === undefined) break;
        pending.delete(key);
        try {
          await send(next);
          lastError = undefined;
        } catch (err) {
          lastError = err;
        }
      }
      if (lastError !== undefined) throw lastError;
    })().finally(() => {
      inflight.delete(key);
      const leftover = pending.get(key);
      if (leftover !== undefined) void enqueue(key, leftover);
    });

    inflight.set(key, run);
    return run;
  }

  return { enqueue };
}

export interface CellSavePayload {
  signalId: number;
  field: string;
  patch: SignalPatchInput;
}
