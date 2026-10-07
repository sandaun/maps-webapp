import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrafficList } from "./traffic-list";
import { parseMonitorLine } from "@/lib/diagnostics-parsing";

const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.dataset.testid === "traffic-viewport" ? 480 : 28; });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(480);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
    const height = (this.lastElementChild as HTMLElement | null)?.style.height;
    return height ? Number.parseFloat(height) + 28 : 0;
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: function (this: HTMLElement, options: ScrollToOptions) {
    this.scrollTop = options.top ?? 0;
    this.scrollLeft = options.left ?? 0;
    this.dispatchEvent(new Event("scroll"));
  } });
});
afterEach(() => {
  vi.restoreAllMocks();
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollTo", scrollDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

describe("virtualized traffic scrolling", () => {
  it("follows a changing tail even with a fixed row count, and jumps back after disabling/re-enabling", async () => {
    const frames = Array.from({ length: 10_000 }, (_, i) => parseMonitorLine(`1MM:RTUB line ${i + 1}`, i + 1, "2026-10-05T10:00:00.000Z"));
    const props = { frames, matches: new Map(), showSignals: false, showTimestamp: true, following: true, onReadHistory: vi.fn(), emptyMessage: "Empty" };
    let rendered: ReturnType<typeof render>;
    await act(async () => { rendered = render(<TrafficList {...props} />); });
    const rerender = rendered!.rerender;
    const viewport = screen.getByTestId("traffic-viewport");
    await waitFor(() => expect(viewport.scrollTop).toBeGreaterThan(270_000));
    expect(document.querySelectorAll("[data-frame-id]").length).toBeLessThan(100);
    await act(async () => { rerender(<TrafficList {...props} following={false} />); });
    viewport.scrollTop = 28_000;
    await act(async () => { fireEvent.scroll(viewport); });
    expect(viewport.scrollTop).toBe(28_000);
    const shifted = [...frames.slice(1000), ...Array.from({ length: 1000 }, (_, i) => parseMonitorLine(`1MM:RTUB line ${10_001 + i}`, 10_001 + i, "2026-10-05T10:00:00.000Z"))];
    await act(async () => { rerender(<TrafficList {...props} frames={shifted} following={true} />); });
    await waitFor(() => expect(viewport.scrollTop).toBeGreaterThan(270_000));
    await waitFor(() => expect(document.querySelector('[data-frame-id="11000"]')).toBeInTheDocument());
    fireEvent.keyDown(viewport, { key: "PageUp" });
    expect(props.onReadHistory).toHaveBeenCalledOnce();
    fireEvent.wheel(viewport, { deltaY: -120 });
    expect(props.onReadHistory).toHaveBeenCalledTimes(2);
  });
});
