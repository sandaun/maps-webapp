import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { projectFromXml as readKnx } from "@/gateway-families/knx-mbm";
import { projectFromXml as readMe } from "@/gateway-families/me-mbs";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { SYNTHETIC_ME_MBS_XML } from "@/gateway-families/me-mbs/fixtures/synthetic-project";
import { CurrentProjectProvider } from "@/lib/current-project";
import { PropertyDraftProvider } from "@/lib/property-drafts";
import { propertyFields } from "@/lib/property-fields";
import type { OptionLabels } from "@/lib/property-option-labels";
import type { FamilyId, ProjectView } from "@/lib/project-types";
import { ConfigurationScreen } from "./configuration-screen";
import { DevicesScreen } from "./devices-screen";
import { readOptions } from "@/components/ui/select-testing";

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

function viewOf(family: FamilyId): ProjectView {
  const xml = XmlDocument.parse(family === "knx-mbm" ? SYNTHETIC_KNX_MBM_XML : SYNTHETIC_ME_MBS_XML);
  const meta = { id: "demo", family, name: "P", description: "", source: "demo" as const, updatedAt: "", revision: 1 };
  return family === "knx-mbm"
    ? { family, meta, project: readKnx(xml), issues: [], hasCompleteBlob: false }
    : { family, meta, project: readMe(xml), issues: [], hasCompleteBlob: false };
}

/** Every option of every labelled property select must read as its shared label. */
function checkRenderedSelects(view: ProjectView, seen: Set<OptionLabels>) {
  const fields = new Map(propertyFields(view).map((field) => [field.id, field]));
  for (const select of screen.queryAllByRole("combobox")) {
    const labels = fields.get(select.id)?.optionLabels;
    if (!labels) continue;
    for (const option of readOptions(select)) {
      expect(`${select.id}=${option.value} → ${option.label}`).toBe(
        `${select.id}=${option.value} → ${labels[option.value]}`,
      );
    }
    seen.add(labels);
  }
  // Choice chips (conversion library): one radio per option, in the field's option order.
  for (const group of screen.queryAllByRole("radiogroup")) {
    const field = fields.get(group.id);
    if (!field?.optionLabels || !field.options) continue;
    expect(within(group).getAllByRole("radio").map((radio) => radio.textContent)).toEqual(
      field.options.map((option) => field.optionLabels![String(Number(option))]),
    );
    seen.add(field.optionLabels);
  }
}

beforeEach(() => {
  localStorage.clear();
  mocks.get.mockReset();
});

describe("shared option labels match the rendered selects", () => {
  it.each(["knx-mbm", "me-mbs"] as const)("%s", async (family) => {
    const view = viewOf(family);
    mocks.get.mockImplementation(async () => view);
    const seen = new Set<OptionLabels>();

    const config = render(
      <CurrentProjectProvider>
        <PropertyDraftProvider>
          <ConfigurationScreen />
        </PropertyDraftProvider>
      </CurrentProjectProvider>,
    );
    await screen.findByRole("textbox", { name: "Project name" });
    for (const section of family === "knx-mbm"
      ? ["BMS · KNX", "Modbus Master", "Conversions"]
      : ["BMS · Modbus server", "Mitsubishi Electric"]) {
      fireEvent.click(screen.getByRole("button", { name: section }));
      checkRenderedSelects(view, seen);
    }
    config.unmount();

    render(
      <CurrentProjectProvider>
        <PropertyDraftProvider>
          <DevicesScreen />
        </PropertyDraftProvider>
      </CurrentProjectProvider>,
    );
    if (family === "knx-mbm") {
      await screen.findByRole("combobox", { name: "RTU node 1 · Parity" });
      checkRenderedSelects(view, seen);
    } else {
      await screen.findByRole("combobox", { name: "Controller 1 · Model" });
      checkRenderedSelects(view, seen);
      fireEvent.click(screen.getByRole("button", { name: "Select controller 1 group 1" }));
      await screen.findByRole("combobox", { name: "Controller 1 · G1 · Unit type" });
      checkRenderedSelects(view, seen);
    }

    // Every labelled property of the family was actually rendered and checked.
    const expected = new Set(
      propertyFields(view)
        .map((field) => field.optionLabels)
        .filter((labels): labels is OptionLabels => !!labels),
    );
    expect(seen).toEqual(expected);
  });
});
