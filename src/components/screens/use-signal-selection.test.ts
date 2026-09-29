import { act, renderHook } from "@testing-library/react";
import type { ProjectView } from "@/lib/project-types";
import { PROJECT_PATCHED_EVENT } from "@/lib/project-events";
import { describe, expect, it } from "vitest";
import { useSignalSelection } from "./use-signal-selection";

const ids = [0, 1, 2, 3, 4, 5];

function setup() {
  return renderHook(() => useSignalSelection(ids));
}

const selectedOf = (result: { current: ReturnType<typeof useSignalSelection> }) =>
  [...result.current.selected].sort((a, b) => a - b);

describe("useSignalSelection ranges", () => {
  it("selects from the anchor in either direction, in the given order", () => {
    const { result } = setup();
    act(() => result.current.toggle(4));
    act(() => result.current.toggle(1, ids));
    expect(selectedOf(result)).toEqual([1, 2, 3, 4]);
    // A filtered order only covers the rows shown between the two clicks.
    act(() => result.current.clear());
    act(() => result.current.toggle(0));
    act(() => result.current.toggle(5, [0, 2, 5]));
    expect(selectedOf(result)).toEqual([0, 2, 5]);
  });

  it("clears the range when the Shift+clicked row was selected", () => {
    const { result } = setup();
    act(() => result.current.toggle(0));
    act(() => result.current.toggle(5, ids));
    act(() => result.current.toggle(2, ids));
    expect(selectedOf(result)).toEqual([0, 1]);
  });

  it("falls back to a single toggle without an anchor in the order", () => {
    const { result } = setup();
    act(() => result.current.toggle(3, ids));
    expect(selectedOf(result)).toEqual([3]);
    act(() => result.current.clear());
    act(() => result.current.toggle(1, [0, 1, 2]));
    expect(selectedOf(result)).toEqual([1]);
    act(() => result.current.toggle(4, [0, 2]));
    expect(selectedOf(result)).toEqual([1, 4]);
  });

  it("keeps the Shift+click anchor on the same row after a move", () => {
    const { result } = setup();
    const viewOf = (count: number) => ({ project: { signals: Array.from({ length: count }, (_, id) => ({ id })) } }) as unknown as ProjectView;
    act(() => result.current.toggle(1));
    // Signal 1 moves to position 4: its ID becomes 4.
    act(() => window.dispatchEvent(new CustomEvent(PROJECT_PATCHED_EVENT, {
      detail: { before: viewOf(6), next: viewOf(6), patches: [{ type: "moveSignal", id: 1, toIndex: 4 }] },
    })));
    expect(selectedOf(result)).toEqual([4]);
    act(() => result.current.toggle(2, ids));
    expect(selectedOf(result)).toEqual([2, 3, 4]);
  });
});
