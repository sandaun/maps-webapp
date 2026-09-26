import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { projectFromXml as readKnx, setConversions, updateSignal } from "@/gateway-families/knx-mbm";
import { projectFromXml as readMe } from "@/gateway-families/me-mbs";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { SYNTHETIC_ME_MBS_XML } from "@/gateway-families/me-mbs/fixtures/synthetic-project";
import { familyById } from "@/server/projects/families";
import { ApiError } from "@/lib/api";
import { CurrentProjectProvider } from "@/lib/current-project";
import { PropertyDraftProvider } from "@/lib/property-drafts";
import type { ProjectPatchInput, ProjectView } from "@/lib/project-types";
import { ConfigurationScreen } from "./configuration-screen";

const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), push: vi.fn(), search: new URLSearchParams() }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  getProjectView: mocks.get,
  patchProject: mocks.patch,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => mocks.search,
}));

let xml: XmlDocument;
let revision: number;
const meta = () => ({ id: "demo", family: "knx-mbm" as const, name: "P", description: "", source: "demo" as const, updatedAt: "", revision });
const view = (): ProjectView => ({ family: "knx-mbm", meta: meta(), project: readKnx(xml), issues: [], hasCompleteBlob: false });

/** Filters "Valid" (No-limit, In range −50…150) and "Below 50" (Less than, Param4); a LUT; operation "x0.1" used by signal 1. */
function setup() {
  xml = XmlDocument.parse(SYNTHETIC_KNX_MBM_XML);
  setConversions(xml, [
    { id: 0, description: "Valid", type: 0, params: ["1", "4", "-50", "150"] },
    { id: 1, description: "Below 50", type: 0, params: ["1", "2", "7", "50"] },
    { id: 0, description: "Chiller mode", type: 4, params: ["0", "0", "0", "0"] },
    { id: 0, description: "x0.1", type: 2, params: ["-1", "1", "0", "0"] },
  ]);
  updateSignal(xml, 1, {
    conversionRefs: {
      internal: { filters: [], operations: [] },
      external: { filters: [{ index: 0, inverted: false }], operations: [{ index: 1, inverted: false }] },
    },
  });
  revision = 1;
  mocks.get.mockImplementation(async () => view());
  mocks.patch.mockImplementation(async (_id: string, patches: ProjectPatchInput[]) => {
    try {
      familyById("knx-mbm").applyPatches(xml, patches as never);
    } catch (error) {
      throw new ApiError((error as { status?: number }).status ?? 500, (error as Error).message);
    }
    revision++;
    return view();
  });
}

async function openConversions() {
  render(
    <CurrentProjectProvider>
      <PropertyDraftProvider>
        <ConfigurationScreen />
      </PropertyDraftProvider>
    </CurrentProjectProvider>,
  );
  await screen.findByRole("textbox", { name: "Project name" });
  fireEvent.click(screen.getByRole("button", { name: "Conversions" }));
}

const row = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });

beforeEach(() => {
  mocks.search = new URLSearchParams();
  localStorage.clear();
  mocks.get.mockReset();
  mocks.patch.mockReset();
  setup();
});

describe("Configuration → Conversions", () => {
  it("lists filters, operations and system entries with their summary and use", async () => {
    await openConversions();
    expect(row("Valid").textContent).toContain("−50 ≤ x ≤ 150");
    expect(row("Valid").textContent).toContain("used by 1");
    expect(row("Below 50").textContent).toContain("< 50");
    expect(row("Below 50").textContent).toContain("unused");
    expect(row("x0.1").textContent).toContain("y = x · 0.1");
    expect(row("Chiller mode").textContent).toContain("system");
  });

  it("opens the library entry of a validation issue from the URL", async () => {
    mocks.search = new URLSearchParams("conversion=o1");
    render(
      <CurrentProjectProvider>
        <PropertyDraftProvider>
          <ConfigurationScreen />
        </PropertyDraftProvider>
      </CurrentProjectProvider>,
    );
    expect(await screen.findByRole("heading", { name: "x0.1" })).toBeTruthy();
  });

  it("links the use count to the signals that use the entry", async () => {
    await openConversions();
    fireEvent.click(screen.getByRole("button", { name: "Used by 1 signal →" }));
    expect(mocks.push).toHaveBeenCalledWith("/signals?conversion=f0");
  });

  it("edits the Param4 threshold of a Less than filter, as MAPS does", async () => {
    await openConversions();
    fireEvent.click(row("Below 50"));
    expect((screen.getByRole("textbox", { name: "Value" }) as HTMLInputElement).value).toBe("50");
    expect(screen.getByRole("radio", { name: "Less than" }).getAttribute("aria-checked")).toBe("true");
  });

  it("checks Low ≤ High while typing and explains the filter type as ApplyFilter does", async () => {
    await openConversions();
    fireEvent.change(screen.getByRole("textbox", { name: "Low" }), { target: { value: "200" } });
    expect(screen.getByText("Low must not be greater than High.")).toBeTruthy();
    expect(screen.getByText("Fix the values above to see what it does.")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Low" }), { target: { value: "-50" } });
    fireEvent.click(screen.getByRole("radio", { name: "Limited filter" }));
    expect(screen.getByText("Values below −50 become −50 and values above 150 become 150.")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Value to try" }), { target: { value: "200" } });
    expect(screen.getByRole("status", { name: "Try it result" }).textContent).toBe("150");
  });

  it("saves the edits with the save bar as one updateConversion", async () => {
    await openConversions();
    fireEvent.click(row("x0.1"));
    fireEvent.change(screen.getByRole("textbox", { name: "C · offset" }), { target: { value: "5" } });
    expect(screen.getByText("Calculates y = x · 0.1 + 5.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith(
        "demo",
        [{ type: "updateConversion", list: "operations", index: 1, patch: { param3: 5 } }],
        expect.anything(),
      ),
    );
    await waitFor(() => expect(readKnx(xml).conversions[3].params).toEqual(["-1", "1", "5", "0"]));
  });

  it("saves 5.00 as 5 and leaves nothing pending", async () => {
    await openConversions();
    fireEvent.change(screen.getByRole("textbox", { name: "Low" }), { target: { value: "5.00" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(readKnx(xml).conversions[0].params[2]).toBe("5"));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Pending property changes" })).toBeNull());
    expect(screen.queryByText(/need your review/)).toBeNull();
  });

  it("drops an emptied value that the new condition hides, so the save only sends valid values", async () => {
    await openConversions();
    fireEvent.change(screen.getByRole("textbox", { name: "Low" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("radio", { name: "Less than" }));
    expect(screen.queryByRole("textbox", { name: "Low" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith(
        "demo",
        [{ type: "updateConversion", list: "filters", index: 0, patch: { param2: 2 } }],
        expect.anything(),
      ),
    );
    await waitFor(() => expect(readKnx(xml).conversions[0].params).toEqual(["1", "2", "-50", "150"]));
  });

  it("adds a filter at once and selects it", async () => {
    await openConversions();
    fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Filter_2" })).toBeTruthy());
    expect(mocks.patch.mock.calls[0][1]).toEqual([{ type: "addConversion", conversionType: 0 }]);
  });

  it("asks for the operation type and duplicates the selected entry", async () => {
    await openConversions();
    fireEvent.click(screen.getByRole("button", { name: "Add operation" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Arithmetic/ }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Operation_1" })).toBeTruthy());
    fireEvent.click(row("x0.1"));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "x0.1 copy" })).toBeTruthy());
    expect(mocks.patch.mock.calls[1][1]).toEqual([
      { type: "addConversion", conversionType: 2, values: { description: "x0.1 copy", params: [-1, 1, 0, 0] } },
    ]);
  });

  it("confirms a delete with the signals that use it and keeps the others on their conversions", async () => {
    await openConversions();
    fireEvent.click(row("Valid"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete “Valid”?" });
    expect(within(dialog).getByText("Room temperature")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete and update 1 signal" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.patch.mock.calls[0][1]).toEqual([{ type: "removeConversion", list: "filters", index: 0 }]);
    // "Below 50" moved to position 0; signal 1 keeps its operation.
    expect(readKnx(xml).signals[1].conversions.external).toEqual({
      filters: [],
      operations: [{ index: 1, inverted: false }],
    });
  });

  it("shows LUT remaps and logical operations read-only", async () => {
    await openConversions();
    fireEvent.click(row("Chiller mode"));
    expect(screen.getByText("Created by the template. Cannot be edited.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByText("The gateway uses the inverse table in the other direction.")).toBeTruthy();
  });

  it("shows the empty library with the add actions", async () => {
    setConversions(xml, []);
    await openConversions();
    expect(screen.getByText("No filters or operations in this project yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New scale" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Operation_0" })).toBeTruthy());
  });

  it("has no Conversions section for ME–MBS, whose conversions MAPS does not expose", async () => {
    const project = readMe(XmlDocument.parse(SYNTHETIC_ME_MBS_XML));
    const meView: ProjectView = { family: "me-mbs", meta: { ...meta(), family: "me-mbs" }, project, issues: [], hasCompleteBlob: false };
    mocks.get.mockImplementation(async () => meView);
    render(
      <CurrentProjectProvider>
        <PropertyDraftProvider>
          <ConfigurationScreen />
        </PropertyDraftProvider>
      </CurrentProjectProvider>,
    );
    await screen.findByRole("textbox", { name: "Project name" });
    expect(screen.queryByRole("button", { name: "Conversions" })).toBeNull();
  });
});
