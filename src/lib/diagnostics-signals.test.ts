import { describe, expect, it } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { SYNTHETIC_MBS_KNX_XML } from "@/gateway-families/mbs-knx/fixtures/synthetic-project";
import { projectFromXml as mbsKnxFromXml } from "@/gateway-families/mbs-knx/from-xml";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { projectFromXml as knxMbmFromXml } from "@/gateway-families/knx-mbm/from-xml";
import type { ProjectView } from "./project-types";
import { parseMonitorLine } from "./diagnostics-parsing";
import { diagnosticSignals, diagnosticStreamValues, signalCommand } from "./diagnostics-signals";

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

  it("keeps an honest empty state for missing or unsupported projects", () => {
    expect(diagnosticSignals(null)).toBeNull();
    expect(diagnosticSignals({ family: "me-mbs" } as ProjectView)).toBeNull();
  });
});
