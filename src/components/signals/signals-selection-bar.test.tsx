import * as React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignalsSelectionBar, type SignalSelectionActions } from "./signals-selection-bar";
import { SignalsWorkspace } from "./signals-workspace";
import { SignalsGrid } from "./signals-grid";
import { TooltipProvider } from "@/components/ui/tooltip";
import { KNX_GROUP_LABELS } from "./types";

afterEach(() => vi.restoreAllMocks());

function options(overrides: Partial<SignalSelectionActions> = {}): SignalSelectionActions {
  return {
    selectedCount: 2, matchingCount: 117, pageFullySelected: false,
    onEnable: vi.fn(), onDisable: vi.fn(), onClear: vi.fn(), onDelete: vi.fn(),
    onEditField: vi.fn(), onAutoNumber: vi.fn(), onConversions: vi.fn(), onSelectAllMatching: vi.fn(),
    ...overrides,
  };
}

function width(pixels: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: pixels, height: 40, top: 0, bottom: 40, left: 0, right: pixels, x: 0, y: 0, toJSON: () => ({}),
  });
}

describe("floating selection actions", () => {
  it("keeps labels and requires a second click before deleting", () => {
    const props = options();
    render(<SignalsSelectionBar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    expect(props.onDisable).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Delete 2" }));
    expect(props.onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(props.onDelete).toHaveBeenCalledOnce();
  });

  it("keeps overflow actions reachable and cancels deletion when More closes", async () => {
    width(600);
    const props = options();
    render(<SignalsSelectionBar {...props} />);
    expect(screen.getByRole("button", { name: "Edit field…" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Number addresses…" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More selection actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Number addresses…" }));
    expect(props.onAutoNumber).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "More selection actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete 2" }));
    expect(props.onDelete).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("button", { name: "Confirm delete" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "More selection actions" }));
    expect(screen.getByRole("button", { name: "Delete 2" })).toBeInTheDocument();
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it("moves state actions into More on a narrow pane", () => {
    width(300);
    const props = options();
    render(<SignalsSelectionBar {...props} />);
    expect(screen.queryByRole("button", { name: "Enable" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More selection actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    expect(props.onEnable).toHaveBeenCalledOnce();
  });

  it("only offers the actions supported by the current family", () => {
    width(600);
    render(<SignalsSelectionBar {...options({ onDelete: undefined, onEditField: undefined, onConversions: undefined })} />);
    expect(screen.getByRole("button", { name: "Number addresses…" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More selection actions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete|Conversions|Edit field|Move up/ })).not.toBeInTheDocument();
  });

  it("keeps all actions reachable when the pane is too small for Edit field", () => {
    width(220);
    const props = options();
    render(<SignalsSelectionBar {...props} />);
    expect(screen.queryByRole("button", { name: "Edit field…" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More selection actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit field…" }));
    expect(props.onEditField).toHaveBeenCalledOnce();
  });

  it("requires confirmation again if the selection count changes", () => {
    const props = options();
    const { rerender } = render(<SignalsSelectionBar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete 2" }));
    rerender(<SignalsSelectionBar {...props} selectedCount={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete 3" }));
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Confirm delete" })).toBeInTheDocument();
  });

  it("preserves Select all matching in the floating bar", () => {
    const props = options({ pageFullySelected: true });
    render(<SignalsSelectionBar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Select all 117 matching" }));
    expect(props.onSelectAllMatching).toHaveBeenCalledOnce();
  });
});

function Workspace() {
  const [count, setCount] = React.useState(2);
  return (
    <TooltipProvider>
      <SignalsWorkspace {...options({ selectedCount: count, onClear: () => setCount(0) })}>
        <input aria-label="Search signals" />
        <div role="dialog" aria-label="Editor"><button>Close editor</button></div>
        <SignalsGrid rows={[{ id: 0, name: "Last row" }]} columns={[{ id: "name", group: "project", header: "Name", width: 180, kind: "text", getText: (row) => row.name }]}
          groupLabels={KNX_GROUP_LABELS} rowId={(row) => row.id} rowActive={() => true} selected={new Set([0])} pageIds={[0]}
          onToggle={() => {}} onTogglePage={() => {}} applyPatches={vi.fn()} tabOrder={["name"]} widthStorageKey="selection-bar-test" />
      </SignalsWorkspace>
    </TooltipProvider>
  );
}

describe("selection bar in the grid", () => {
  it("leaves scroll space below the last row and returns focus when cleared", () => {
    render(<Workspace />);
    const grid = screen.getByTestId("signals-scroll");
    expect(grid).toHaveStyle({ scrollPaddingBottom: "80px" });
    expect(within(grid).queryByRole("toolbar")).not.toBeInTheDocument();
    const clear = screen.getByRole("button", { name: "Clear selection" });
    clear.focus();
    fireEvent.click(clear);
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(grid).toHaveFocus();
    expect(grid.style.scrollPaddingBottom).toBe("");
  });

  it("lets editors and More consume Escape before clearing the selection", async () => {
    width(600);
    render(<Workspace />);
    fireEvent.keyDown(screen.getByLabelText("Search signals"), { key: "Escape" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Close editor" }), { key: "Escape" });
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More selection actions" }));
    const menu = screen.getByRole("dialog", { name: "More selection actions" });
    fireEvent.keyDown(within(menu).getByRole("button", { name: "Number addresses…" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "More selection actions" })).not.toBeInTheDocument());
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: "Clear selection" }), { key: "Escape" });
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });
});
