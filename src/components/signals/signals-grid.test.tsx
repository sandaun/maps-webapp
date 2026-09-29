import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceChromeProvider, useWorkspaceChrome } from "@/lib/workspace-chrome";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ProjectPatchInput } from "@/lib/project-types";
import { PROJECT_PATCHED_EVENT } from "@/lib/project-events";
import { SignalsGrid } from "./signals-grid";
import { SignalsWorkspace } from "./signals-workspace";
import { KNX_GROUP_LABELS, type GridColumn } from "./types";
import { useSignalReorder } from "./use-signal-reorder";

type Row = { id: number; name: string };
const columns: GridColumn<Row>[] = [{
  id: "name", group: "project", header: "Name", width: 180, frozen: true, kind: "text",
  getText: (row) => row.name, parse: (_row, raw) => ({ patch: { description: raw } }),
}];

function UndoProbe() {
  const { undo } = useWorkspaceChrome();
  return <output data-testid="undo">{JSON.stringify(undo)}</output>;
}

interface Options {
  filtered?: boolean;
  enabled?: boolean;
  apply?: (patches: ProjectPatchInput[]) => Promise<unknown>;
  ids?: number[];
  pageIds?: number[];
  selected?: number[];
}

function Harness({ apply, onMoved, options }: { apply: (patches: ProjectPatchInput[]) => Promise<unknown>; onMoved: (index: number) => void; options: Options }) {
  const ids = options.ids ?? [0, 1, 2];
  const pageIds = options.pageIds ?? ids;
  const selected = React.useMemo(() => new Set(options.selected), [options.selected]);
  const reorder = useSignalReorder({ signalIds: ids, selected, filtered: !!options.filtered, applyPatches: apply, onMoved });
  const enabled = options.enabled !== false;
  return (
    <SignalsWorkspace
      selectedCount={selected.size} matchingCount={ids.length} pageFullySelected={false}
      onEnable={() => {}} onDisable={() => {}} onClear={() => {}} onSelectAllMatching={() => {}}
      reorder={enabled ? reorder : undefined}
    >
      <SignalsGrid rows={pageIds.map((id) => ({ id, name: `row ${id}` }))} columns={columns} groupLabels={KNX_GROUP_LABELS}
        rowId={(row) => row.id} rowActive={() => true} selected={selected} pageIds={pageIds}
        onToggle={() => {}} onTogglePage={() => {}} applyPatches={apply} tabOrder={["name"]}
        widthStorageKey="test-move" reorder={enabled ? reorder : undefined} />
    </SignalsWorkspace>
  );
}

function setup(options: Options = {}) {
  const apply = options.apply ?? vi.fn().mockResolvedValue({});
  const onMoved = vi.fn();
  render(
    <WorkspaceChromeProvider>
      <TooltipProvider>
        <Harness apply={apply} onMoved={onMoved} options={options} />
        <UndoProbe />
      </TooltipProvider>
    </WorkspaceChromeProvider>,
  );
  return { apply, onMoved };
}

const up = () => screen.getByRole("button", { name: "Move up" });
const down = () => screen.getByRole("button", { name: "Move down" });
const rowOf = (id: number) => screen.getByRole("button", { name: `Move signal ${id}` }).closest("[data-signal-id]")!;

function drag(from: number, to: number) {
  const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(screen.getByRole("button", { name: `Move signal ${from}` }), { dataTransfer });
  fireEvent.dragOver(rowOf(to), { dataTransfer });
  fireEvent.drop(rowOf(to), { dataTransfer });
}

describe("shared signal reordering", () => {
  it("moves a selected block with one inverse and disables the starting boundary", async () => {
    const { apply, onMoved } = setup({ selected: [1, 0] });
    expect(up()).toBeDisabled();
    fireEvent.click(down());
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith(1));
    expect(apply).toHaveBeenCalledExactlyOnceWith([{ type: "moveSignal", id: 0, count: 2, toIndex: 1 }]);
    expect(JSON.parse(screen.getByTestId("undo").textContent!).patches).toEqual([{ type: "moveSignal", id: 1, count: 2, toIndex: 0 }]);
  });

  it("moves a single selected row and disables the ending boundary", async () => {
    const { apply } = setup({ selected: [2] });
    expect(down()).toBeDisabled();
    fireEvent.click(up());
    await waitFor(() => expect(apply).toHaveBeenCalledWith([{ type: "moveSignal", id: 2, toIndex: 1 }]));
    expect(screen.getByTestId("undo")).toHaveTextContent('"patches":[{"type":"moveSignal","id":1,"toIndex":2}]');
  });

  it("moves the selection across a page boundary", async () => {
    const { apply, onMoved } = setup({ ids: Array.from({ length: 102 }, (_, index) => index), pageIds: [100, 101], selected: [100] });
    fireEvent.click(up());
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith(99));
    expect(apply).toHaveBeenCalledWith([{ type: "moveSignal", id: 100, toIndex: 99 }]);
  });

  it("rejects a discontinuous selection without sending a patch", () => {
    const { apply } = setup({ selected: [0, 2] });
    fireEvent.click(down());
    expect(screen.getByRole("alert")).toHaveTextContent("Select consecutive rows");
    expect(apply).not.toHaveBeenCalled();
  });

  it("drags a single row even with several selected rows, and ignores a same-row drop", async () => {
    const { apply } = setup({ selected: [0, 1] });
    drag(0, 0);
    expect(apply).not.toHaveBeenCalled();
    drag(0, 2);
    await waitFor(() => expect(apply).toHaveBeenCalledWith([{ type: "moveSignal", id: 0, toIndex: 2 }]));
    expect(screen.getByTestId("undo")).toHaveTextContent('"patches":[{"type":"moveSignal","id":2,"toIndex":0}]');
  });

  it("disables moves in a filtered view", () => {
    const { apply } = setup({ filtered: true, selected: [1] });
    expect(screen.getByRole("button", { name: "Move signal 1" })).toBeDisabled();
    expect(up()).toBeDisabled();
    expect(down()).toBeDisabled();
    drag(1, 2);
    expect(apply).not.toHaveBeenCalled();
  });

  it("does not expose controls for a family without reordering", () => {
    setup({ enabled: false, selected: [1] });
    expect(screen.queryByRole("button", { name: /Move signal/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move up" })).not.toBeInTheDocument();
  });

  it("reports failures without recording an inverse", async () => {
    setup({ apply: vi.fn().mockRejectedValue(new Error("Conflict")), selected: [1] });
    fireEvent.click(up());
    expect(await screen.findByRole("alert")).toHaveTextContent("Conflict");
    expect(screen.getByTestId("undo")).toHaveTextContent("null");
  });

  it("ignores repeated clicks while a move is saving", async () => {
    let finish!: () => void;
    const apply = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    setup({ apply, selected: [1] });
    fireEvent.click(up());
    fireEvent.click(down());
    expect(apply).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });

  it("closes an unsaved editor when undo renumbers its row", () => {
    const { apply } = setup();
    fireEvent.click(screen.getByText("row 1"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "draft" } });
    expect(screen.getByRole("button", { name: "Move signal 1" })).toBeDisabled();
    act(() => window.dispatchEvent(new CustomEvent(PROJECT_PATCHED_EVENT, {
      detail: { patches: [{ type: "moveSignal", id: 1, toIndex: 0 }] },
    })));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
  });
});
