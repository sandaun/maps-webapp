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

  it("exports me-mbs rows with InternalMbs-style columns", async () => {
    const project = meFromXml(XmlDocument.parse(SYNTHETIC_ME_MBS_XML));
    const buf = await buildSignalsXlsx("me-mbs", project, { now: NOW });
    const parsed = await parseSignalsXlsx(new Uint8Array(buf));
    expect(parsed.internalProtocol).toBe("Modbus Slave");
    expect(parsed.headers[0]).toBe("#");
    expect(parsed.rows.length).toBe(project.signals.length);
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
