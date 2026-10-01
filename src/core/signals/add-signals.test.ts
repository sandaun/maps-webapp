import { describe, expect, it } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { projectFromXml as masterProject, validateProject as validateMaster } from "@/gateway-families/knx-mbm";
import { projectFromXml as slaveProject } from "@/gateway-families/mbs-knx";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { SYNTHETIC_MBS_KNX_XML } from "@/gateway-families/mbs-knx/fixtures/synthetic-project";
import { planAddSignals, signalDeviceOptions } from "./add-signals";
import { addPlannedSignals } from "@/server/projects/add-signals";

const master = () => masterProject(XmlDocument.parse(SYNTHETIC_KNX_MBM_XML));
const slave = () => slaveProject(XmlDocument.parse(SYNTHETIC_MBS_KNX_XML));

describe("signal creation planning", () => {
  it("reserves disabled signals, listening GAs and the full width of registers", () => {
    const project = master();
    project.signals = [project.signals[0]];
    project.signals[0].active = false;
    project.signals[0].modbus.address = 10;
    project.signals[0].modbus.lenBits = 32;
    project.signals[0].modbus.readFunc = 3;
    project.signals[0].knx.groupAddress = 100;
    project.signals[0].knx.additionalAddresses = [110];
    project.signals[0].description = "Signal 2";
    const plan = planAddSignals(project, { count: 3, profile: "unsigned32" });
    expect(plan.entries.map((e) => e.address)).toEqual([12, 14, 16]);
    expect(plan.entries.map((e) => e.groupAddress)).toEqual([111, 112, 113]);
    expect(plan.entries.map((e) => e.description)).toEqual(["Signal 3", "Signal 4", "Signal 5"]);
    expect(plan.entries[0]).toMatchObject({ lenBits: 32, writeFunc: 16, dpt: 3327 });
  });

  it("requires an unambiguous enabled device and respects its register base", () => {
    const project = master();
    const original = project.mbm.rtuNodes[0].devices[0];
    project.mbm.rtuNodes[0].devices.push({ ...original, index: 1, name: "Second", baseRegister: 1 });
    expect(() => planAddSignals(project, { count: 1 })).toThrow("Choose a Modbus device");
    const plan = planAddSignals(project, { count: 1, device: { port: 0, deviceIndex: 1 } });
    expect(plan.entries[0].address).toBe(1);
    original.enabled = false;
    expect(signalDeviceOptions(project)).toHaveLength(1);
    expect(() => planAddSignals(project, { count: 1, device: { port: 0, deviceIndex: 0 } })).toThrow();
    project.mbm.media = 1;
    expect(() => planAddSignals(project, { count: 1 })).toThrow("Add and enable");
  });

  it("rejects collisions anywhere in a requested batch and never wraps addresses", () => {
    const project = slave();
    project.signals[0].knx.groupAddress = 32767;
    expect(() => planAddSignals(project, { count: 1 })).toThrow("KNX");
    expect(() => planAddSignals(project, { count: 2, groupAddress: 32766 })).toThrow("KNX");
    expect(() => planAddSignals(project, { count: 1, groupAddress: 10, address: project.signals[0].modbus.address })).toThrow("Modbus");
    expect(() => planAddSignals(project, { count: 2, groupAddress: 10, address: 19999, profile: "unsigned32" })).toThrow("Modbus");
    project.knx.extendedAddresses = true;
    expect(planAddSignals(project, { count: 1 }).entries[0].groupAddress).toBe(32768);
  });

  it("separates total rows from active limits and validates count and insertion", () => {
    const project = slave();
    project.signals = Array.from({ length: 3000 }, (_, id) => ({ ...project.signals[0], id, active: true }));
    expect(() => planAddSignals(project, { count: 1, active: true })).toThrow("active");
    expect(planAddSignals(project, { count: 1, active: false }).entries[0].active).toBe(false);
    for (const count of [0, 501, 1.5, NaN]) expect(() => planAddSignals(project, { count })).toThrow();
    expect(() => planAddSignals(project, { count: 1, afterId: 9999 })).toThrow("no longer exists");
    project.signals = Array.from({ length: 5000 }, (_, id) => ({ ...project.signals[0], id }));
    expect(() => planAddSignals(project, { count: 1 })).toThrow("table");
  });

  it("creates complete master defaults without introducing validation issues", () => {
    const doc = XmlDocument.parse(SYNTHETIC_KNX_MBM_XML);
    addPlannedSignals(doc, "knx-mbm", { count: 3 });
    const project = masterProject(doc);
    const ids = new Set(project.signals.slice(-3).map((s) => s.id));
    expect(validateMaster(project).filter((i) => i.ref?.entity === "signal" && ids.has(Number(i.ref.id)))).toEqual([]);
    expect(project.signals.at(-1)).toMatchObject({ active: true, knx: { dpt: 257 }, modbus: { readFunc: 3, writeFunc: 6, bit: 0, numOfBits: 1 } });
  });
});
