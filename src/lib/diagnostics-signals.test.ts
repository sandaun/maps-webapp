import { describe, expect, it } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { SYNTHETIC_MBS_KNX_XML } from "@/gateway-families/mbs-knx/fixtures/synthetic-project";
import { projectFromXml as mbsKnxFromXml } from "@/gateway-families/mbs-knx/from-xml";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { projectFromXml as knxMbmFromXml } from "@/gateway-families/knx-mbm/from-xml";
import { SYNTHETIC_ME_MBS_XML } from "@/gateway-families/me-mbs/fixtures/synthetic-project";
import { projectFromXml as meFromXml } from "@/gateway-families/me-mbs/from-xml";
import type { ProjectView } from "./project-types";
import { parseMonitorLine } from "./diagnostics-parsing";
import { diagnosticSignals, diagnosticStreamValues, meConsoleId, signalCommand } from "./diagnostics-signals";

function mbsView(): Extract<ProjectView, { family: "mbs-knx" }> {
  return {
    family: "mbs-knx", project: mbsKnxFromXml(XmlDocument.parse(SYNTHETIC_MBS_KNX_XML)),
    meta: { id: "test", name: "test", description: "", source: "file", family: "mbs-knx", updatedAt: "" },
    mapsVersion: "", passwordValid: false, issues: [], hasCompleteBlob: false,
  };
}

describe("diagnostic signal runtime mapping", () => {
  it("uses sorted active MBS ids and project-order active KNX ids", () => {
    const view = mbsView();
    const rows = view.project.signals;
    rows[0].modbus.address = 20;
    rows[1].active = false;
    rows[2].modbus.address = 10;
    rows[2].modbus.bit = 3;
    rows[3].modbus.address = 10;
    rows[3].modbus.bit = 1;
    const signals = diagnosticSignals(view)!;
    expect(signals[0].endpoints).toEqual({ knx: "1KX:00010801", mb: "0MS:00000002" });
    expect(signals[2].endpoints).toEqual({ knx: "1KX:00020803", mb: "0MS:00000001" });
    expect(signals[3].endpoints).toEqual({ knx: "1KX:00030805", mb: "0MS:00000000" });
    expect(signals[1].endpoints).toEqual({});
    expect(signals[2].mapping).toBe("10.3 ⇄ 1/0/3");
    expect(signalCommand(signals[0], "mb")).toBe("0MS:00000002?");
    expect(signalCommand(signals[0], "mb", "22.5")).toBe("0MS:00000002=22.5;");
    expect(signalCommand(signals[2], "knx", "1")).toBe("1KX:00020803=1");
    expect(signalCommand(signals[1], "mb", "1")).toBeNull();
    expect(signalCommand(signals[1], "knx")).toBeNull();
  });

  it("keeps reads available while blocking writes according to each side's permissions", () => {
    const signals = diagnosticSignals(mbsView())!;
    // Room temperature: MBS Read, KNX U/W. Reset: MBS Trigger, KNX T/R.
    expect(signals[1].writable).toEqual({ knx: true, mb: false });
    expect(signals[3].writable).toEqual({ knx: false, mb: true });
    expect(signalCommand(signals[1], "mb")).toBe("0MS:00000001?");
    expect(signalCommand(signals[1], "mb", "1")).toBeNull();
    expect(signalCommand(signals[3], "knx")).toBe("1KX:00040805?");
    expect(signalCommand(signals[3], "knx", "1")).toBeNull();
    expect(signalCommand(signals[3], "mb", "1")).toBe("0MS:00000003=1;");
  });

  it("matches incoming values by port, id and GA even when GAs repeat", () => {
    const view = mbsView();
    view.project.signals[1].knx.groupAddress = view.project.signals[0].knx.groupAddress;
    const signals = diagnosticSignals(view)!;
    const frames = [
      "1KX:00010801=0;0", "1KX:00020801=22.5;0", "0MS:00000001=225;0",
      "0KX:00020801=99;0", "1MM:00000001=99;0",
    ].map((line, index) => parseMonitorLine(line, index, ""));
    expect(Object.fromEntries(diagnosticStreamValues(signals, frames))).toEqual({
      "0|knx": "0", "1|knx": "22.5", "1|mb": "225",
    });
    frames.push(parseMonitorLine("1KX:00020801=f;0", 5, ""));
    expect(diagnosticStreamValues(signals, frames).has("1|knx")).toBe(false);
  });

  it("preserves KNX–MBM console ids and mappings", () => {
    const project = knxMbmFromXml(XmlDocument.parse(SYNTHETIC_KNX_MBM_XML));
    const view = { ...mbsView(), family: "knx-mbm", project } as ProjectView;
    const signals = diagnosticSignals(view)!;
    const signal = signals.find((row) => row.active)!;
    expect(signal.endpoints.knx).toMatch(/^0KX:/);
    expect(signal.endpoints.mb).toBe("1MM:00000000");
    expect(signal.mapping).toContain("⇄ s");
  });

  it("uses the internal KNX and external MBM permission rules for KNX–MBM", () => {
    const project = knxMbmFromXml(XmlDocument.parse(SYNTHETIC_KNX_MBM_XML));
    const row = project.signals.find((signal) => signal.active)!;
    row.knx.flags.u = true;
    row.knx.flags.w = false;
    row.modbus.readFunc = -1;
    const view = { ...mbsView(), family: "knx-mbm", project } as ProjectView;
    expect(diagnosticSignals(view)!.find((signal) => signal.id === row.id)!.writable).toEqual({ knx: false, mb: false });
    row.knx.flags.w = true;
    row.modbus.readFunc = 3;
    row.modbusVirtual = true;
    expect(diagnosticSignals(view)!.find((signal) => signal.id === row.id)!.writable).toEqual({ knx: true, mb: false });
    row.modbusVirtual = false;
    expect(diagnosticSignals(view)!.find((signal) => signal.id === row.id)!.writable).toEqual({ knx: true, mb: true });
  });

  it("maps ME IDs from controller, group and status, and MBS IDs from sorted active rows", () => {
    const project = meFromXml(XmlDocument.parse(SYNTHETIC_ME_MBS_XML));
    const view = { ...mbsView(), family: "me-mbs", project } as ProjectView;
    project.signals[0].active = false;
    const row = project.signals[2];
    row.modbus.address = 1;
    row.me.isVirtual = false;
    row.me.g50Index = 1;
    row.me.groupIndex = 2;
    row.me.signalIndex = 0;
    const signals = diagnosticSignals(view)!;
    expect(signals[0].endpoints).toEqual({});
    expect(signals[2].endpoints).toEqual({ me: "1ME:00004300", mb: "0MS:00000000" });
    expect(signals[2].mapping).toBe("1 ⇄ C2/G3");
    expect(signalCommand(signals[2], "me")).toBe("1ME:00004300?");
    expect(signalCommand(signals[2], "me", "1")).toBe("1ME:00004300=1");
    row.me.isStatus = false;
    expect(meConsoleId(row.me)).toBe("00004380");
    expect(signalCommand(diagnosticSignals(view)![2], "me", "1")).toBeNull();
    row.me.isVirtual = true;
    expect(meConsoleId(row.me)).toBe("00004080");
    expect(signalCommand(diagnosticSignals(view)![2], "me", "1")).toBeNull();
    expect(signals[0].writable.mb).toBe(false);
  });

  it("handles ME unit IDs and updates every row sharing an ME endpoint", () => {
    const project = meFromXml(XmlDocument.parse(SYNTHETIC_ME_MBS_XML));
    const view = { ...mbsView(), family: "me-mbs", project } as ProjectView;
    const me = project.signals[2].me;
    me.isVirtual = false;
    me.groupIndex = -1;
    me.unitId = 0;
    me.signalIndex = 0;
    expect(meConsoleId(me)).toBe("00000140");
    me.unitId = 50;
    expect(meConsoleId(me)).toBe("00000160");
    project.signals[3].me = { ...me };
    const signals = diagnosticSignals(view)!;
    const frames = ["1ME:00000160=1;0", "0MS:00000002=10;0"]
      .map((line, i) => parseMonitorLine(line, i, ""));
    const values = diagnosticStreamValues(signals, frames);
    expect(values.get("2|me")).toBe("1");
    expect(values.get("3|me")).toBe("1");
    expect(values.get("2|mb")).toBe("10");
  });

  it("keeps an honest empty state for missing projects", () => {
    expect(diagnosticSignals(null)).toBeNull();
  });
});
