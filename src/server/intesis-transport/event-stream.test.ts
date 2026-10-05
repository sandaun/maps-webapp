// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionEventStream } from "./event-stream";
import type { SessionEventListener } from "./manager";

afterEach(() => vi.useRealTimers());
describe("bounded session SSE", () => {
  it("coalesces ordered lines and cleans up on cancel without notifying the transport", async () => {
    vi.useFakeTimers();
    let send!: SessionEventListener;
    const unsubscribe = vi.fn();
    const stream = sessionEventStream((listener) => { send = listener; return unsubscribe; }, new AbortController().signal);
    for (let seq = 1; seq <= 500; seq++) send({ type: "monitor", seq, at: "now", line: `line ${seq}` });
    await vi.advanceTimersByTimeAsync(100);
    const reader = stream.getReader();
    const packet = new TextDecoder().decode((await reader.read()).value);
    const body = JSON.parse(packet.split("data: ")[1]);
    expect(body.events.map((entry: { seq: number }) => entry.seq)).toEqual(Array.from({ length: 500 }, (_, i) => i + 1));
    expect(packet).toContain("id: 500");
    await reader.cancel();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(() => send({ type: "monitor", seq: 501, at: "now", line: "late" })).not.toThrow();
    await vi.advanceTimersByTimeAsync(30_000);
  });

  it("caps a stalled preview and counts skipped lines; reconnect replay is deduplicated", async () => {
    vi.useFakeTimers();
    let send!: SessionEventListener;
    const abort = new AbortController();
    const stream = sessionEventStream((listener) => { send = listener; return () => {}; }, abort.signal, 100);
    send({ type: "monitor", seq: 99, at: "now", line: "already delivered" });
    for (let seq = 101; seq <= 25_100; seq++) send({ type: "monitor", seq, at: "now", line: "X".repeat(200) });
    await vi.advanceTimersByTimeAsync(100);
    const reader = stream.getReader();
    const packet = new TextDecoder().decode((await reader.read()).value);
    const body = JSON.parse(packet.split("data: ")[1]);
    expect(body.events[0]).toMatchObject({ type: "gap" });
    expect(body.events[0].dropped).toBeGreaterThan(20_000);
    expect(body.events.some((event: { seq?: number }) => event.seq === 99)).toBe(false);
    abort.abort();
    await reader.cancel();
  });
});
