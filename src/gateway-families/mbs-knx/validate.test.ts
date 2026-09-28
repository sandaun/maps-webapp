import { describe, expect, it } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { SYNTHETIC_MBS_KNX_XML } from "./fixtures/synthetic-project";
import { projectFromXml } from "./from-xml";
import type { MbsKnxProject, MbsKnxSignal } from "./model";
import { validateProject } from "./validate";

function project(): MbsKnxProject {
  return projectFromXml(XmlDocument.parse(SYNTHETIC_MBS_KNX_XML));
}

function codes(p: MbsKnxProject): string[] {
  return validateProject(p).map((i) => i.code);
}

/** A 16-bit unsigned read/write signal with valid KNX settings. */
function signal(id: number, modbus: Partial<MbsKnxSignal["modbus"]>, knx: Partial<MbsKnxSignal["knx"]> = {}): MbsKnxSignal {
  return {
    id,
    active: true,
    description: `S${id}`,
    modbus: { address: id, bit: 255, lenBits: 16, format: 0, readWrite: 2, stringLength: -1, slaveIndex: -1, ...modbus },
    knx: {
      dpt: 257,
      groupAddress: 100 + id,
      additionalAddresses: [],
      flags: { u: true, t: true, ri: false, w: true, r: true },
      priority: 3,
      ...knx,
    },
    conversions: { internal: { filters: [], operations: [] }, external: { filters: [], operations: [] } },
    virtual: false,
  };
}

function withSignals(signals: MbsKnxSignal[]): MbsKnxProject {
  return { ...project(), signals };
}

function issuesOf(p: MbsKnxProject) {
  return validateProject(p).map((i) => [i.code, i.ref?.id]);
}

describe("validateProject", () => {
  it("accepts the synthetic fixture (the disabled row does not collide)", () => {
    expect(validateProject(project())).toEqual([]);
  });

  it("needs at least one active signal", () => {
    const p = project();
    expect(codes({ ...p, signals: p.signals.map((s) => ({ ...s, active: false })) })).toEqual(["SIG-NONE-ACTIVE"]);
  });

  it("checks the physical address and the slave number range of the form", () => {
    const p = project();
    expect(codes({ ...p, knx: { ...p.knx, physicalAddress: 0 } })).toEqual(["KNX-PA-FORMAT"]);
    expect(codes({ ...p, mbs: { ...p.mbs, rtu: { ...p.mbs.rtu, slaveNumber: 255 } } })).toEqual([]);
    expect(codes({ ...p, mbs: { ...p.mbs, rtu: { ...p.mbs.rtu, slaveNumber: 256 } } })).toEqual(["MBS-SLAVE-RANGE"]);
  });

  describe("KNX side (ExternalKnx.CheckProjectObjects)", () => {
    it("checks the flags and the group addresses", () => {
      expect(codes(withSignals([signal(0, {}, { flags: { u: false, t: false, ri: false, w: false, r: false } })]))).toEqual([
        "KNX-FLAGS-NONE",
      ]);
      expect(codes(withSignals([signal(0, {}, { groupAddress: 0 })]))).toEqual(["KNX-GA-FORMAT"]);
      expect(codes(withSignals([signal(0, {}, { groupAddress: 40000 })]))).toEqual(["KNX-GA-EXTENDED"]);
    });

    it("also checks the additional addresses, unlike the internal KNX side", () => {
      expect(codes(withSignals([signal(0, {}, { additionalAddresses: [0] })]))).toEqual(["KNX-GA-LISTEN"]);
      expect(codes(withSignals([signal(0, {}, { additionalAddresses: [40000] })]))).toEqual(["KNX-GA-LISTEN"]);
      const p = withSignals([signal(0, {}, { additionalAddresses: [40000] })]);
      expect(codes({ ...p, knx: { ...p.knx, extendedAddresses: true } })).toEqual([]);
    });

    it("ignores disabled signals", () => {
      const off = { ...signal(1, {}, { groupAddress: 0 }), active: false };
      expect(codes(withSignals([signal(0, {}), off]))).toEqual([]);
    });
  });

  describe("Modbus side (InternalMbs.CheckProjectObjects, literal)", () => {
    it("reports a repeated 16-bit address on the other signal", () => {
      expect(issuesOf(withSignals([signal(0, { address: 5 }), signal(1, { address: 5 })]))).toEqual([
        ["MBS-ADDRESS-DUP", 1],
        ["MBS-ADDRESS-DUP", 0],
      ]);
    });

    it("has a 16-bit register skip the 32-bit ones (the 32-bit one still reports it), but not the 64-bit ones", () => {
      expect(codes(withSignals([signal(0, { address: 5 }), signal(1, { address: 5, lenBits: 32 })]))).toEqual([
        "MBS-ADDRESS-DUP",
      ]);
      expect(issuesOf(withSignals([signal(0, { address: 5 }), signal(1, { address: 5, lenBits: 64 })]))).toEqual([
        ["MBS-ADDRESS-DUP", 1],
        ["MBS-ADDRESS-DUP", 0],
      ]);
    });

    it("makes a 16-bit register collide with a BitFields at the same address", () => {
      expect(issuesOf(withSignals([signal(0, { address: 5 }), signal(1, { address: 5, format: 4, bit: 0 })]))).toEqual([
        ["MBS-ADDRESS-DUP", 1],
      ]);
    });

    it("only looks at address and address + 1 for 32/64-bit registers", () => {
      expect(issuesOf(withSignals([signal(0, { address: 5, lenBits: 32 }), signal(1, { address: 6 })]))).toEqual([
        ["MBS-ADDRESS-DUP", 1],
      ]);
      expect(codes(withSignals([signal(0, { address: 5, lenBits: 64 }), signal(1, { address: 7 })]))).toEqual([]);
    });

    it("checks BitFields by address and bit", () => {
      expect(codes(withSignals([signal(0, { address: 5, format: 4, bit: 1 }), signal(1, { address: 5, format: 4, bit: 2 })]))).toEqual(
        [],
      );
      expect(issuesOf(withSignals([signal(0, { address: 5, format: 4, bit: 1 }), signal(1, { address: 5, format: 4, bit: 1 })]))).toEqual([
        ["MBS-BIT-DUP", 1],
        ["MBS-BIT-DUP", 0],
      ]);
    });

    it("checks the format, the address range and the 1-based address 0", () => {
      expect(codes(withSignals([signal(0, { format: -1 })]))).toEqual(["MBS-FORMAT-NONE"]);
      expect(codes(withSignals([signal(0, { address: 20001 })]))).toEqual(["MBS-ADDRESS-RANGE"]);
      const p = withSignals([signal(0, { address: 0 })]);
      expect(codes({ ...p, mbs: { ...p.mbs, registerBase: 1 } })).toEqual(["MBS-ADDRESS-BASE"]);
    });
  });

  it("counts group addresses and associations of the active signals for the licence", () => {
    const many = Array.from({ length: 3001 }, (_, i) => signal(i, { address: i }, { groupAddress: i + 1 }));
    const result = codes(withSignals(many));
    expect(result).toContain("SIG-LIMIT-ACTIVE");
    expect(result).toContain("KNX-LIMIT-GA");
    expect(result).not.toContain("KNX-LIMIT-ASSOC");
  });
});
