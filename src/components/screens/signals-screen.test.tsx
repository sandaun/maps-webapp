import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { XmlDocument } from "@/core/project-format";
import {
  projectFromXml as knxProjectFromXml,
  validateProject as validateKnx,
} from "@/gateway-families/knx-mbm";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import {
  projectFromXml as meProjectFromXml,
  validateProject as validateMe,
} from "@/gateway-families/me-mbs";
import { SYNTHETIC_ME_MBS_XML } from "@/gateway-families/me-mbs/fixtures/synthetic-project";
import { ADDRESS_MODES } from "@/protocols/modbus/slave";
import type { ProjectView } from "@/lib/project-types";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceChromeProvider } from "@/lib/workspace-chrome";
import { UndoToast } from "@/components/signals/undo-toast";
import { SignalsScreen } from "./signals-screen";

const mocks = vi.hoisted(() => ({
  applyPatches: vi.fn(),
  view: null as ProjectView | null,
  routerPush: vi.fn(),
  searchParams: new URLSearchParams(),
}));

function buildKnxView(): ProjectView {
  const project = knxProjectFromXml(XmlDocument.parse(SYNTHETIC_KNX_MBM_XML));
  return {
    meta: {
      id: "demo",
      name: "Demo project (synthetic)",
      description: "",
      source: "demo",
      family: "knx-mbm",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    family: "knx-mbm",
    project,
    issues: validateKnx(project),
    hasCompleteBlob: false,
  };
}

function buildMeView(): ProjectView {
  const project = meProjectFromXml(XmlDocument.parse(SYNTHETIC_ME_MBS_XML));
  return {
    meta: {
      id: "me",
      name: "ME test project",
      description: "",
      source: "file",
      family: "me-mbs",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    family: "me-mbs",
    project,
    issues: validateMe(project),
    hasCompleteBlob: false,
  };
}

vi.mock("next/navigation", () => ({
  usePathname: () => "/signals",
  useRouter: () => ({ push: mocks.routerPush }),
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/lib/current-project", () => ({
  useCurrentProject: () => ({
    projectId: mocks.view?.meta.id ?? null,
    loading: false,
    view: mocks.view,
    error: null,
    setProjectId: vi.fn(),
    refresh: vi.fn(),
    applyPatches: mocks.applyPatches,
  }),
  usePatch: () => mocks.applyPatches,
}));

function renderSignals() {
  return render(
    <WorkspaceChromeProvider>
      <TooltipProvider delayDuration={0}>
        <SignalsScreen />
        <UndoToast />
      </TooltipProvider>
    </WorkspaceChromeProvider>,
  );
}

beforeEach(() => {
  mocks.applyPatches.mockReset();
  mocks.routerPush.mockReset();
  mocks.searchParams = new URLSearchParams();
  window.localStorage.clear();
});

describe("SignalsScreen (knx-mbm)", () => {
  it("renders the signal table with formatted KNX/Modbus columns", () => {
    mocks.view = buildKnxView();
    renderSignals();

    expect(screen.getByText("Heat pump on/off")).toBeInTheDocument();
    expect(screen.getByText("Room temperature")).toBeInTheDocument();
    expect(screen.getByText("Heat pump on/off").parentElement).toHaveClass("text-text-body");
    expect(screen.getByText("1/0/3").parentElement).toHaveClass("text-hms-blue");
    expect(screen.getByText("1/0/3").parentElement).toHaveStyle({ backgroundColor: "#FFFFFF" });
    expect(screen.getByText("9.001").parentElement).toHaveClass("text-fg-muted");
    expect(screen.getByText("9.001").parentElement).toHaveStyle({ backgroundColor: "#FFFFFF" });
    expect(screen.getByRole("button", { name: "Flag U signal 0" })).toHaveClass("bg-hms-accent", "text-white");
    expect(screen.getAllByText("RTU 1")).toHaveLength(2);
    expect(screen.getByText((_, el) => el?.textContent === "2 shown · 2 active of 2")).toBeInTheDocument();
    const signalMapTab = screen.getByRole("tab", { name: /Signal map/ });
    const validationTab = screen.getByRole("tab", { name: /Validation/ });
    const allFilter = screen.getByRole("button", { name: /All/ });
    const errorsFilter = screen.getByRole("button", { name: /Errors/ });

    expect(signalMapTab).toHaveAttribute("aria-selected", "true");
    expect(signalMapTab).toHaveClass("font-bold");
    expect(validationTab).toHaveClass("font-normal");
    expect(allFilter).toHaveClass("font-bold");
    expect(errorsFilter).toHaveClass("font-normal");

    fireEvent.click(errorsFilter);
    expect(errorsFilter).toHaveClass("font-bold");
    expect(allFilter).toHaveClass("font-normal");
    expect(screen.getByRole("button", { name: "Check table" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import / export" })).toBeInTheDocument();
  });

  it("uses a subtle token without fading the whole disabled row", () => {
    const view = buildKnxView();
    if (view.family !== "knx-mbm") throw new Error("expected KNX-MBM project");
    view.project.signals[1].active = false;
    mocks.view = view;
    renderSignals();

    const descriptionCell = screen.getByText("Room temperature").parentElement;
    expect(descriptionCell).toHaveClass("text-fg-subtle");
    expect(descriptionCell?.parentElement).not.toHaveClass("opacity-[.45]");
    expect(screen.getByRole("button", { name: "Flag U signal 1" }).parentElement).toHaveClass("opacity-[.45]");
  });

  it("abbreviates column headers in compact mode and refits widths", async () => {
    mocks.view = buildKnxView();
    renderSignals();
    const ga = screen.getByRole("button", { name: "Resize Group address column" }).parentElement;
    expect(ga).toHaveStyle({ width: "118px" });
    expect(screen.getByText("Group address")).toBeInTheDocument();
    expect(screen.getByText("Direction")).toBeInTheDocument();
    expect(screen.getByText("GATEWAY")).toBeInTheDocument();
    expect(screen.getByText("3 · Holding registers")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Compact" }));
    expect(screen.getByText("GA")).toBeInTheDocument();
    expect(screen.getByText("DV")).toBeInTheDocument();
    expect(screen.getByText("GW")).toBeInTheDocument();
    expect(screen.getByText("DIR")).toBeInTheDocument();
    expect(screen.queryByText("Group address")).not.toBeInTheDocument();
    expect(screen.queryByText("3 · Holding registers")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(Number.parseInt(ga?.style.width ?? "0", 10)).toBeLessThan(118);
    });
    fireEvent.click(screen.getByRole("button", { name: "Compact" }));
    expect(screen.getByText("Group address")).toBeInTheDocument();
    expect(ga).toHaveStyle({ width: "118px" });
  });

  it("filters rows with the text search", () => {
    mocks.view = buildKnxView();
    renderSignals();
    fireEvent.change(screen.getByLabelText("Search signals"), { target: { value: "temperature" } });
    expect(screen.queryByText("Heat pump on/off")).not.toBeInTheDocument();
    expect(screen.getByText("Room temperature")).toBeInTheDocument();
  });

  it("resizes columns and restores their saved widths", () => {
    mocks.view = buildKnxView();
    const first = renderSignals();
    const handle = screen.getByRole("button", { name: "Resize Description column" });
    const header = handle.parentElement;
    expect(header).toHaveStyle({ width: "280px" });

    fireEvent(handle, new MouseEvent("pointerdown", { bubbles: true, clientX: 100 }));
    fireEvent(document, new MouseEvent("pointermove", { bubbles: true, clientX: 180 }));
    fireEvent(document, new MouseEvent("pointerup", { bubbles: true }));

    expect(header).toHaveStyle({ width: "360px" });
    expect(JSON.parse(window.localStorage.getItem("signals-grid-widths:knx-mbm:v1") ?? "{}")).toMatchObject({
      description: 360,
    });

    first.unmount();
    renderSignals();
    expect(screen.getByRole("button", { name: "Resize Description column" }).parentElement).toHaveStyle({
      width: "360px",
    });
  });

  it("keeps Reset widths on the frozen band and fits columns to their text", () => {
    mocks.view = buildKnxView();
    renderSignals();

    const reset = screen.getByRole("button", { name: "Reset widths" });
    expect(reset.parentElement?.parentElement?.textContent).toContain("PROJECT SIGNAL");

    const flagsHandle = screen.getByRole("button", { name: "Resize Flags column" });
    const flagsHeader = flagsHandle.parentElement;
    expect(flagsHeader).toHaveStyle({ width: "118px" });

    fireEvent(flagsHandle, new MouseEvent("pointerdown", { bubbles: true, clientX: 200 }));
    fireEvent(document, new MouseEvent("pointermove", { bubbles: true, clientX: 120 }));
    fireEvent(document, new MouseEvent("pointerup", { bubbles: true }));
    expect(flagsHeader).toHaveStyle({ width: "110px" });

    fireEvent.click(reset);
    expect(Number.parseInt(flagsHeader?.style.width ?? "0", 10)).toBeGreaterThanOrEqual(110);
    expect(
      Number.parseInt(screen.getByRole("button", { name: "Resize Slave column" }).parentElement?.style.width ?? "0", 10),
    ).toBeGreaterThanOrEqual(68);
    expect(
      Number.parseInt(screen.getByRole("button", { name: "Resize Description column" }).parentElement?.style.width ?? "0", 10),
    ).toBeGreaterThanOrEqual(200);
    expect(
      Number.parseInt(screen.getByRole("button", { name: "Resize Node column" }).parentElement?.style.width ?? "0", 10),
    ).toBeLessThan(160);
  });

  it("toggles a signal active state via a patch", async () => {
    mocks.applyPatches.mockResolvedValue(buildKnxView());
    mocks.view = buildKnxView();
    renderSignals();

    fireEvent.click(screen.getByLabelText("Active signal 0"));

    await waitFor(() => expect(mocks.applyPatches).toHaveBeenCalled());
    expect(mocks.applyPatches).toHaveBeenCalledWith([
      { type: "updateSignal", id: 0, patch: { active: false } },
    ]);
  });

  it("selects rows without opening a drawer and bulk-disables them", async () => {
    mocks.applyPatches.mockResolvedValue(buildKnxView());
    mocks.view = buildKnxView();
    renderSignals();

    fireEvent.click(screen.getByLabelText("Select signal 0"));
    fireEvent.click(screen.getByLabelText("Select signal 1"));

    expect(screen.queryByText("SIGNAL 0")).not.toBeInTheDocument();
    expect(screen.getByText("2 signals selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit field…" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Disable" }));

    await waitFor(() => expect(mocks.applyPatches).toHaveBeenCalled());
    expect(mocks.applyPatches).toHaveBeenCalledWith([
      { type: "updateSignal", id: 0, patch: { active: false } },
      { type: "updateSignal", id: 1, patch: { active: false } },
    ]);
  });

  it("edits a description inline on Enter and does not open the drawer", async () => {
    mocks.applyPatches.mockResolvedValue(buildKnxView());
    mocks.view = buildKnxView();
    renderSignals();

    fireEvent.click(screen.getByText("Heat pump on/off"));
    expect(screen.queryByText("SIGNAL 0")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save signal" })).not.toBeInTheDocument();

    const input = screen.getByLabelText("Edit Description signal 0");
    fireEvent.change(input, { target: { value: "HP command" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(mocks.applyPatches).toHaveBeenCalled());
    expect(mocks.applyPatches).toHaveBeenCalledWith([
      { type: "updateSignal", id: 0, patch: { description: "HP command" } },
    ]);
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("cancels an inline edit on Escape without saving", () => {
    mocks.view = buildKnxView();
    renderSignals();

    fireEvent.click(screen.getByText("Heat pump on/off"));
    const input = screen.getByLabelText("Edit Description signal 0");
    fireEvent.change(input, { target: { value: "nope" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(mocks.applyPatches).not.toHaveBeenCalled();
    expect(screen.getByText("Heat pump on/off")).toBeInTheDocument();
  });

  it("opens a select dropdown on the first click", () => {
    mocks.view = buildKnxView();
    renderSignals();

    fireEvent.click(screen.getByText("1.001"));

    expect(screen.getByRole("combobox", { name: "Edit DPT signal 0" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    // DPT lists far more than 8 options, so the search box takes the focus.
    expect(screen.getByRole("textbox", { name: "Search options" })).toHaveFocus();
  });

  it("queues two rapid saves on the same cell so the last value is sent", async () => {
    let release!: (value: ProjectView) => void;
    const first = new Promise<ProjectView>((resolve) => {
      release = resolve;
    });
    mocks.applyPatches.mockImplementationOnce(() => first).mockResolvedValue(buildKnxView());
    mocks.view = buildKnxView();
    renderSignals();

    fireEvent.click(screen.getByText("Heat pump on/off"));
    const firstInput = screen.getByLabelText("Edit Description signal 0");
    fireEvent.change(firstInput, { target: { value: "one" } });
    fireEvent.keyDown(firstInput, { key: "Enter" });

    fireEvent.click(screen.getByText("Heat pump on/off"));
    const secondInput = screen.getByLabelText("Edit Description signal 0");
    fireEvent.change(secondInput, { target: { value: "two" } });
    fireEvent.keyDown(secondInput, { key: "Enter" });

    expect(mocks.applyPatches).toHaveBeenCalledTimes(1);
    release(buildKnxView());

    await waitFor(() => expect(mocks.applyPatches).toHaveBeenCalledTimes(2));
    expect(mocks.applyPatches.mock.calls[1][0]).toEqual([
      { type: "updateSignal", id: 0, patch: { description: "two" } },
    ]);
  });

  it("applies a bulk Edit field… patch to the selection", async () => {
    mocks.applyPatches.mockResolvedValue(buildKnxView());
    mocks.view = buildKnxView();
    renderSignals();

    fireEvent.click(screen.getByLabelText("Select signal 0"));
    fireEvent.click(screen.getByLabelText("Select signal 1"));
    fireEvent.click(screen.getByRole("button", { name: "Edit field…" }));

    fireEvent.change(screen.getByLabelText("Bulk value"), { target: { value: "Shared name" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(mocks.applyPatches).toHaveBeenCalled());
    expect(mocks.applyPatches).toHaveBeenCalledWith([
      { type: "updateSignal", id: 0, patch: { description: "Shared name" } },
      { type: "updateSignal", id: 1, patch: { description: "Shared name" } },
    ]);
  });

  it("selects the current page from the header, then all matching rows", () => {
    const view = buildKnxView();
    if (view.family !== "knx-mbm") throw new Error("expected knx");
    const extra = Array.from({ length: 100 }, (_, i) => ({
      ...view.project.signals[0],
      id: i + 10,
      description: `Extra ${i}`,
    }));
    view.project.signals = [...view.project.signals, ...extra];
    mocks.view = view;
    renderSignals();

    fireEvent.click(screen.getByLabelText("Select all signals"));
    expect(screen.getByText("100 signals selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select all 102 matching" }));
    expect(screen.getByText("102 signals selected")).toBeInTheDocument();
  });

  it("switches to Validation and Import & export tabs", async () => {
    mocks.view = buildKnxView();
    renderSignals();

    fireEvent.click(screen.getByRole("tab", { name: /Validation/ }));
    expect(screen.getByRole("tab", { name: /Validation/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Configuration validation")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Import & export" }));
    expect(screen.getByText("Import signals from XLSX")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Whole project/ })).toBeInTheDocument();
  });

  it("opens the column picker and hides a column", () => {
    mocks.view = buildKnxView();
    renderSignals();
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    expect(screen.getByRole("button", { name: "GROUP ADDRESS" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "GROUP ADDRESS" }));
    expect(screen.queryByText("1/0/3")).not.toBeInTheDocument();
  });

  it("Check table shows a banner then opens Validation", async () => {
    mocks.view = buildKnxView();
    renderSignals();
    fireEvent.click(screen.getByRole("button", { name: "Check table" }));
    expect(screen.getByText(/Checking the signal table/)).toBeInTheDocument();
    await waitFor(
      () => expect(screen.getByText("Configuration validation")).toBeInTheDocument(),
      { timeout: 1500 },
    );
  });

  it("undos the last inline save from the toast", async () => {
    mocks.applyPatches.mockResolvedValue(buildKnxView());
    mocks.view = buildKnxView();
    renderSignals();

    fireEvent.click(screen.getByText("Heat pump on/off"));
    const input = screen.getByLabelText("Edit Description signal 0");
    fireEvent.change(input, { target: { value: "HP command" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(mocks.applyPatches).toHaveBeenCalledTimes(2));
    expect(mocks.applyPatches.mock.calls[1][0]).toEqual([
      { type: "updateSignal", id: 0, patch: { description: "Heat pump on/off" } },
    ]);
  });
});

describe("SignalsScreen (me-mbs)", () => {
  it("renders me-mbs columns: AC parameter, controller/group, register, access", () => {
    mocks.view = buildMeView();
    renderSignals();

    expect(screen.getByText("AC parameter")).toBeInTheDocument();
    expect(screen.getByText("Controller")).toBeInTheDocument();
    expect(screen.getByText("Group")).toBeInTheDocument();
    expect(screen.getByText("Access")).toBeInTheDocument();
    expect(screen.queryByText("Group address")).not.toBeInTheDocument();
    expect(screen.queryByText("DPT")).not.toBeInTheDocument();

    expect(screen.getByText("Centralized controller communication error")).toBeInTheDocument();
    expect(screen.getByText("Room Humidity")).toBeInTheDocument();
    expect(screen.getAllByText("Controller-wide")).toHaveLength(2);
    expect(screen.getAllByText(/C1 · G1 — Office/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Control").length).toBeGreaterThan(0);
    expect(screen.getAllByText("→").length).toBeGreaterThan(0);
    fireEvent.mouseEnter(screen.getAllByText("→")[0]);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Control · trigger");
    expect(screen.queryByRole("button", { name: "Add signal" })).not.toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.textContent === "9 shown · 9 active of 9")).toBeInTheDocument();
  });

  it("keeps generated ME descriptions and fixed register addresses read-only", () => {
    mocks.view = buildMeView();
    renderSignals();

    const desc = screen.getByText(/On\/Off\s+/);
    fireEvent.click(desc);
    fireEvent.click(screen.getByText("100"));
    expect(screen.queryByLabelText("Edit Description signal 2")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Edit Register signal 2")).not.toBeInTheDocument();
    expect(mocks.applyPatches).not.toHaveBeenCalled();
  });

  it("edits only the ME register when address mode is custom", async () => {
    const view = buildMeView();
    if (view.family !== "me-mbs") throw new Error("Expected ME-MBS view");
    view.project.mbs.addressMode = ADDRESS_MODES.CUSTOM;
    mocks.applyPatches.mockResolvedValue(view);
    mocks.view = view;
    renderSignals();

    fireEvent.click(screen.getByText("100"));
    fireEvent.change(screen.getByLabelText("Edit Register signal 2"), { target: { value: "500" } });
    fireEvent.keyDown(screen.getByLabelText("Edit Register signal 2"), { key: "Enter" });

    await waitFor(() => expect(mocks.applyPatches).toHaveBeenCalledTimes(1));
    expect(mocks.applyPatches.mock.calls[0][0]).toEqual([
      { type: "updateSignal", id: 2, patch: { modbus: { address: 500 } } },
    ]);
  });
});
