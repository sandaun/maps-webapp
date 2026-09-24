import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { parseGroupAddress, parseDpt } from "@/protocols/knx";
import { SYNTHETIC_KNX_MBM_XML } from "./fixtures/synthetic-project";
import { projectFromXml } from "./from-xml";
import { validateProject } from "./validate";
import type { KnxMbmProject } from "./model";

function validProject(): KnxMbmProject {
  return projectFromXml(XmlDocument.parse(SYNTHETIC_KNX_MBM_XML));
}

function codes(project: KnxMbmProject): string[] {
  return validateProject(project).map((i) => i.code);
}

describe("validateProject", () => {
  it("accepts the synthetic fixture without errors", () => {
    const issues = validateProject(validProject());
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("flags Ri+R incompatibility", () => {
    const project = validProject();
    project.signals[0].knx.flags.ri = true;
    project.signals[0].knx.flags.r = true;
    expect(codes(project)).toContain("KNX-FLAGS-RI-R");
  });

  it("skips Modbus checks for virtual signals (comm-error status, real-gateway pattern)", () => {
    const project = validProject();
    // Mirrors signal #0 of the real IN701KNX fixture: a gateway-generated
    // "Comm Error" status with no Modbus endpoint (funcs/address unset).
    project.signals[0].virtual = true;
    project.signals[0].modbus.readFunc = -1;
    project.signals[0].modbus.writeFunc = -1;
    project.signals[0].modbus.address = -1;
    const errs = validateProject(project).filter(
      (i) => i.severity === "error" && i.ref?.entity === "signal" && i.ref?.id === 0,
    );
    expect(errs).toEqual([]);
  });

  it("warns when a device Index or TCP NodeIndex does not match its position", () => {
    const project = validProject();
    project.mbm.rtuNodes[0].devices[0].index = 2;
    const issue = validateProject(project).find((i) => i.code === "MB-DEVICE-INDEX");
    expect(issue).toMatchObject({ severity: "warning", ref: { id: "rtu:0:0" } });
  });

  it("requires at least one flag", () => {
    const project = validProject();
    project.signals[0].knx.flags = { u: false, t: false, ri: false, w: false, r: false };
    expect(codes(project)).toContain("KNX-FLAGS-NONE");
  });

  it("requires U or W when additional addresses exist", () => {
    const project = validProject();
    project.signals[0].knx.flags.u = false;
    project.signals[0].knx.flags.w = false;
    expect(codes(project)).toContain("KNX-FLAGS-LISTEN");
  });

  it("flags group address above 15/7/255 without extended addresses", () => {
    const project = validProject();
    project.signals[0].knx.groupAddress = parseGroupAddress("16/0/1")!;
    expect(codes(project)).toContain("KNX-GA-EXTENDED");
    project.knx.extendedAddresses = true;
    expect(codes(project)).not.toContain("KNX-GA-EXTENDED");
  });

  it("flags unsupported DPT", () => {
    const project = validProject();
    project.signals[0].knx.dpt = parseDpt("10.001")!;
    expect(codes(project)).toContain("KNX-DPT-INVALID");
  });

  it("flags references to missing devices", () => {
    const project = validProject();
    project.signals[0].modbus.deviceIndex = 9;
    expect(codes(project)).toContain("SIG-DEVICE-REF");
  });

  it("flags RTU signals when media is TCP only", () => {
    const project = validProject();
    project.mbm.media = 1;
    expect(codes(project)).toContain("MB-MEDIA");
  });

  it("warns on cross-protocol flag mismatch (does not block)", () => {
    const project = validProject();
    // signal 1: readFunc=3, KNX flags T=true R=true → fine. Make them false.
    project.signals[1].knx.flags = { u: false, t: false, ri: false, w: true, r: false };
    const issues = validateProject(project);
    const warning = issues.find((i) => i.code === "XFLAG-RT-READ");
    expect(warning?.severity).toBe("warning");
  });

  it("warns on overlapping register reads", () => {
    const project = validProject();
    // signal 1 reads 2 regs from 20; make signal 0 read 1 reg from 21.
    project.signals[0].modbus.readFunc = 3;
    project.signals[0].modbus.address = 21;
    expect(codes(project)).toContain("MB-REG-OVERLAP");
  });

  it("enforces the active-signal limit", () => {
    const project = validProject();
    const template = project.signals[0];
    for (let i = 2; i <= 3001; i++) {
      project.signals.push({ ...template, id: i });
    }
    expect(codes(project)).toContain("SIG-LIMIT-ACTIVE");
  });

  it("flags duplicate slave ids within a node", () => {
    const project = validProject();
    project.mbm.rtuNodes[0].devices.push({
      index: 1,
      name: "Dup",
      manufacturer: "",
      slave: 1,
      baseRegister: 0,
      timeout: 1000,
      enabled: true,
    });
    expect(codes(project)).toContain("MB-SLAVE-DUP");
  });
});

/**
 * Real IN701KNX fixture received from a live gateway (2026-09-01). Never
 * committed (may contain credentials) — skipped when absent.
 */
const REAL_IBMAPS = ".local-data/fixtures/knx-mbm-2026-09-01.ibmaps.xml";
const hasRealFixture = existsSync(REAL_IBMAPS);

describe.skipIf(!hasRealFixture)("real KNX–MBM fixture (present only in the local checkout)", () => {
  it("parses and validates without errors (incl. virtual comm-error signals)", () => {
    const project = projectFromXml(XmlDocument.parse(readFileSync(REAL_IBMAPS, "utf8")));
    expect(project.signals.length).toBeGreaterThan(0);
    expect(validateProject(project).filter((i) => i.severity === "error")).toEqual([]);
  });
});
