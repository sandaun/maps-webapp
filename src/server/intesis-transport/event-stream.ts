import type { SessionEvent, SessionEventListener } from "./manager";
import { DIAGNOSTICS_BATCH_MS } from "@/lib/diagnostics-history";

/** A slow browser can lose its live preview, never the server capture or the
 * gateway reader. Every preview loss is counted explicitly in a gap event. */
export function sessionEventStream(subscribe: (listener: SessionEventListener) => () => void, signal: AbortSignal, after = 0): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let stop = () => {};
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let pending: { event: SessionEvent; size: number }[] = [];
      let head = 0;
      const priority = new Map<string, SessionEvent>();
      let pendingBytes = 0;
      let skipped = 0;
      let latestSeq = after;
      let firstMonitor = true;
      const flush = () => {
        if (closed || (controller.desiredSize ?? 0) <= 0) return;
        if (head === pending.length && !skipped && !priority.size) return;
        const events: unknown[] = [...priority.values()];
        priority.clear();
        if (skipped) { events.push({ type: "gap", dropped: skipped }); skipped = 0; }
        let bytes = 0;
        let count = 0;
        while (head + count < pending.length && count < 512 && bytes < 48 * 1024) {
          const item = pending[head + count++];
          events.push(item.event);
          bytes += item.size;
          if (item.event.type === "monitor" && item.event.seq) latestSeq = item.event.seq;
        }
        pending = pending.slice(head + count);
        head = 0;
        pendingBytes -= bytes;
        const id = latestSeq ? `id: ${latestSeq}\n` : "";
        controller.enqueue(encoder.encode(`${id}data: ${JSON.stringify({ type: "batch", events })}\n\n`));
      };
      const unsubscribe = subscribe((event) => {
        if (closed) return;
        if (event.type === "status" || event.type === "progress") { priority.set(event.type, event); return; }
        if (event.type === "monitor" && event.seq) {
          if (event.seq <= after) return;
          if (firstMonitor && after && event.seq > after + 1) skipped += event.seq - after - 1;
          firstMonitor = false;
        }
        const size = encoder.encode(JSON.stringify(event)).length;
        pending.push({ event, size });
        pendingBytes += size;
        while (pendingBytes > 1024 * 1024 || pending.length - head > 10_000) {
          const removed = pending[head++];
          pendingBytes -= removed.size;
          if (removed.event.type === "monitor") skipped++;
        }
        if (head >= 1024) { pending = pending.slice(head); head = 0; }
      });
      const timer = setInterval(flush, DIAGNOSTICS_BATCH_MS);
      const heartbeat = setInterval(() => {
        if (!closed && head === pending.length && !priority.size && (controller.desiredSize ?? 0) > 0) controller.enqueue(encoder.encode(": ping\n\n"));
      }, 15_000);
      stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        clearInterval(heartbeat);
        unsubscribe();
        pending = [];
        priority.clear();
        signal.removeEventListener("abort", stop);
        try { controller.close(); } catch { /* consumer already canceled */ }
      };
      signal.addEventListener("abort", stop, { once: true });
      if (signal.aborted) stop(); else flush();
    },
    cancel() { stop(); },
  }, { highWaterMark: 64 * 1024, size: (chunk) => chunk.byteLength });
}
