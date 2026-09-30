import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { projectFromXml, removeSignal, reorderSignalIds, updateDevice, updateSignal } from "@/gateway-families/knx-mbm";
import { MAPS_KNX_MBM_REFERENCE_XML } from "@/gateway-families/knx-mbm/fixtures/maps-reference";
import { buildSignalsXlsx, parseSignalsXlsx } from "@/server/exports/xlsx-signals";
import { KNX_SIGNAL_HEADERS, knxSignalRow } from "@/server/exports/maps-grid-values";
import { loadWorkbook, workbookToBuffer } from "@/server/exports/xlsx-workbook";
import { applySignalsXlsx } from "./xlsx-signals";

const NOW = new Date(2026, 0, 1);
/** A KNX–MBM table exported by MAPS 1.2.27 (113 signals, conversions), kept out of the repository. */
const REAL_STIEBEL_XLSX = ".local-data/fixtures/knx-mbm-ref/Stiebel Eltron WPM 3i - KNX.xlsx";

async function exportedTable(xml = MAPS_KNX_MBM_REFERENCE_XML): Promise<Uint8Array> {
  const project = { ...projectFromXml(XmlDocument.parse(xml)), name: "Project1" };
  return new Uint8Array(await buildSignalsXlsx({ family: "knx-mbm", project }, { now: NOW, mapsVersion: "1.2.31.0" }));
}

/** Set cells of the "Signals" sheet: `row` is the data row (0 = first signal), `column` 1-based. */
async function editCells(data: Uint8Array, edits: { row: number; column: number; value: string }[]) {
  const workbook = await loadWorkbook(data);
  const sheet = workbook.getWorksheet("Signals")!;
  for (const { row, column, value } of edits) sheet.getRow(8 + row).getCell(column).value = value;
  return new Uint8Array(await workbookToBuffer(workbook));
}

const column = (header: string, nth = 0) => KNX_SIGNAL_HEADERS.map((h, i) => [h, i] as const).filter(([h]) => h === header)[nth]![1] + 1;
const rows = (xml: string) => {
  const project = projectFromXml(XmlDocument.parse(xml));
  return project.signals.map((s) => knxSignalRow(project, s));
};

describe("signals XLSX · KNX–MBM", () => {
  it("exports the reference project exactly as MAPS 1.2.31 does", async () => {
    const data = await exportedTable();
    const parsed = await parseSignalsXlsx(data);
    expect(parsed.headers).toEqual([...KNX_SIGNAL_HEADERS]);
    expect(parsed.rows).toHaveLength(12);
    const sheet = (await loadWorkbook(data)).getWorksheet("Signals")!;
    const rawRow = (i: number) => Array.from({ length: 27 }, (_, c) => String(sheet.getRow(8 + i).getCell(c + 1).value ?? ""));
    // Rows of knx-to-modbus-master.xlsx, exported by MAPS from this same project.
    expect(rawRow(0)).toEqual(["1", "True", "Comm Error Device 0", "1.005: alarm", "0/0/100", "", " ", "T", " ", " ", "R", "3: Low", "1", "RTU // Port B // Device 0", "10", "0-based", "-", "-", "-", "-", "-", "-", "-", "-", "-", "", "-"]);
    expect(rawRow(3)).toEqual(["4", "True", "On_Off_R", "1.001: switch", "0/0/1", "", "  ", "T", "  ", "  ", "R", "3: Low", "4", "RTU // Port B // Device 0", "10", "0-based", "1: Read Coils", "-", "1", "-", "-", "0", "-", "-", "0", "", "-"]);
    expect(rawRow(4)).toEqual(["5", "True", "On_Off_W", "1.001: switch", "0/0/2", "", "U", "  ", "  ", "W", "  ", "3: Low", "5", "RTU // Port B // Device 0", "10", "0-based", "-", "5: Write Single Coil", "1", "-", "-", "1", "-", "-", "0", "", "-"]);
    expect(rawRow(6)).toEqual(["7", "True", "Temp_R", "9.001: temperature (ºC)", "0/0/4", "", "  ", "T", "  ", "  ", "R", "3: Low", "7", "RTU // Port B // Device 1", "11", "0-based", "3: Read Holding Registers", "-", "16", "0: Unsigned", "0: Big Endian", "0", "-", "-", "0", "", "-"]);
    expect(rawRow(11)).toEqual(["12", "True", "Counter_RW", "5.010: counter pulses (0..255)", "0/0/9", "", "U", "T", "  ", "W", "R", "3: Low", "12", "RTU // Port B // Device 2", "12", "0-based", "3: Read Holding Registers", "16: Write Multiple Registers", "32", "0: Unsigned", "0: Big Endian", "4", "-", "-", "0", "", "-"]);
    expect(parsed.conversionRows).toHaveLength(15);
  });

  it("writes the bit only for BitFields, the per-signal deadband and 1.x for a DPT MAPS cannot name", async () => {
    const doc = XmlDocument.parse(MAPS_KNX_MBM_REFERENCE_XML);
    updateSignal(doc, 6, { knx: { dpt: (10 << 8) | 255 }, modbus: { format: 4, bit: 3, numOfBits: 0, deadband: 2.5 } });
    const row = rows(doc.serialize())[6];
    expect(row[3]).toBe("1.x: (1-bit)");
    expect(row.slice(19, 25)).toEqual(["4: BitFields", "0: Big Endian", "0", "3", "1", "2.5"]);
  });

  it("replaces the signals keeping the virtual ones, and gives back the same table", async () => {
    const doc = XmlDocument.parse(MAPS_KNX_MBM_REFERENCE_XML);
    const result = await applySignalsXlsx(doc, "knx-mbm", await exportedTable(), "replace");
    expect(result).toMatchObject({ rows: 12, appended: 9, updated: 3, removed: 9, dropped: 0 });
    expect(rows(doc.serialize())).toEqual(rows(MAPS_KNX_MBM_REFERENCE_XML));
  });

  it("adds ordinary rows as new signals, not fixed, and lets virtual rows update the matching signal", async () => {
    const data = await editCells(await exportedTable(), [
      { row: 0, column: column("Description"), value: "Device 0 offline" },
      { row: 0, column: column("DPT"), value: "1.001: switch" },
      { row: 0, column: column("Group Address"), value: "2/0/100" },
    ]);
    const doc = XmlDocument.parse(MAPS_KNX_MBM_REFERENCE_XML);
    const result = await applySignalsXlsx(doc, "knx-mbm", data, "add");
    expect(result).toMatchObject({ appended: 9, updated: 3, removed: 0 });
    const signals = projectFromXml(doc).signals;
    expect(signals).toHaveLength(21);
    // Only state, description, addresses and priority change on a virtual row.
    expect(signals[0].description).toBe("Device 0 offline");
    expect(signals[0].knx.groupAddress).toBe(4196);
    expect(signals[0].knx.dpt).toBe((1 << 8) | 5);
    expect(signals[12].description).toBe("On_Off_R");
    expect(signals[12].modbusFixed).toBe(false);
  });

  it("drops a virtual row with no signal on its port and device, like MAPS", async () => {
    const doc = XmlDocument.parse(MAPS_KNX_MBM_REFERENCE_XML);
    // No signal left on device 2: its communication-error row has nothing to update.
    for (const s of projectFromXml(doc).signals.filter((s) => s.modbus.deviceIndex === 2)) removeSignal(doc, s.id);
    reorderSignalIds(doc);
    const result = await applySignalsXlsx(doc, "knx-mbm", await exportedTable(), "add");
    expect(result).toMatchObject({ dropped: 1, updated: 2, appended: 9 });
  });

  it("rejects the whole file when a cell is invalid, listing each one and changing nothing", async () => {
    const data = await editCells(await exportedTable(), [
      { row: 3, column: column("Device"), value: "RTU // Port B // Nowhere" },
      { row: 4, column: column("Bit"), value: "3" },
      { row: 5, column: column("Deadband"), value: "101" },
      { row: 6, column: column("Data Length"), value: "8" },
      { row: 7, column: column("Address"), value: "-" },
      { row: 8, column: column("Group Address"), value: "0/0/0" },
      { row: 9, column: column("# Slave"), value: "99" },
      { row: 10, column: column("Base"), value: "1-based" },
    ]);
    const doc = XmlDocument.parse(MAPS_KNX_MBM_REFERENCE_XML);
    const before = doc.serialize();
    const error = await applySignalsXlsx(doc, "knx-mbm", data, "replace").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 422 });
    const message = (error as Error).message;
    for (const text of [
      'signal 4: Device "RTU // Port B // Nowhere"',
      'signal 5: Bit "3"',
      'signal 6: Deadband "101"',
      'signal 7: Data Length "8"',
      'signal 8: Address "-"',
      'signal 9: Group Address "0/0/0"',
      'signal 10: # Slave "99"',
      'signal 11: Base "1-based"',
    ]) {
      expect(message).toContain(text);
    }
    expect(doc.serialize()).toBe(before);
  });

  it("still imports the tables earlier MAPS Web versions exported", async () => {
    const workbook = await loadWorkbook(await exportedTable());
    const sheet = workbook.getWorksheet("Signals")!;
    const earlier: Record<number, string> = { 5: "Sending", 6: "Listening", 13: "Index", 15: "Slave", 17: "Read", 18: "Write", 19: "Data length", 21: "Byte order", 24: "Bit length" };
    for (const [c, header] of Object.entries(earlier)) sheet.getRow(7).getCell(Number(c)).value = header;
    // Earlier versions named the first RTU node "Port A".
    for (let r = 8; r < 20; r++) {
      const cell = sheet.getRow(r).getCell(column("Device"));
      cell.value = String(cell.value).replace("Port B", "Port A");
    }
    const doc = XmlDocument.parse(MAPS_KNX_MBM_REFERENCE_XML);
    await applySignalsXlsx(doc, "knx-mbm", new Uint8Array(await workbookToBuffer(workbook)), "replace");
    expect(rows(doc.serialize())).toEqual(rows(MAPS_KNX_MBM_REFERENCE_XML));
  });

  it("imports a real MAPS 1.2.27 table when the project has its device", async () => {
    if (!existsSync(REAL_STIEBEL_XLSX)) return;
    const doc = XmlDocument.parse(MAPS_KNX_MBM_REFERENCE_XML);
    updateDevice(doc, { kind: "rtu", nodeIndex: 0, deviceIndex: 0 }, { name: "WPM 3i" });
    const result = await applySignalsXlsx(doc, "knx-mbm", new Uint8Array(readFileSync(REAL_STIEBEL_XLSX)), "replace");
    expect(result).toMatchObject({ rows: 113, appended: 112, updated: 1, dropped: 0 });
    const project = projectFromXml(doc);
    expect(project.conversions).toHaveLength(15);
    expect(knxSignalRow(project, project.signals[3]).slice(2)).toEqual(["Actual temperature FE7", "9.001: temperature (ºC)", "0/0/1", "", "  ", "T", "  ", "  ", "R", "3: Low", "4", "RTU // Port B // WPM 3i", "10", "0-based", "4: Read Input Registers", "-", "16", "1: Signed (C2)", "0: Big Endian", "501", "-", "-", "0", "DIRECTION[<]:INDEXES[-;-;3;-]", "Enabled"]);
  });
});
