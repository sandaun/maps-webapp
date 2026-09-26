import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { projectFromXml as readKnx, setConversions } from "@/gateway-families/knx-mbm";
import { projectFromXml as readMe } from "@/gateway-families/me-mbs";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { SYNTHETIC_ME_MBS_XML } from "@/gateway-families/me-mbs/fixtures/synthetic-project";
import { CurrentProjectProvider } from "@/lib/current-project";
import { PropertyDraftProvider } from "@/lib/property-drafts";
import type { ProjectView } from "@/lib/project-types";
import { ConfigurationScreen } from "./configuration-screen";

const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  getProjectView: mocks.get,
  patchProject: mocks.patch,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const meta = { id: "demo", name: "P", description: "", source: "demo" as const, updatedAt: "", revision: 1 };

function renderConfiguration(view: ProjectView) {
  mocks.get.mockImplementation(async () => view);
  render(
    <CurrentProjectProvider>
      <PropertyDraftProvider>
        <ConfigurationScreen />
      </PropertyDraftProvider>
    </CurrentProjectProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mocks.get.mockReset();
});

describe("Configuration → Conversions", () => {
  it("shows the Param4 threshold of a Less than filter, as MAPS does", async () => {
    const doc = XmlDocument.parse(SYNTHETIC_KNX_MBM_XML);
    setConversions(doc, [{ id: 0, description: "Below 50", type: 0, params: ["1", "2", "7", "50"] }]);
    renderConfiguration({ family: "knx-mbm", meta: { ...meta, family: "knx-mbm" }, project: readKnx(doc), issues: [], hasCompleteBlob: false });
    await screen.findByRole("textbox", { name: "Project name" });
    fireEvent.click(screen.getByRole("button", { name: "Conversions" }));
    expect(screen.getByText("Less than")).toBeTruthy();
    expect(screen.getByText("50")).toBeTruthy();
    expect(screen.queryByText("7")).toBeNull();
    expect(screen.queryByText("Upper value")).toBeNull();
  });

  it("has no Conversions section for ME–MBS, whose conversions MAPS does not expose", async () => {
    const project = readMe(XmlDocument.parse(SYNTHETIC_ME_MBS_XML));
    renderConfiguration({ family: "me-mbs", meta: { ...meta, family: "me-mbs" }, project, issues: [], hasCompleteBlob: false });
    await screen.findByRole("textbox", { name: "Project name" });
    expect(screen.queryByRole("button", { name: "Conversions" })).toBeNull();
  });
});
