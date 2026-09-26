import { describe, expect, it } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { projectFromXml } from "@/gateway-families/knx-mbm";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { projectFromXml as meFromXml } from "@/gateway-families/me-mbs";
import { SYNTHETIC_ME_MBS_XML } from "@/gateway-families/me-mbs/fixtures/synthetic-project";
import { applySignalsXlsx } from "@/server/imports/xlsx-signals";
import { buildKnxEsf } from "@/server/exports/esf-knx";
import { parseSignalsXlsx, buildSignalsXlsx } from "@/server/exports/xlsx-signals";
import { buildPollPlanXlsx } from "@/server/exports/xlsx-poll-plan";
import { conversionSheetRows } from "@/server/exports/maps-grid-values";
import { cellText, loadWorkbook } from "@/server/exports/xlsx-workbook";

const NOW = new Date(2026, 0, 1);

describe("signals XLSX", () => {
  it("round-trips a knx-mbm table with desktop headers and appends on import", async () => {
    const project = projectFromXml(XmlDocument.parse(SYNTHETIC_KNX_MBM_XML));
    const buf = await buildSignalsXlsx("knx-mbm", project, { now: NOW });
    const parsed = await parseSignalsXlsx(new Uint8Array(buf));
    expect(parsed.internalProtocol).toBe("KNX");
    expect(parsed.externalProtocol).toBe("Modbus Master");
    expect(parsed.headers.slice(0, 6)).toEqual(["#", "Active", "Description", "DPT", "Sending", "Listening"]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]?.[2]).toBe("Heat pump on/off");
    expect(parsed.rows[0]?.[4]).toBe("1/0/3");
    expect(parsed.rows[0]?.[3]).toBe("1.001");

    const doc = XmlDocument.parse(SYNTHETIC_KNX_MBM_XML);
    const result = await applySignalsXlsx(doc, "knx-mbm", new Uint8Array(buf));
    expect(result.appended).toBe(2);
    expect(projectFromXml(doc).signals).toHaveLength(4);
  });

  it("exports knx-mbm conversions like MAPS: Conv. Id + Conversions columns and a Conversions sheet", async () => {
    const project = projectFromXml(XmlDocument.parse(SYNTHETIC_KNX_MBM_XML));
    const buf = await buildSignalsXlsx("knx-mbm", project, { now: NOW });
    const parsed = await parseSignalsXlsx(new Uint8Array(buf));
    expect(parsed.headers.slice(-2)).toEqual(["Conv. Id", "Conversions"]);
    expect(parsed.rows[0]?.slice(-2)).toEqual(["-", "-"]);
    expect(parsed.rows[1]?.slice(-2)).toEqual(["DIRECTION[>/<]:INDEXES[-;0;-;-]", "Enabled"]);

    const sheet = (await loadWorkbook(new Uint8Array(buf))).getWorksheet("Conversions");
    const row = sheet!.getRow(2);
    expect([1, 2, 3, 4, 5, 6, 7].map((c) => cellText(row.getCell(c).value))).toEqual([
      "0",
      "x0.1 to degC",
      "SCALE",
      "0",
      "1000",
      "0",
      "100",
    ]);
  });

  it("numbers the Conversions sheet by position in the filters and operations lists", () => {
    const conv = (id: number, type: number) => ({ id, description: `c${id}`, type, params: ["0", "0", "0", "0"] as [string, string, string, string] });
    const rows = conversionSheetRows([conv(0, 2), conv(0, 0), conv(7, 1), conv(3, 0)]);
    expect(rows.map((r) => [r[0], r[1], r[2]])).toEqual([
      ["0", "c0", "FILTER"],
      ["1", "c3", "FILTER"],
      ["0", "c0", "ARITH"],
      ["1", "c7", "SCALE"],
    ]);
  });

  it("exports me-mbs rows with InternalMbs-style columns", async () => {
    const project = meFromXml(XmlDocument.parse(SYNTHETIC_ME_MBS_XML));
    const buf = await buildSignalsXlsx("me-mbs", project, { now: NOW });
    const parsed = await parseSignalsXlsx(new Uint8Array(buf));
    expect(parsed.internalProtocol).toBe("Modbus Slave");
    expect(parsed.headers[0]).toBe("#");
    expect(parsed.rows.length).toBe(project.signals.length);
    // ME–MBS disables conversions, so MAPS writes no Conversions sheet.
    expect((await loadWorkbook(new Uint8Array(buf))).getWorksheet("Conversions")).toBeUndefined();
  });
});

describe("ESF export", () => {
  it("writes Main.Middle.Sub TSV that EsfProjectParser can read", () => {
    const project = projectFromXml(XmlDocument.parse(SYNTHETIC_KNX_MBM_XML));
    const esf = buildKnxEsf(project);
    expect(esf).toContain("1.0.3\tHeat pump on/off\t1.001");
  });
});

describe("poll plan XLSX", () => {
  it("emits GetMyRow columns even when poll records are disabled in XML", async () => {
    const doc = XmlDocument.parse(SYNTHETIC_KNX_MBM_XML);
    const buf = await buildPollPlanXlsx(doc, { projectName: "synthetic", now: NOW });
    const wb = await loadWorkbook(new Uint8Array(buf));
    const sheet = wb.getWorksheet("Poll plan");
    expect(sheet).toBeDefined();
    expect(cellText(sheet!.getRow(7).getCell(2).value)).toBe("Device");
    expect(cellText(sheet!.getRow(8).getCell(2).value)).toMatch(/^RTU \/\/ Port A \/\/ Heat pump$/);
    expect(cellText(sheet!.getRow(8).getCell(3).value)).toBe("3: Read Holding Registers");
  });
});
