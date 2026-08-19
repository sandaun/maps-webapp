import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
import type { ProjectView } from "@/lib/project-types";
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

describe("SignalsScreen (knx-mbm)", () => {
  it("renders the signal table with formatted KNX/Modbus columns", () => {
    mocks.view = buildKnxView();
    render(<SignalsScreen />);

    expect(screen.getByText("Heat pump on/off")).toBeInTheDocument();
    expect(screen.getByText("Room temperature")).toBeInTheDocument();
    expect(screen.getByText("1/0/3")).toBeInTheDocument();
    expect(screen.getByText("9.001")).toBeInTheDocument();
    expect(screen.getAllByText("RTU 1")).toHaveLength(2);
    // 2 active signals out of 2 total.
    expect(screen.getByText("2 active / 2")).toBeInTheDocument();
  });

  it("filters rows with the text search", () => {
    mocks.view = buildKnxView();
    render(<SignalsScreen />);
    fireEvent.change(screen.getByLabelText("Search signals"), { target: { value: "temperature" } });
    expect(screen.queryByText("Heat pump on/off")).not.toBeInTheDocument();
    expect(screen.getByText("Room temperature")).toBeInTheDocument();
  });

  it("toggles a signal active state via a patch", async () => {
    mocks.applyPatches.mockResolvedValue(buildKnxView());
    mocks.view = buildKnxView();
    render(<SignalsScreen />);

    fireEvent.click(screen.getByLabelText("Active signal 0"));

    await waitFor(() => expect(mocks.applyPatches).toHaveBeenCalled());
    expect(mocks.applyPatches).toHaveBeenCalledWith([
      { type: "updateSignal", id: 0, patch: { active: false } },
    ]);
  });

  it("opens the drawer and saves an edited description via updateSignal", async () => {
    mocks.applyPatches.mockResolvedValue(buildKnxView());
    mocks.view = buildKnxView();
    render(<SignalsScreen />);

    fireEvent.click(screen.getByText("Heat pump on/off"));
    expect(screen.getByText("SIGNAL 0")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "HP command" } });
    fireEvent.click(screen.getByRole("button", { name: "Save signal" }));

    await waitFor(() => expect(mocks.applyPatches).toHaveBeenCalled());
    const [patches] = mocks.applyPatches.mock.calls.at(-1)!;
    expect(patches).toHaveLength(1);
    expect(patches[0].type).toBe("updateSignal");
    expect(patches[0].id).toBe(0);
    expect(patches[0].patch.description).toBe("HP command");
    expect(patches[0].patch.knx.groupAddress).toBe(2051);
  });
});

describe("SignalsScreen (me-mbs)", () => {
  it("renders me-mbs columns: AC parameter, controller/group, register, access", () => {
    mocks.view = buildMeView();
    render(<SignalsScreen />);

    // Column set switches by family.
    expect(screen.getByText("AC parameter")).toBeInTheDocument();
    expect(screen.getByText("Controller / group")).toBeInTheDocument();
    expect(screen.getByText("Access")).toBeInTheDocument();
    expect(screen.queryByText("Group address")).not.toBeInTheDocument();
    expect(screen.queryByText("DPT")).not.toBeInTheDocument();

    // Spec table descriptions resolved (general + group signals).
    expect(screen.getByText("Centralized controller communication error")).toBeInTheDocument();
    expect(screen.getByText("Room Humidity")).toBeInTheDocument();
    // Scope labels.
    expect(screen.getAllByText("Controller-wide")).toHaveLength(2);
    expect(screen.getAllByText(/C1 · G1 — Office/).length).toBeGreaterThan(0);
    // Trigger access exists on this family.
    expect(screen.getAllByText("Trigger").length).toBeGreaterThan(0);
    expect(screen.getByText("9 active / 9")).toBeInTheDocument();
  });

  it("opens the me-mbs drawer and saves description + endpoint edits", async () => {
    mocks.applyPatches.mockResolvedValue(buildMeView());
    mocks.view = buildMeView();
    render(<SignalsScreen />);

    // Signal 2 is the group "On/Off" signal. The description cell carries the
    // allowed-values suffix; the AC parameter cell renders exactly "On/Off".
    fireEvent.click(screen.getByText("On/Off"));
    expect(screen.getByText("SIGNAL 2")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Office on/off" } });
    fireEvent.change(screen.getByLabelText("Register address"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Save signal" }));

    await waitFor(() => expect(mocks.applyPatches).toHaveBeenCalled());
    const [patches] = mocks.applyPatches.mock.calls.at(-1)!;
    expect(patches).toHaveLength(1);
    expect(patches[0].type).toBe("updateSignal");
    expect(patches[0].id).toBe(2);
    expect(patches[0].patch.description).toBe("Office on/off");
    expect(patches[0].patch.modbus.address).toBe(500);
    expect(patches[0].patch.me.g50Index).toBe(0);
    expect(patches[0].patch.me.groupIndex).toBe(0);
  });
});
