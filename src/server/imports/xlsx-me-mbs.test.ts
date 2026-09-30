import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { projectFromXml, updateGroupAndSignals, updateMbsConfig, updateSignal } from "@/gateway-families/me-mbs";
import { SYNTHETIC_ME_MBS_XML } from "@/gateway-families/me-mbs/fixtures/synthetic-project";
import { buildSignalsXlsx, parseSignalsXlsx } from "@/server/exports/xlsx-signals";
import { ME_SIGNAL_HEADERS } from "@/server/exports/maps-grid-values";
import { loadWorkbook, workbookToBuffer } from "@/server/exports/xlsx-workbook";
import { applySignalsXlsx } from "./xlsx-signals";

const NOW = new Date(2026, 0, 1);
const REAL_ME_MBS_XML = ".local-data/fixtures/770air-me-mbs-2026-08-18.ibmaps.xml";
/** A table exported by MAPS 1.2.34 from base.ibmaps with the 50 groups of controller 1 enabled (kept out of the repository). */
const REAL_MAPS_DIR = ".local-data/fixtures/me-mbs-maps-ref/";

async function exportedTable(xml = SYNTHETIC_ME_MBS_XML): Promise<Uint8Array> {
  const project = projectFromXml(XmlDocument.parse(xml));
  return new Uint8Array(await buildSignalsXlsx({ family: "me-mbs", project }, { now: NOW }));
}

/** Set cells of the "Signals" sheet: `row` is the data row (0 = first signal), `header` the first column with that name. */
async function editCells(data: Uint8Array, edits: { row: number; header: string; value: string }[]) {
  const workbook = await loadWorkbook(data);
  const sheet = workbook.getWorksheet("Signals")!;
  for (const { row, header, value } of edits) {
    sheet.getRow(8 + row).getCell(ME_SIGNAL_HEADERS.indexOf(header as (typeof ME_SIGNAL_HEADERS)[number]) + 1).value = value;
  }
  return new Uint8Array(await workbookToBuffer(workbook));
}

describe("signals XLSX · ME–MBS", () => {
  it("exports the MAPS columns and cells: group and controller names, spec and signal index", async () => {
    const data = await exportedTable();
    const parsed = await parseSignalsXlsx(data);
    expect(parsed.headers).toEqual([...ME_SIGNAL_HEADERS]);
    expect(parsed.internalProtocol).toBe("Modbus Slave");
    expect(parsed.externalProtocol).toBe("Mitsubishi Electric");
    const sheet = (await loadWorkbook(data)).getWorksheet("Signals")!;
    const rawRow = (i: number) => Array.from({ length: 14 }, (_, c) => String(sheet.getRow(8 + i).getCell(c + 1).value ?? ""));
    expect(rawRow(0)).toEqual(["1", "True", "Centralized controller communication error  [0-Ok, 1-Communication error]", "16", "0: Unsigned", "0", "-", "0: Read", "-", "1", "-", "Controller 1", "0", "9"]);
    expect(rawRow(1)).toEqual(["2", "True", "On (all the groups)  [1-Set the groups On]", "16", "0: Unsigned", "2", "-", "1: Trigger", "-", "2", "-", "Controller 1", "2", "0"]);
    expect(rawRow(2)).toEqual(["3", "True", "On/Off  [0-Off, 1-On]", "16", "0: Unsigned", "100", "-", "2: Read / Write", "-", "3", "G1 - Office", "Controller 1", "0", "0"]);
    expect(rawRow(4)).toEqual(["5", "True", "Fan Speed IC  [0-Auto, 1-Low, 2-Mid2, 3-Mid1, 4-High]", "16", "0: Unsigned", "102", "-", "2: Read / Write", "-", "5", "G1 - Office", "Controller 1", "4", "2"]);
    // Conversions are disabled for this project: no Conversions sheet.
    expect((await loadWorkbook(data)).getWorksheet("Conversions")).toBeUndefined();
  });

  it("restores the state of the matching generated signals and adds none", async () => {
    const data = await editCells(await exportedTable(), [
      { row: 2, header: "Active", value: "False" },
      { row: 3, header: "Active", value: "False" },
      { row: 3, header: "Address", value: "900" },
      { row: 3, header: "Description", value: "ignored" },
    ]);
    const doc = XmlDocument.parse(SYNTHETIC_ME_MBS_XML);
    const result = await applySignalsXlsx(doc, "me-mbs", data, "replace");
    expect(result).toMatchObject({ rows: 9, appended: 0, updated: 9, ignored: 0 });
    const signals = projectFromXml(doc).signals;
    expect(signals).toHaveLength(9);
    expect(signals.map((s) => s.active)).toEqual([true, true, false, false, true, true, true, true, true]);
    // FIXED address mode: MAPS does not restore addresses; nothing else is restored either.
    expect(signals[3].modbus.address).toBe(101);
    expect(signals[3].description).not.toBe("ignored");
  });

  it("restores the address too in custom address mode", async () => {
    const source = XmlDocument.parse(SYNTHETIC_ME_MBS_XML);
    updateMbsConfig(source, { addressMode: 1 });
    const data = await editCells(await exportedTable(source.serialize()), [{ row: 3, header: "Address", value: "900" }]);
    const doc = XmlDocument.parse(source.serialize());
    await applySignalsXlsx(doc, "me-mbs", data, "replace");
    expect(projectFromXml(doc).signals[3].modbus.address).toBe(900);
  });

  it("ignores rows that match no generated signal", async () => {
    // Group 2 has no signals in the project, but controller 1 has this signal and spec.
    const data = await editCells(await exportedTable(), [{ row: 2, header: "Group", value: "G2" }]);
    const doc = XmlDocument.parse(SYNTHETIC_ME_MBS_XML);
    expect(await applySignalsXlsx(doc, "me-mbs", data, "replace")).toMatchObject({ updated: 8, ignored: 1 });
  });

  it("refuses Add signals, which MAPS does not offer for generated signals", async () => {
    await expect(applySignalsXlsx(XmlDocument.parse(SYNTHETIC_ME_MBS_XML), "me-mbs", await exportedTable(), "add")).rejects.toThrow(
      /only imports their table with "Replace signals"/,
    );
  });

  it("rejects the whole file when a cell is invalid, listing each one and changing nothing", async () => {
    const data = await editCells(await exportedTable(), [
      { row: 0, header: "Controller", value: "Controller" },
      { row: 1, header: "Group", value: "Group 1" },
      { row: 2, header: "Sig Specific Index", value: "99" },
      { row: 3, header: "Address", value: "82501" },
      { row: 4, header: "Active", value: "yes" },
    ]);
    const doc = XmlDocument.parse(SYNTHETIC_ME_MBS_XML);
    const before = doc.serialize();
    const error = await applySignalsXlsx(doc, "me-mbs", data, "replace").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 422 });
    const message = (error as Error).message;
    expect(message).toContain('signal 1: Controller "Controller"');
    expect(message).toContain('signal 2: Group "Group 1"');
    expect(message).toContain("signal 3: there are no objects for this signal in the project");
    expect(message).toContain('signal 4: Address "82501"');
    expect(message).toContain('signal 5: Active "yes"');
    expect(doc.serialize()).toBe(before);
  });

  it("round-trips a real 770 Air project", async () => {
    if (!existsSync(REAL_ME_MBS_XML)) return;
    const xml = readFileSync(REAL_ME_MBS_XML, "utf8");
    const source = XmlDocument.parse(xml);
    const first = projectFromXml(source).signals[0];
    updateSignal(source, first.id, { active: !first.active });
    const data = await exportedTable(source.serialize());
    const doc = XmlDocument.parse(xml);
    const result = await applySignalsXlsx(doc, "me-mbs", data, "replace");
    expect(result.ignored).toBe(0);
    expect(projectFromXml(doc).signals[0].active).toBe(!first.active);
  });

  // Regenerates 1,730 signals and compares every cell: slower than the default timeout.
  it("exports and imports the table MAPS 1.2.34 exported for the same project", async () => {
    if (!existsSync(REAL_MAPS_DIR + "membs.xlsx")) return;
    const doc = XmlDocument.parse(readFileSync(REAL_MAPS_DIR + "base.ibmaps", "utf8"));
    for (let group = 0; group < 50; group++) updateGroupAndSignals(doc, 0, group, { enabled: true });
    const project = { ...projectFromXml(doc), name: "Project1" };
    const maps = (await loadWorkbook(new Uint8Array(readFileSync(REAL_MAPS_DIR + "membs.xlsx")))).getWorksheet("Signals")!;
    const ours = (
      await loadWorkbook(new Uint8Array(await buildSignalsXlsx({ family: "me-mbs", project }, { mapsVersion: "1.2.34.0" })))
    ).getWorksheet("Signals")!;
    expect(ours.rowCount).toBe(maps.rowCount);
    const text = (sheet: typeof maps, r: number) => Array.from({ length: 14 }, (_, c) => String(sheet.getRow(r).getCell(c + 1).value ?? ""));
    // Every cell but the timestamp (B6), which is the export date.
    for (let r = 1; r <= maps.rowCount; r++) {
      if (r === 6) continue;
      expect(text(ours, r)).toEqual(text(maps, r));
    }
    const result = await applySignalsXlsx(doc, "me-mbs", new Uint8Array(readFileSync(REAL_MAPS_DIR + "membs.xlsx")), "replace");
    expect(result).toMatchObject({ rows: 1730, updated: 1730, ignored: 0 });
  }, 30_000);
});
