import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { projectFromXml as knxProjectFromXml } from "@/gateway-families/knx-mbm/from-xml";
import { projectFromXml as meProjectFromXml } from "@/gateway-families/me-mbs";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { SYNTHETIC_ME_MBS_XML } from "@/gateway-families/me-mbs/fixtures/synthetic-project";
import type { ProjectView } from "@/lib/project-types";
import { OverviewScreen } from "./overview-screen";

const mocks = vi.hoisted(() => ({ view: null as ProjectView | null }));

function buildMeView(issues: ProjectView["issues"] = []): ProjectView {
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
    issues,
    hasCompleteBlob: false,
  };
}

function buildKnxView(issues: ProjectView["issues"] = []): ProjectView {
  return {
    meta: {
      id: "knx",
      name: "KNX test project",
      description: "",
      source: "template",
      family: "knx-mbm",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    family: "knx-mbm",
    project: knxProjectFromXml(XmlDocument.parse(SYNTHETIC_KNX_MBM_XML)),
    issues,
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
  listProjectHistory: vi.fn().mockResolvedValue([]),
}));

describe("OverviewScreen", () => {
  it("renders the explicit 'no project' empty state", () => {
    mocks.view = null;
    render(<OverviewScreen />);

    expect(screen.getByText("No project loaded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /load demo project/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open \.ibmaps file/i })).toBeInTheDocument();
  });

  it("shows the v9 dashboard blocks for a ME–MBS project", () => {
    mocks.view = buildMeView();
    render(<OverviewScreen />);

    expect(screen.getByText("Signals exposed to BMS")).toBeInTheDocument();
    expect(screen.getByText("AC groups")).toBeInTheDocument();
    expect(screen.getByText("Controller polling")).toBeInTheDocument();
    expect(screen.getByText("Attention")).toBeInTheDocument();
    expect(screen.getByText("Translation path")).toBeInTheDocument();
    expect(screen.getByText("Next steps")).toBeInTheDocument();
    expect(screen.getByText("Activity")).toBeInTheDocument();
    // knx-mbm-only cards must not appear.
    expect(screen.queryByText("KNX interface")).not.toBeInTheDocument();
    expect(screen.queryByText("Modbus devices")).not.toBeInTheDocument();
  });

  it("shows knx-mbm cards and hides me-mbs ones for a KNX–MBM project", () => {
    mocks.view = buildKnxView();
    render(<OverviewScreen />);

    expect(screen.getByText("KNX interface")).toBeInTheDocument();
    expect(screen.getByText("Modbus devices")).toBeInTheDocument();
    expect(screen.queryByText("AC groups")).not.toBeInTheDocument();
    expect(screen.queryByText("Controller polling")).not.toBeInTheDocument();
  });

  it("surfaces the top validation issue in the Attention card", () => {
    mocks.view = buildMeView([
      { code: "TEST-WARN", severity: "warning", message: "Group G05 is empty" },
      { code: "TEST-ERR", severity: "error", message: "Register overlap on slave 10" },
    ]);
    render(<OverviewScreen />);

    // The error wins over the warning as the highlighted issue (Attention box +
    // next-step subtitle both quote it).
    expect(screen.getAllByText("Register overlap on slave 10").length).toBeGreaterThan(0);
    expect(screen.getByText("errors · 1 warnings")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review validation →" })).toHaveAttribute(
      "href",
      "/signals?tab=validation",
    );
    // Next steps lead with the error.
    expect(screen.getByText("Resolve 1 validation error")).toBeInTheDocument();
  });

  it("shows the clean state when no issues are open", () => {
    mocks.view = buildKnxView();
    render(<OverviewScreen />);

    expect(
      screen.getByText("No open issues — the project passes all validation rules."),
    ).toBeInTheDocument();
    expect(screen.getByText("Validation is clean")).toBeInTheDocument();
  });
});
