import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionEvents } from "./use-session-events";

class FakeEventSource {
  static instance: FakeEventSource;
  onmessage?: (message: { data: string }) => void;
  onerror?: () => void;
  onopen?: () => void;
  close = vi.fn();
  constructor() { FakeEventSource.instance = this; }
  emit(events: unknown[]) { this.onmessage?.({ data: JSON.stringify({ type: "batch", events }) }); }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("batched browser session events", () => {
  it("keeps 10,000 ordered rows, deduplicates replay, preserves status and reports preview gaps", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    const { result, unmount } = renderHook(() => useSessionEvents("session"));
    const events = Array.from({ length: 15_000 }, (_, i) => ({ type: "monitor", seq: i + 1, at: "now", line: `line ${i + 1}` }));
    act(() => FakeEventSource.instance.emit(events));
    expect(result.current.monitor).toHaveLength(0);
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(result.current.monitor).toHaveLength(10_000);
    expect([result.current.monitor[0].seq, result.current.monitor.at(-1)!.seq]).toEqual([5001, 15_000]);
    act(() => FakeEventSource.instance.emit([events.at(-1), { type: "gap", dropped: 42 }, { type: "status", at: "now", status: { connected: false } }]));
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(result.current.monitor).toHaveLength(10_000);
    expect(result.current.dropped).toBe(42);
    expect(result.current.status?.connected).toBe(false);
    unmount();
    expect(FakeEventSource.instance.close).toHaveBeenCalledOnce();
  });
});
