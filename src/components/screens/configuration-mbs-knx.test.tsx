import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { projectFromXml } from "@/gateway-families/mbs-knx";
import { SYNTHETIC_MBS_KNX_XML } from "@/gateway-families/mbs-knx/fixtures/synthetic-project";
import { familyById } from "@/server/projects/families";
import { CurrentProjectProvider } from "@/lib/current-project";
import { navSectionsFor } from "@/lib/nav";
import { PropertyDraftProvider } from "@/lib/property-drafts";
import type { ProjectPatchInput, ProjectView } from "@/lib/project-types";
import { chooseOption } from "@/components/ui/select-testing";
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

let xml: XmlDocument;
let revision: number;

function currentView(id = "demo"): ProjectView {
  return {
    family: "mbs-knx",
    meta: { id, family: "mbs-knx", name: "P", description: "", source: "demo", updatedAt: "", revision },
    project: projectFromXml(xml),
    issues: [],
    passwordValid: false, mapsVersion: "1.2.34.0", hasCompleteBlob: false,
  };
}

beforeEach(() => {
  localStorage.clear();
  xml = XmlDocument.parse(SYNTHETIC_MBS_KNX_XML);
  revision = 1;
  mocks.get.mockReset();
  mocks.patch.mockReset();
  mocks.get.mockImplementation(async (id: string) => currentView(id));
  // Through the real family registry, as the API would apply them.
  mocks.patch.mockImplementation(async (id: string, patches: ProjectPatchInput[]) => {
    familyById("mbs-knx").applyPatches(xml, patches);
    revision++;
    return currentView(id);
  });
});

function renderConfiguration() {
  return render(
    <CurrentProjectProvider>
      <PropertyDraftProvider>
        <ConfigurationScreen />
      </PropertyDraftProvider>
    </CurrentProjectProvider>,
  );
}

describe("MBS–KNX configuration", () => {
  it("lists the MAPS sections of the family and no device list", async () => {
    renderConfiguration();
    await screen.findByRole("textbox", { name: "Project name" });
    for (const name of ["General", "Network & time", "BMS · Modbus server", "KNX", "Conversions"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "Mitsubishi Electric" })).toBeNull();
    expect(navSectionsFor("mbs-knx").map((s) => s.href)).not.toContain("/devices");
    expect(navSectionsFor("knx-mbm").map((s) => s.href)).toContain("/devices");
  });

  it("shows only the Modbus settings MAPS shows and saves the data type as one RTU patch", async () => {
    renderConfiguration();
    await screen.findByRole("textbox", { name: "Project name" });
    fireEvent.click(screen.getByRole("button", { name: "BMS · Modbus server" }));
    // Hidden in MAPS for this family.
    for (const hidden of ["Modbus addresses", "Comm. error timeout", "Slave addressing mode"]) {
      expect(screen.queryByText(hidden)).toBeNull();
    }
    chooseOption(screen.getByRole("combobox", { name: "Data type" }), "8 bit / Even / 1");
    fireEvent.change(screen.getByRole("textbox", { name: "Slave number" }), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledTimes(1));
    expect(mocks.patch.mock.calls[0][1]).toEqual([
      { type: "updateRtuConfig", patch: { dataBits: 8, parity: 2, stopBits: 1, slaveNumber: 200 } },
    ]);
    expect(projectFromXml(xml).mbs.rtu).toMatchObject({ dataBits: 8, parity: 2, stopBits: 1, slaveNumber: 200 });
  });

  it("edits the KNX interface on the device side", async () => {
    renderConfiguration();
    await screen.findByRole("textbox", { name: "Project name" });
    fireEvent.click(screen.getByRole("button", { name: "KNX" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Physical address" }), { target: { value: "1.1.1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledTimes(1));
    expect(mocks.patch.mock.calls[0][1]).toEqual([{ type: "setKnxPhysicalAddress", address: 4353 }]);
    expect(projectFromXml(xml).knx.physicalAddress).toBe(4353);
  });
});
