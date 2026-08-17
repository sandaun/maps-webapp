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
