import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { projectFromXml, validateProject } from "@/gateway-families/knx-mbm";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import type { ProjectView } from "@/lib/project-types";
import { SignalsScreen } from "./signals-screen";

const mocks = vi.hoisted(() => ({ applyPatches: vi.fn() }));

function buildView(): ProjectView {
  const project = projectFromXml(XmlDocument.parse(SYNTHETIC_KNX_MBM_XML));
  return {
    meta: {
      id: "demo",
      name: "Demo project (synthetic)",
      description: "",
      source: "demo",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    project,
    issues: validateProject(project),
    hasCompleteBlob: false,
  };
}

vi.mock("@/lib/current-project", () => ({
  useCurrentProject: () => ({
    projectId: "demo",
    loading: false,
    view: buildView(),
    error: null,
    setProjectId: vi.fn(),
    refresh: vi.fn(),
    applyPatches: mocks.applyPatches,
  }),
  usePatch: () => mocks.applyPatches,
}));

describe("SignalsScreen", () => {
  it("renders the signal table with formatted KNX/Modbus columns", () => {
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
    render(<SignalsScreen />);
    fireEvent.change(screen.getByLabelText("Search signals"), { target: { value: "temperature" } });
    expect(screen.queryByText("Heat pump on/off")).not.toBeInTheDocument();
    expect(screen.getByText("Room temperature")).toBeInTheDocument();
  });

  it("toggles a signal active state via a patch", async () => {
    mocks.applyPatches.mockResolvedValue(buildView());
    render(<SignalsScreen />);

    fireEvent.click(screen.getByLabelText("Active signal 0"));

    await waitFor(() => expect(mocks.applyPatches).toHaveBeenCalled());
    expect(mocks.applyPatches).toHaveBeenCalledWith([
      { type: "updateSignal", id: 0, patch: { active: false } },
    ]);
  });

  it("opens the drawer and saves an edited description via updateSignal", async () => {
    mocks.applyPatches.mockResolvedValue(buildView());
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
