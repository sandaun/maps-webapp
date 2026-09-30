import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { projectFromXml, updateSignal } from "@/gateway-families/mbs-knx";
import { MAPS_MBS_KNX_TEMPLATE_XML } from "@/gateway-families/mbs-knx/fixtures/maps-template";
import { SYNTHETIC_MBS_KNX_XML } from "@/gateway-families/mbs-knx/fixtures/synthetic-project";
import { projectFromXml as knxMbmFromXml } from "@/gateway-families/knx-mbm";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { buildSignalsXlsx, MAX_SIGNAL_ROWS, parseSignalsXlsx } from "@/server/exports/xlsx-signals";
import { dptCell, MBS_KNX_SIGNAL_HEADERS, mbsKnxSignalRow } from "@/server/exports/maps-grid-values";
import { cellText, loadWorkbook, workbookToBuffer } from "@/server/exports/xlsx-workbook";
import { applySignalsXlsx } from "./xlsx-signals";

const NOW = new Date(2026, 0, 1);

async function exportedTable(xml = SYNTHETIC_MBS_KNX_XML): Promise<Uint8Array> {
  const project = projectFromXml(XmlDocument.parse(xml));
  return new Uint8Array(await buildSignalsXlsx({ family: "mbs-knx", project }, { now: NOW }));
}

/** Set cells of the "Signals" sheet: `row` is the data row (0 = first signal), `header` the column. */
async function editCells(data: Uint8Array, edits: { row: number; header: string; value: string }[]) {
  const workbook = await loadWorkbook(data);
  const sheet = workbook.getWorksheet("Signals")!;
  for (const { row, header, value } of edits) {
    const column = MBS_KNX_SIGNAL_HEADERS.indexOf(header as (typeof MBS_KNX_SIGNAL_HEADERS)[number]) + 1;
    if (column === 0) throw new Error(`Unknown header ${header}`);
    sheet.getRow(8 + row).getCell(column).value = value;
  }
  return new Uint8Array(await workbookToBuffer(workbook));
}

const SPREADSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/** Prefix every SpreadsheetML element with `x:`, as the OpenXML SDK behind MAPS writes them. */
function withOpenXmlPrefixes(data: Uint8Array): Uint8Array {
  const files = unzipSync(data);
  for (const [name, bytes] of Object.entries(files)) {
    const xml = strFromU8(bytes);
    if (!name.endsWith(".xml") || !xml.includes(`xmlns="${SPREADSHEET_NS}"`)) continue;
    files[name] = strToU8(
      xml.replace(/<(\/?)([A-Za-z][\w]*)([\s/>])/g, "<$1x:$2$3").replace(`xmlns="${SPREADSHEET_NS}"`, `xmlns:x="${SPREADSHEET_NS}"`),
    );
  }
  return zipSync(files);
}

/** The header row MAPS Web wrote before it used the MAPS names. */
const EARLIER_MAPS_WEB_HEADERS = [
  "#", "Active", "Description", "Data length", "Format", "Address", "Bit", "R/W", "String length",
  "Index", "DPT", "Sending", "Listening", "U", "T", "Ri", "W", "R", "Priority", "Conv. Id", "Conversions",
];

/** A row's cells without the two indexes, which follow the position. */
const withoutIndexes = (cells: string[]) => cells.filter((_, i) => i !== 0 && i !== 9);

describe("signals XLSX · MBS–KNX", () => {
  it("exports the MAPS template like MAPS 1.2.23 does, with the 1.2.34 timestamp", async () => {
    // Rows of modbus-slave-to-knx.xlsx, exported by MAPS from this same template.
    const project = projectFromXml(XmlDocument.parse(MAPS_MBS_KNX_TEMPLATE_XML));
    const data = new Uint8Array(
      await buildSignalsXlsx({ family: "mbs-knx", project: { ...project, name: "Project1" } }, { now: NOW, mapsVersion: "1.2.23.0" }),
    );
    const parsed = await parseSignalsXlsx(data);
    expect(parsed.version).toBe("1.2.23.0");
    expect(parsed.internalProtocol).toBe("Modbus Slave");
    expect(parsed.externalProtocol).toBe("KNX");
    expect(parsed.headers).toEqual([...MBS_KNX_SIGNAL_HEADERS]);
    expect(parsed.rows).toHaveLength(12);
    const maps: Record<number, string[]> = {
      0: ["1", "True", "OnOff_Read", "16", "0: Unsigned", "0", "-", "0: Read", "-", "1", "1.001: switch", "0/0/1", "", "U", "  ", "  ", "W", "  ", "3: Low", "", "-"],
      2: ["3", "True", "OnOff_ReadWrite", "16", "0: Unsigned", "2", "-", "2: Read / Write", "-", "3", "1.001: switch", "0/0/3", "0/0/20", "U", "T", "  ", "W", "R", "3: Low", "", "-"],
      6: ["7", "True", "BitField_0", "16", "4: BitFields", "6", "0", "2: Read / Write", "-", "7", "1.002: boolean", "0/0/7", "", "U", "T", "  ", "W", "R", "3: Low", "", "-"],
      11: ["12", "True", "Temperature_ReadWrite", "32", "3: Float", "11", "-", "2: Read / Write", "-", "12", "9.001: temperature (ºC)", "0/0/12", "0/0/22", "U", "T", "  ", "W", "R", "3: Low", "", "-"],
    };
    const workbook = await loadWorkbook(data);
    const sheet = workbook.getWorksheet("Signals")!;
    // Raw cell text: parsing trims, and MAPS writes an unset flag as two spaces.
    const rawRow = (i: number) => Array.from({ length: 21 }, (_, c) => String(sheet.getRow(8 + i).getCell(c + 1).value ?? ""));
    for (const [i, row] of Object.entries(maps)) expect(rawRow(Number(i))).toEqual(row);
    expect(parsed.conversionRows).toHaveLength(15);

    expect([1, 2, 3, 4, 5, 6].map((r) => cellText(sheet.getCell(r, 1).value))).toEqual([
      "Intesis MAPS Excel signals file", "PROJECT_NAME", "Intesis MAPS Version", "Internal Protocol", "External Protocol", "Timestamp",
    ]);
    expect(sheet.getCell(2, 2).value).toBe("Project1");
    // MAPS 1.2.34 writes the short date as text (MAPS 1.2.23 stored an Excel date).
    expect(sheet.getCell(6, 2).value).toBe("01/01/2026");
    // MAPS Web's own version only goes in the file properties.
    expect(workbook.creator).toMatch(/^MAPS Web \d+\.\d+\.\d+$/);
  });

  it("writes the conversions of a row and leaves Conv. Id empty without them", async () => {
    const parsed = await parseSignalsXlsx(await exportedTable());
    expect(parsed.rows[0]?.slice(19)).toEqual(["DIRECTION[>/<]:INDEXES[-;0;-;-]", "Enabled"]);
    expect(parsed.rows[1]?.slice(19)).toEqual(["", "-"]);
    expect(parsed.conversionRows).toHaveLength(1);
  });

  it("names the DPT like IntesisKnx.ConvertDPTValueToString", () => {
    expect(dptCell(257)).toBe("1.001: switch");
    expect(dptCell((1 << 8) | 255)).toBe("1.x: (1-bit)");
    expect(dptCell((14 << 8) | 0)).toBe("14.000: acceleration (m/s2)");
    expect(dptCell((7 << 8) | 0)).toBe("");
    expect(dptCell(99)).toBe("");
    expect(dptCell((200 << 8) | 7)).toBe("200.007: ");
  });

  it("appends every row as exported, conversions included", async () => {
    const doc = XmlDocument.parse(SYNTHETIC_MBS_KNX_XML);
    const result = await applySignalsXlsx(doc, "mbs-knx", await exportedTable());
    expect(result).toMatchObject({ rows: 5, appended: 5, updated: 0, removed: 0 });
    const signals = projectFromXml(doc).signals;
    expect(signals).toHaveLength(10);
    for (let i = 0; i < 5; i++) {
      expect(withoutIndexes(mbsKnxSignalRow(signals[i + 5]))).toEqual(withoutIndexes(mbsKnxSignalRow(signals[i])));
      expect(signals[i + 5].conversions).toEqual(signals[i].conversions);
      expect(signals[i + 5].virtual).toBe(false);
    }
  });

  it("replaces every signal, fixed ones included, with the rows of the file", async () => {
    const fixed = SYNTHETIC_MBS_KNX_XML.replace(
      '<Virtual Status="False" Fixed="False" General="False" />',
      '<Virtual Status="False" Fixed="True" General="False" />',
    );
    const template = await loadWorkbook(await exportedTable(MAPS_MBS_KNX_TEMPLATE_XML));
    const data = new Uint8Array(await workbookToBuffer(template));
    const doc = XmlDocument.parse(fixed);
    const result = await applySignalsXlsx(doc, "mbs-knx", data, "replace");
    expect(result).toMatchObject({ rows: 12, appended: 12, removed: 5 });
    const project = projectFromXml(doc);
    expect(project.signals.map((s) => s.id)).toEqual([...Array(12).keys()]);
    expect(project.signals[0].description).toBe("OnOff_Read");
    expect(doc.serialize()).not.toContain('Fixed="True"');
    // The project's signals used its conversions, but they are all replaced:
    // the file's list is taken without the "different conversions" guard.
    expect(project.conversions).toHaveLength(15);
  });

  // Writes and reads a 5,001-row workbook: slower than the default timeout.
  it("refuses a table above the row limit before replacing anything", async () => {
    const workbook = await loadWorkbook(await exportedTable());
    const sheet = workbook.getWorksheet("Signals")!;
    const first = sheet.getRow(8).values as string[];
    for (let i = 5; i < MAX_SIGNAL_ROWS + 1; i++) {
      const row = [...first];
      row[1] = String(i + 1);
      row[10] = String(i + 1);
      sheet.getRow(8 + i).values = row;
    }
    // The last row is invalid: it must not be dropped unseen.
    sheet.getRow(8 + MAX_SIGNAL_ROWS).getCell(6).value = "not an address";
    const data = new Uint8Array(await workbookToBuffer(workbook));
    const doc = XmlDocument.parse(SYNTHETIC_MBS_KNX_XML);
    const before = doc.serialize();
    const error = await applySignalsXlsx(doc, "mbs-knx", data, "replace").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 422 });
    expect((error as Error).message).toContain(`more than ${MAX_SIGNAL_ROWS} signals`);
    expect(doc.serialize()).toBe(before);
  }, 30_000);

  it("keeps the add-mode guard: a different list is refused when signals keep their conversions", async () => {
    const data = await exportedTable(MAPS_MBS_KNX_TEMPLATE_XML);
    const doc = XmlDocument.parse(SYNTHETIC_MBS_KNX_XML);
    await expect(applySignalsXlsx(doc, "mbs-knx", data, "add")).rejects.toThrow(/different from the project's conversions/);
  });

  it("imports a table written by MAPS: prefixed XML, read by position", async () => {
    const data = withOpenXmlPrefixes(await exportedTable());
    expect(strFromU8(unzipSync(data)["xl/worksheets/sheet1.xml"])).toContain("<x:worksheet");
    const doc = XmlDocument.parse(SYNTHETIC_MBS_KNX_XML);
    await applySignalsXlsx(doc, "mbs-knx", data);
    const signals = projectFromXml(doc).signals;
    expect(signals).toHaveLength(10);
    for (let i = 0; i < 5; i++) {
      expect(withoutIndexes(mbsKnxSignalRow(signals[i + 5]))).toEqual(withoutIndexes(mbsKnxSignalRow(signals[i])));
    }
  });

  it("still imports the tables earlier MAPS Web versions exported", async () => {
    const workbook = await loadWorkbook(await exportedTable());
    const sheet = workbook.getWorksheet("Signals")!;
    EARLIER_MAPS_WEB_HEADERS.forEach((header, i) => (sheet.getRow(7).getCell(i + 1).value = header));
    sheet.getRow(8).getCell(11).value = "9.001";
    const doc = XmlDocument.parse(SYNTHETIC_MBS_KNX_XML);
    await applySignalsXlsx(doc, "mbs-knx", new Uint8Array(await workbookToBuffer(workbook)));
    const signals = projectFromXml(doc).signals;
    expect(withoutIndexes(mbsKnxSignalRow(signals[5]))).toEqual(withoutIndexes(mbsKnxSignalRow(signals[0])));
  });

  it("rejects a table whose columns are not the MBS–KNX ones", async () => {
    const workbook = await loadWorkbook(await exportedTable());
    workbook.getWorksheet("Signals")!.getRow(7).getCell(12).value = "Sending address";
    const data = new Uint8Array(await workbookToBuffer(workbook));
    await expect(applySignalsXlsx(XmlDocument.parse(SYNTHETIC_MBS_KNX_XML), "mbs-knx", data)).rejects.toThrow(
      /column 12 is "Sending address", expected "Group Address"/,
    );
  });

  it.each(["0.257", "1.257", "256.001", "1.255", "9.000", "1.X", "1.001 switch", ""])(
    "rejects the DPT %j before encoding it",
    async (dpt) => {
      const data = await editCells(await exportedTable(), [{ row: 0, header: "DPT", value: dpt }]);
      await expect(applySignalsXlsx(XmlDocument.parse(SYNTHETIC_MBS_KNX_XML), "mbs-knx", data)).rejects.toThrow(
        `signal 1: DPT "${dpt}"`,
      );
    },
  );

  it.each(["14.000", "1.x", "9.001: temperature (ºC)", "255.254"])("accepts the DPT %j", async (dpt) => {
    const data = await editCells(await exportedTable(), [{ row: 0, header: "DPT", value: dpt }]);
    await expect(applySignalsXlsx(XmlDocument.parse(SYNTHETIC_MBS_KNX_XML), "mbs-knx", data)).resolves.toMatchObject({
      appended: 5,
    });
  });

  it("keeps the flags of the file, like MAPS, without fitting them to R/W", async () => {
    // Row 1 is Read (mode "write"): a grid edit would clear R and T.
    const data = await editCells(await exportedTable(), [
      { row: 1, header: "R", value: "R" },
      { row: 1, header: "T", value: "T" },
    ]);
    const doc = XmlDocument.parse(SYNTHETIC_MBS_KNX_XML);
    await applySignalsXlsx(doc, "mbs-knx", data);
    expect(projectFromXml(doc).signals[6].knx.flags).toEqual({ u: true, t: true, ri: false, w: true, r: true });
  });

  it("reads an empty address of an inactive row as 0", async () => {
    const data = await editCells(await exportedTable(), [{ row: 4, header: "Address", value: "" }]);
    const doc = XmlDocument.parse(SYNTHETIC_MBS_KNX_XML);
    await applySignalsXlsx(doc, "mbs-knx", data);
    expect(projectFromXml(doc).signals[9].modbus.address).toBe(0);
  });

  it("rejects the whole file when a cell is invalid, listing each one and changing nothing", async () => {
    const data = await editCells(await exportedTable(), [
      { row: 0, header: "Address", value: "20001" },
      { row: 1, header: "DPT", value: "0.257" },
      { row: 2, header: "U", value: "X" },
      { row: 3, header: "Read / Write", value: "-" },
      { row: 3, header: "Priority", value: "Low" },
      { row: 0, header: "Data Length", value: "8" },
    ]);
    const doc = XmlDocument.parse(SYNTHETIC_MBS_KNX_XML);
    const before = doc.serialize();
    const error = await applySignalsXlsx(doc, "mbs-knx", data).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 422 });
    const message = (error as Error).message;
    expect(message).toContain('signal 1: Data Length "8"');
    expect(message).toContain('signal 1: Address "20001"');
    expect(message).toContain('signal 2: DPT "0.257"');
    expect(message).toContain('signal 3: U "X"');
    expect(message).toContain('signal 4: Read / Write "-"');
    expect(message).toContain('signal 4: Priority "Low"');
    expect(doc.serialize()).toBe(before);
  });

  it("rejects an address left empty on an active row", async () => {
    const data = await editCells(await exportedTable(), [{ row: 0, header: "Address", value: "" }]);
    await expect(applySignalsXlsx(XmlDocument.parse(SYNTHETIC_MBS_KNX_XML), "mbs-knx", data)).rejects.toThrow(
      /signal 1: Address ""/,
    );
  });

  it("rejects rows whose # is not consecutive", async () => {
    const data = await editCells(await exportedTable(), [{ row: 2, header: "#", value: "7" }]);
    await expect(applySignalsXlsx(XmlDocument.parse(SYNTHETIC_MBS_KNX_XML), "mbs-knx", data)).rejects.toThrow(
      /signal 7: "#" is not in order, expected 3/,
    );
  });

  it("rejects a table of another family", async () => {
    const project = knxMbmFromXml(XmlDocument.parse(SYNTHETIC_KNX_MBM_XML));
    const data = new Uint8Array(await buildSignalsXlsx({ family: "knx-mbm", project }, { now: NOW }));
    await expect(applySignalsXlsx(XmlDocument.parse(SYNTHETIC_MBS_KNX_XML), "mbs-knx", data)).rejects.toThrow(
      /not a Modbus Slave ↔ KNX table/,
    );
  });

  it("keeps a two-level sending address in its notation", async () => {
    const source = XmlDocument.parse(SYNTHETIC_MBS_KNX_XML);
    updateSignal(source, 0, { knx: { groupAddress: 2563, groupAddressLevel: 2 } });
    const doc = XmlDocument.parse(SYNTHETIC_MBS_KNX_XML);
    await applySignalsXlsx(doc, "mbs-knx", await exportedTable(source.serialize()));
    expect(doc.serialize()).toContain('<SendingAddress Value="2563" String="1/515" />');
  });
});
