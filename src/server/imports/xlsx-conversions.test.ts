import { describe, expect, it } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { projectFromXml, setConversions, updateSignal } from "@/gateway-families/knx-mbm";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { buildSignalsXlsx } from "@/server/exports/xlsx-signals";
import { loadWorkbook, workbookToBuffer } from "@/server/exports/xlsx-workbook";
import { applySignalsXlsx } from "./xlsx-signals";

const NOW = new Date(2026, 0, 1);
const NO_REFS = { internal: { filters: [], operations: [] }, external: { filters: [], operations: [] } };
const SCALE_0_1000 = { id: 0, description: "x0.1 to degC", type: 1, params: ["0", "1000", "0", "100"] as [string, string, string, string] };

async function exportedTable(): Promise<Uint8Array> {
  const project = projectFromXml(XmlDocument.parse(SYNTHETIC_KNX_MBM_XML));
  return new Uint8Array(await buildSignalsXlsx("knx-mbm", project, { now: NOW }));
}

/** Edit the exported workbook (sheet name → edit) and return the new file. */
async function editTable(data: Uint8Array, edit: (wb: Awaited<ReturnType<typeof loadWorkbook>>) => void) {
  const workbook = await loadWorkbook(data);
  edit(workbook);
  return new Uint8Array(await workbookToBuffer(workbook));
}

/** The synthetic temperature row (#2) is row 9; "Conv. Id" is column 26. */
const CONV_ID_COLUMN = 26;

describe("signals XLSX import · conversions", () => {
  it("imports both halves of each row's Conv. Id", async () => {
    const doc = XmlDocument.parse(SYNTHETIC_KNX_MBM_XML);
    await applySignalsXlsx(doc, "knx-mbm", await exportedTable());
    const signals = projectFromXml(doc).signals;
    expect(signals).toHaveLength(4);
    // The fixture's row has the same non-inverted op on both halves, which MAPS
    // never writes. Its Conv. Id ("DIRECTION[>/<]:INDEXES[-;0;-;-]") only carries
    // the internal half, and MAPS derives the external one inverted.
    expect(signals[3].conversions).toEqual({
      internal: { filters: [], operations: [{ index: 0, inverted: false }] },
      external: { filters: [], operations: [{ index: 0, inverted: true }] },
    });
    expect(signals[2].conversions).toEqual(NO_REFS);
  });

  it("replaces the project's list when no signal uses conversions yet", async () => {
    const doc = XmlDocument.parse(SYNTHETIC_KNX_MBM_XML);
    updateSignal(doc, 1, { conversionRefs: NO_REFS });
    setConversions(doc, [{ ...SCALE_0_1000, params: ["0", "10", "0", "1"] }]);
    await applySignalsXlsx(doc, "knx-mbm", await exportedTable());
    expect(projectFromXml(doc).conversions).toEqual([SCALE_0_1000]);
  });

  it("rejects a different list when the project's signals already use conversions, changing nothing", async () => {
    const doc = XmlDocument.parse(SYNTHETIC_KNX_MBM_XML);
    setConversions(doc, [{ ...SCALE_0_1000, params: ["0", "10", "0", "1"] }]);
    const before = doc.serialize();
    await expect(applySignalsXlsx(doc, "knx-mbm", await exportedTable())).rejects.toThrow(
      /different from the project's conversions/,
    );
    expect(doc.serialize()).toBe(before);
  });

  it("rejects a Conv. Id column without a Conversions sheet", async () => {
    const data = await editTable(await exportedTable(), (wb) => wb.removeWorksheet(wb.getWorksheet("Conversions")!.id));
    await expect(applySignalsXlsx(XmlDocument.parse(SYNTHETIC_KNX_MBM_XML), "knx-mbm", data)).rejects.toThrow(
      /no "Conversions" sheet/,
    );
  });

  it("rejects a malformed Conv. Id and refs to conversions the sheet does not have", async () => {
    const malformed = await editTable(await exportedTable(), (wb) => {
      wb.getWorksheet("Signals")!.getCell(9, CONV_ID_COLUMN).value = "0,0;";
    });
    await expect(applySignalsXlsx(XmlDocument.parse(SYNTHETIC_KNX_MBM_XML), "knx-mbm", malformed)).rejects.toThrow(
      /signal 2: "0,0;" is not a valid Conv. Id/,
    );
    const missing = await editTable(await exportedTable(), (wb) => {
      wb.getWorksheet("Signals")!.getCell(9, CONV_ID_COLUMN).value = "DIRECTION[>]:INDEXES[-;3;-;-]";
    });
    await expect(applySignalsXlsx(XmlDocument.parse(SYNTHETIC_KNX_MBM_XML), "knx-mbm", missing)).rejects.toThrow(
      /signal 2: .* uses a conversion that is not in the Conversions sheet/,
    );
  });

  it("rejects Conversions sheet rows MAPS would skip, and an Idx that is not the list position", async () => {
    const badType = await editTable(await exportedTable(), (wb) => {
      wb.getWorksheet("Conversions")!.getCell(2, 3).value = "SCALING";
    });
    await expect(applySignalsXlsx(XmlDocument.parse(SYNTHETIC_KNX_MBM_XML), "knx-mbm", badType)).rejects.toThrow(
      /row 2: Type "SCALING"/,
    );
    const badIdx = await editTable(await exportedTable(), (wb) => {
      wb.getWorksheet("Conversions")!.getCell(2, 1).value = "4";
    });
    await expect(applySignalsXlsx(XmlDocument.parse(SYNTHETIC_KNX_MBM_XML), "knx-mbm", badIdx)).rejects.toThrow(
      /row 2: Idx 4 should be 0/,
    );
  });

  it("keeps the project's list when the table has no Conv. Id column", async () => {
    const data = await editTable(await exportedTable(), (wb) => {
      wb.getWorksheet("Signals")!.getCell(7, CONV_ID_COLUMN).value = "";
      wb.getWorksheet("Signals")!.getCell(7, CONV_ID_COLUMN + 1).value = "";
    });
    const doc = XmlDocument.parse(SYNTHETIC_KNX_MBM_XML);
    await applySignalsXlsx(doc, "knx-mbm", data);
    const project = projectFromXml(doc);
    expect(project.conversions).toEqual([SCALE_0_1000]);
    expect(project.signals[3].conversions).toEqual(NO_REFS);
  });
});
