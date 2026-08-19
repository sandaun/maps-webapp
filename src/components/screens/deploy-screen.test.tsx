import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { projectFromXml } from "@/gateway-families/knx-mbm";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import type { ProjectView } from "@/lib/project-types";
import { DeployScreen } from "./deploy-screen";

function buildView(hasCompleteBlob: boolean): ProjectView {
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
    project: projectFromXml(XmlDocument.parse(SYNTHETIC_KNX_MBM_XML)),
    issues: [],
    hasCompleteBlob,
  };
}

vi.mock("@/lib/current-project", () => ({
  useCurrentProject: () => ({
    projectId: "demo",
    loading: false,
    view: buildView(false),
    error: null,
    setProjectId: vi.fn(),
    refresh: vi.fn(),
    applyPatches: vi.fn(),
  }),
  usePatch: () => vi.fn(),
}));

describe("DeployScreen", () => {
  it("keeps the deploy action disabled with the knxMbmXblVerified explanation", () => {
    render(<DeployScreen />);

    const button = screen.getByRole("button", { name: /Deploy modified project/ });
    expect(button).toBeDisabled();
    expect(screen.getByText(/knxMbmXblVerified/)).toBeInTheDocument();
    expect(screen.getByText("Read-only towards gateways")).toBeInTheDocument();
  });

  it("offers the export download and explains the missing gateway blob", () => {
    render(<DeployScreen />);

    expect(screen.getByRole("link", { name: /Export .ibmaps/ })).toHaveAttribute(
      "href",
      "/api/projects/demo/export",
    );
    expect(screen.getByText("No gateway blob")).toBeInTheDocument();
  });
});
