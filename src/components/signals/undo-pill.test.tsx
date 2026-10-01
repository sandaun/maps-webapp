import * as React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceChromeProvider, useWorkspaceChrome } from "@/lib/workspace-chrome";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SignalsGrid } from "./signals-grid";
import { SignalsWorkspace } from "./signals-workspace";
import { KNX_GROUP_LABELS } from "./types";
import { UndoPill } from "./undo-pill";

const applyPatches = vi.hoisted(() => vi.fn());
vi.mock("@/lib/current-project", () => ({ usePatch: () => applyPatches }));
beforeEach(() => applyPatches.mockReset().mockResolvedValue(undefined));

function Harness() {
  const { pushUndo } = useWorkspaceChrome();
  const [count, setCount] = React.useState(2);
  const [map, setMap] = React.useState(true);
  return <>
    <button onClick={() => pushUndo({ label: "Disabled 2 signals", patches: [{ type: "updateSignal", id: 0, patch: { active: true } }] })}>Save changes</button>
    <button onClick={() => pushUndo({ label: "Enabled 2 signals", patches: [] })}>Save again</button>
    <button onClick={() => setMap(false)}>Leave map</button>
    <input aria-label="Edit name" /><textarea aria-label="Edit notes" />
    <div contentEditable suppressContentEditableWarning aria-label="Rich text">Text</div>
    <div role="dialog" aria-label="Editor"><button>Dialog action</button></div>
    {map && <SignalsWorkspace selectedCount={count} matchingCount={2} pageFullySelected={false} onClear={() => setCount(0)}
      onEnable={() => {}} onDisable={() => {}} onSelectAllMatching={() => {}}>
      <SignalsGrid rows={[{ id: 0, name: "Last row" }]} columns={[{ id: "name", group: "project", header: "Name", width: 180, kind: "text", getText: (row) => row.name }]}
        groupLabels={KNX_GROUP_LABELS} rowId={(row) => row.id} rowActive={() => true} selected={new Set([0])} pageIds={[0]}
        onToggle={() => {}} onTogglePage={() => {}} applyPatches={applyPatches} tabOrder={["name"]} widthStorageKey="undo-pill-test" />
    </SignalsWorkspace>}
    <UndoPill />
  </>;
}

function start() {
  render(<WorkspaceChromeProvider><TooltipProvider><Harness /></TooltipProvider></WorkspaceChromeProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
}

describe("independent undo pill", () => {
  it("shows nothing until an action is available", () => {
    render(<WorkspaceChromeProvider><UndoPill /></WorkspaceChromeProvider>);
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("keeps Undo separate from selection and reserves space for both", async () => {
    start();
    const slot = screen.getByTestId("signals-undo-slot");
    expect(within(slot).getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(within(screen.getByRole("toolbar")).queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    expect(screen.getByTestId("signals-scroll")).toHaveStyle({ scrollPaddingBottom: "132px" });
    const bottom = slot.style.bottom;
    const clear = screen.getByRole("button", { name: "Clear selection" });
    clear.focus();
    fireEvent.click(clear);
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(slot.style.bottom).toBe(bottom);
    expect(screen.getByTestId("signals-scroll")).toHaveFocus();
    const undo = screen.getByRole("button", { name: "Undo" });
    undo.focus();
    fireEvent.click(undo);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument());
    expect(applyPatches).toHaveBeenCalledWith([{ type: "updateSignal", id: 0, patch: { active: true } }]);
    expect(screen.getByTestId("signals-scroll")).toHaveFocus();
    expect(screen.getByTestId("signals-scroll").style.scrollPaddingBottom).toBe("");
  });

  it.each([{ ctrlKey: true }, { metaKey: true }])("keeps keyboard Undo after dismissing the pill (%j)", async (modifier) => {
    start();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss undo" }));
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("signals-scroll")).toHaveStyle({ scrollPaddingBottom: "80px" });
    fireEvent.keyDown(screen.getByTestId("signals-scroll"), { key: "z", ...modifier });
    await waitFor(() => expect(applyPatches).toHaveBeenCalledOnce());
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
  });

  it("leaves text editing, dialogs and redo shortcuts alone", () => {
    start();
    for (const element of [screen.getByLabelText("Edit name"), screen.getByLabelText("Edit notes"), screen.getByLabelText("Rich text"), screen.getByRole("button", { name: "Dialog action" })]) {
      fireEvent.keyDown(element, { key: "z", ctrlKey: true });
    }
    fireEvent.keyDown(screen.getByTestId("signals-scroll"), { key: "z", ctrlKey: true, shiftKey: true });
    expect(applyPatches).not.toHaveBeenCalled();
  });

  it("keeps one Undo outside the map", () => {
    start();
    fireEvent.click(screen.getByRole("button", { name: "Leave map" }));
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("signals-undo-slot")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(1);
  });

  it("blocks repeated Undo and dismissal while a request is pending", async () => {
    let finish!: () => void;
    applyPatches.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    start();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.keyDown(screen.getByTestId("signals-scroll"), { key: "z", ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss undo" }));
    expect(applyPatches).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Undo" })).toHaveAttribute("aria-busy", "true");
    await act(async () => finish());
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("reveals a failed keyboard Undo after dismissal and keeps it retryable", async () => {
    applyPatches.mockRejectedValueOnce(new Error("Connection lost"));
    start();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss undo" }));
    fireEvent.keyDown(screen.getByTestId("signals-scroll"), { key: "z", ctrlKey: true });
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
    fireEvent.click(screen.getByRole("button", { name: "Save again" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Enabled 2 signals");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument());
  });

  it("preserves a newer Undo entry when an earlier request finishes", async () => {
    let finish!: () => void;
    applyPatches.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    start();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Save again" }));
    await act(async () => finish());
    expect(screen.getByRole("status")).toHaveTextContent("Enabled 2 signals");
    expect(screen.getByRole("button", { name: "Undo" })).not.toHaveAttribute("aria-busy");
  });
});
