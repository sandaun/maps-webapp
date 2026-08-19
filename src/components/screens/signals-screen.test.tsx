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
import { WorkspaceChromeProvider } from "@/lib/workspace-chrome";
import { UndoToast } from "@/components/signals/undo-toast";
import { SignalsScreen } from "./signals-screen";

const mocks = vi.hoisted(() => ({
  applyPatches: vi.fn(),
  view: null as ProjectView | null,
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
      <SignalsScreen />
      <UndoToast />
    </WorkspaceChromeProvider>,
  );
}

beforeEach(() => {
  mocks.applyPatches.mockReset();
  window.localStorage.clear();
});

describe("SignalsScreen (knx-mbm)", () => {
  it("renders the signal table with formatted KNX/Modbus columns", () => {
    mocks.view = buildKnxView();
    renderSignals();

    expect(screen.getByText("Heat pump on/off")).toBeInTheDocument();
    expect(screen.getByText("Room temperature")).toBeInTheDocument();
    expect(screen.getByText("1/0/3")).toBeInTheDocument();
    expect(screen.getByText("9.001")).toBeInTheDocument();
    expect(screen.getAllByText("RTU 1")).toHaveLength(2);
    expect(screen.getByText("2 active / 2")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Signal map" })).toHaveAttribute("aria-selected", "true");
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

  it("switches to Validation and Import & export tabs", () => {
    mocks.view = buildKnxView();
    renderSignals();

    fireEvent.click(screen.getByRole("tab", { name: "Validation" }));
    expect(screen.getByRole("tab", { name: "Validation" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("tab", { name: "Import & export" }));
    expect(screen.getByRole("button", { name: "Import project" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Export project" })).toBeInTheDocument();
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
    expect(screen.getByText("9 active / 9")).toBeInTheDocument();
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
