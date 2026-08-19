import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { projectFromXml as meProjectFromXml } from "@/gateway-families/me-mbs";
import { SYNTHETIC_ME_MBS_XML } from "@/gateway-families/me-mbs/fixtures/synthetic-project";
import type { ProjectView } from "@/lib/project-types";
import { OverviewScreen } from "./overview-screen";

const mocks = vi.hoisted(() => ({ view: null as ProjectView | null }));

function buildMeView(): ProjectView {
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
    project: meProjectFromXml(XmlDocument.parse(SYNTHETIC_ME_MBS_XML)),
    issues: [],
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
    applyPatches: vi.fn(),
  }),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listProjects: vi.fn().mockResolvedValue([]),
}));

describe("OverviewScreen", () => {
  it("renders the explicit 'no project' empty state", () => {
    mocks.view = null;
    render(<OverviewScreen />);

    expect(screen.getByText("No project loaded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /load demo project/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open \.ibmaps file/i })).toBeInTheDocument();
  });

  it("shows the family badge and me-mbs counts for a ME–MBS project", () => {
    mocks.view = buildMeView();
    render(<OverviewScreen />);

    expect(screen.getByText("Mitsubishi Electric AC ↔ Modbus Slave")).toBeInTheDocument();
    expect(screen.getByText("Virtual slaves")).toBeInTheDocument();
    expect(screen.getByText("Controllers")).toBeInTheDocument();
    expect(screen.getByText("Groups (enabled / total)")).toBeInTheDocument();
    // knx-mbm-only counts must not appear.
    expect(screen.queryByText("RTU nodes")).not.toBeInTheDocument();
  });
});
