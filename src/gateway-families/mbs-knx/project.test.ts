import { describe, expect, it } from "vitest";
import { setAttr, XmlDocument } from "@/core/project-format";
import { SYNTHETIC_EMPTY_MBS_KNX_XML, SYNTHETIC_MBS_KNX_XML } from "./fixtures/synthetic-project";
import { describeProjectFamily, isMbsKnxProject } from "./detect";
import { projectFromXml } from "./from-xml";
import {
  addSignal,
  removeSignal,
  reorderSignalIds,
  setKnxExtendedAddresses,
  setKnxPhysicalAddress,
  SignalEditError,
  updateMbsConfig,
  updateRtuConfig,
  updateSignal,
} from "./xml-ops";

function parseFixture(xml = SYNTHETIC_MBS_KNX_XML) {
  return XmlDocument.parse(xml);
}

describe("detect", () => {
  it("recognises the MBS–KNX family on the RT platform", () => {
    expect(isMbsKnxProject(parseFixture())).toBe(true);
  });
  it("rejects other families and the plain (KTS) variant", () => {
    const other = parseFixture();
    other.setAttr([], "ExternalProtocol", "Mitsubishi Electric");
    expect(isMbsKnxProject(other)).toBe(false);
    expect(describeProjectFamily(other)).toBe("Modbus Slave ↔ Mitsubishi Electric");
    const kts = parseFixture();
    kts.setAttr([], "Platform", "1");
    expect(isMbsKnxProject(kts)).toBe(false);
  });
});

describe("projectFromXml", () => {
  it("reads the KNX virtual flag separately for auto-numbering", () => {
    const doc = parseFixture();
    const external = doc.find(["ExternalProtocol", { tag: "KNXObject", attr: "ID", value: "0" }, "Virtual"]);
    setAttr(external!, "Status", "True");
    const signal = projectFromXml(doc).signals[0];
    expect(signal.virtual).toBe(false);
    expect(signal.knxVirtual).toBe(true);
  });
  it("maps both sides row by row, the state and description from the Modbus side", () => {
    const project = projectFromXml(parseFixture());
    expect(project.signals).toHaveLength(5);
    const [setpoint, room, alarm, reset, spare] = project.signals;
    expect(setpoint).toMatchObject({
      id: 0,
      active: true,
      description: "Setpoint",
      modbus: { lenBits: 16, format: 0, address: 0, readWrite: 2 },
      knx: { dpt: 2305, groupAddress: 2049, flags: { u: true, t: true, ri: false, w: true, r: true } },
    });
    expect(setpoint.conversions.internal.operations).toEqual([{ index: 0, inverted: false }]);
    expect(room.modbus).toMatchObject({ lenBits: 32, format: 3 });
    expect(alarm.modbus).toMatchObject({ format: 4, bit: 3 });
    expect(alarm.knx.additionalAddresses).toEqual([2052]);
    expect(reset.modbus.readWrite).toBe(1);
    expect(spare.active).toBe(false);
    expect(project.knx).toEqual({ physicalAddress: 65535, extendedAddresses: false, keys: ["0001", "0002", "0003"] });
    expect(project.mbs).toMatchObject({ media: 2, byteOrder: 0, updateCOV: true, registerBase: 0 });
    expect(project.mbs.rtu.slaveNumber).toBe(1);
  });

  it("keeps the level of listening addresses on the external KNX side", () => {
    const doc = parseFixture();
    updateSignal(doc, 2, { knx: {
      additionalAddresses: [2563, 4361],
      additionalAddressLevels: [2, 1],
    } });
    expect(doc.serialize()).toContain('<Address Value="2563" String="1/515" />');
    expect(doc.serialize()).toContain('<Address Value="4361" String="4361" />');
    expect(projectFromXml(doc).signals[2].knx.additionalAddressLevels).toEqual([2, 1]);
  });

  it("reads the Modbus side as MAPS loads it (LenBits 1 → 16 unsigned, -1 → 16, Format 255 → none)", () => {
    const doc = parseFixture();
    const signals = doc.findAll(["InternalProtocol", "Signals", "Signal"]);
    const set = (el: (typeof signals)[number], tag: string, value: string) => {
      const child = el.children.find((c) => c.kind === "element" && c.tag === tag);
      if (child && child.kind === "element") child.children = [{ kind: "text", text: value }];
    };
    set(signals[0], "LenBits", "1");
    set(signals[0], "Format", "255");
    set(signals[1], "LenBits", "-1");
    set(signals[2], "Format", "255");
    const [a, b, c] = projectFromXml(doc).signals;
    expect(a.modbus).toMatchObject({ lenBits: 16, format: 0 });
    expect(b.modbus.lenBits).toBe(16);
    expect(c.modbus.format).toBe(-1);
  });

  it("never reads the gateway password", () => {
    const doc = parseFixture();
    setAttr(doc.find(["IBOX"])!, "Pwd", "secret");
    expect(JSON.stringify(projectFromXml(doc))).not.toContain("secret");
  });

  it("round-trips the XML byte for byte", () => {
    expect(parseFixture().serialize()).toBe(SYNTHETIC_MBS_KNX_XML);
  });
});

describe("addSignal", () => {
  it("appends a row with the MAPS defaults of CreateNewRow", () => {
    const doc = parseFixture();
    const id = addSignal(doc);
    expect(id).toBe(5);
    const signal = projectFromXml(parseFixture(doc.serialize())).signals[5];
    expect(signal).toMatchObject({
      id: 5,
      active: false,
      description: "",
      modbus: { lenBits: 16, format: 0, bit: 255, address: 0, readWrite: 2 },
      knx: {
        dpt: 7 * 256 + 255,
        // GetNextGA: one past the highest sending address (1/0/6).
        groupAddress: 2055,
        additionalAddresses: [],
        flags: { u: true, t: true, ri: false, w: true, r: true },
        priority: 3,
      },
    });
    const knx = doc.find(["ExternalProtocol", { tag: "KNXObject", attr: "ID", value: "5" }])!;
    const sending = knx.children.find((c) => c.kind === "element" && c.tag === "SendingAddress");
    expect(sending && sending.kind === "element" ? sending.attrs : []).toContainEqual(["String", "1/0/7"]);
  });

  it("starts at group address 1 in an empty project", () => {
    const doc = parseFixture(SYNTHETIC_EMPTY_MBS_KNX_XML);
    addSignal(doc);
    const [signal] = projectFromXml(parseFixture(doc.serialize())).signals;
    expect(signal.id).toBe(0);
    expect(signal.knx.groupAddress).toBe(1);
  });
});

describe("addSignal on compact XML", () => {
  it("keeps every existing child when the document has no indentation", () => {
    const compact = SYNTHETIC_MBS_KNX_XML.replace(/>\s+</g, "><");
    const doc = parseFixture(compact);
    addSignal(doc);
    const project = projectFromXml(parseFixture(doc.serialize()));
    expect(project.signals.map((s) => s.description)).toEqual(["Setpoint", "Room temperature", "Alarm", "Reset", "Spare", ""]);
    expect(project.knx.keys).toEqual(["0001", "0002", "0003"]);
    expect(doc.findAll(["ExternalProtocol", "KNXObject"])).toHaveLength(6);
  });
});

describe("removeSignal", () => {
  it("removes both sides and renumbers once per batch", () => {
    const doc = parseFixture();
    expect(removeSignal(doc, 1)).toBe(true);
    expect(removeSignal(doc, 3)).toBe(true);
    reorderSignalIds(doc);
    const project = projectFromXml(parseFixture(doc.serialize()));
    expect(project.signals.map((s) => [s.id, s.description])).toEqual([
      [0, "Setpoint"],
      [1, "Alarm"],
      [2, "Spare"],
    ]);
    expect(project.signals[1].knx.groupAddress).toBe(2051);
  });

  it("refuses to remove a fixed row", () => {
    const doc = parseFixture();
    const virt = doc.findAll(["InternalProtocol", "Signals", "Signal"])[0].children.find(
      (c) => c.kind === "element" && c.tag === "Virtual",
    );
    if (virt && virt.kind === "element") setAttr(virt, "Fixed", "True");
    expect(() => removeSignal(doc, 0)).toThrow(SignalEditError);
  });
});

describe("updateSignal", () => {
  it("edits both sides", () => {
    const doc = parseFixture();
    updateSignal(doc, 0, {
      active: false,
      description: "Mode",
      modbus: { address: 20, lenBits: 32 },
      knx: { groupAddress: 2100, additionalAddresses: [2101], priority: 1 },
    });
    const [signal] = projectFromXml(doc).signals;
    expect(signal).toMatchObject({
      active: false,
      description: "Mode",
      modbus: { address: 20, lenBits: 32 },
      knx: { groupAddress: 2100, additionalAddresses: [2101], priority: 1 },
    });
  });

  it("fits the KNX flags to the Modbus read/write mode on every edit", () => {
    const doc = parseFixture();
    // Signal 1 is Read (mode "write"): R and T cannot stay on.
    updateSignal(doc, 1, { knx: { flags: { u: true, t: true, ri: false, w: true, r: true } } });
    expect(projectFromXml(doc).signals[1].knx.flags).toEqual({ u: true, t: false, ri: false, w: true, r: false });
    // Signal 3 is Trigger (mode "read"): W, U and Ri cannot stay on.
    updateSignal(doc, 3, { knx: { flags: { u: true, t: true, ri: true, w: true, r: false } } });
    expect(projectFromXml(doc).signals[3].knx.flags).toEqual({ u: false, t: true, ri: false, w: false, r: false });
  });

  it("turns the mode's flags on when the read/write mode changes", () => {
    const doc = parseFixture();
    updateSignal(doc, 1, { modbus: { readWrite: 2 } });
    expect(projectFromXml(doc).signals[1].knx.flags).toEqual({ u: true, t: true, ri: false, w: true, r: true });
    updateSignal(doc, 1, { modbus: { readWrite: 1 } });
    expect(projectFromXml(doc).signals[1].knx.flags).toEqual({ u: false, t: true, ri: false, w: false, r: true });
    updateSignal(doc, 1, { modbus: { readWrite: 0 } });
    expect(projectFromXml(doc).signals[1].knx.flags).toEqual({ u: true, t: false, ri: false, w: true, r: false });
  });

  it("keeps the flags sent with a read/write change (undo of that change)", () => {
    const doc = parseFixture();
    // Signal 0 is Read/Write with U T W R; its user flags are only U and W.
    updateSignal(doc, 0, { knx: { flags: { u: true, t: false, ri: false, w: true, r: false } } });
    const before = projectFromXml(doc).signals[0];
    updateSignal(doc, 0, { modbus: { readWrite: 1 } });
    expect(projectFromXml(doc).signals[0].knx.flags).toEqual({ u: false, t: true, ri: false, w: false, r: true });
    updateSignal(doc, 0, { modbus: { readWrite: before.modbus.readWrite }, knx: { flags: before.knx.flags } });
    expect(projectFromXml(doc).signals[0].knx.flags).toEqual(before.knx.flags);
  });

  it("saves the row back as MAPS does: only the bit of a non-BitFields row changes (255 → -1)", () => {
    const doc = parseFixture();
    const before = doc.serialize();
    updateSignal(doc, 0, { description: "Setpoint" });
    const after = doc.serialize();
    expect(after).not.toBe(before);
    expect(after.replace("<Bit>-1</Bit>", "<Bit>255</Bit>")).toBe(before);
  });

  it("fits a row that becomes BitFields: 16 bits and bit 0 when it had none", () => {
    const doc = parseFixture();
    // Signal 1: 32-bit Float, no bit.
    updateSignal(doc, 1, { modbus: { format: 4 } });
    expect(projectFromXml(doc).signals[1].modbus).toMatchObject({ format: 4, lenBits: 16, bit: 0 });
    // A BitFields row keeps its bit and cannot go back to 32 bits.
    updateSignal(doc, 2, { modbus: { lenBits: 32 } });
    expect(projectFromXml(doc).signals[2].modbus).toMatchObject({ format: 4, lenBits: 16, bit: 3 });
    // The bit chosen in the same edit wins.
    updateSignal(doc, 0, { modbus: { format: 4, bit: 7 } });
    expect(projectFromXml(doc).signals[0].modbus).toMatchObject({ format: 4, lenBits: 16, bit: 7 });
    // Leaving BitFields drops the bit.
    updateSignal(doc, 2, { modbus: { format: 0 } });
    expect(projectFromXml(doc).signals[2].modbus).toMatchObject({ format: 0, bit: -1 });
  });

  it("applies the KNX flag interlocks of UpdateFlagsValue, one flag cell at a time", () => {
    const doc = parseFixture();
    const flags = () => projectFromXml(doc).signals[0].knx.flags;
    const click = (flag: "u" | "t" | "ri" | "w" | "r") => {
      const current = flags();
      updateSignal(doc, 0, { knx: { flags: { ...current, [flag]: !current[flag] } } });
    };
    // Signal 0 is read/write (U T W R).
    click("ri"); // Ri on: R off, U on.
    expect(flags()).toEqual({ u: true, t: true, ri: true, w: true, r: false });
    click("u"); // U off: Ri off.
    expect(flags()).toEqual({ u: false, t: true, ri: false, w: true, r: false });
    click("ri"); // Ri on with U off: U back on.
    expect(flags()).toEqual({ u: true, t: true, ri: true, w: true, r: false });
    click("r"); // R on: Ri off.
    expect(flags()).toEqual({ u: true, t: true, ri: false, w: true, r: true });
  });

  it("applies several flag changes of one patch as cell edits in the order U, Ri, R", () => {
    const doc = parseFixture();
    const flags = () => projectFromXml(doc).signals[0].knx.flags;
    updateSignal(doc, 0, { knx: { flags: { u: true, t: true, ri: false, w: true, r: false } } });
    expect(flags()).toEqual({ u: true, t: true, ri: false, w: true, r: false });
    // Ri and R both on: Ri first (clears R), then R (clears Ri), so R wins.
    updateSignal(doc, 0, { knx: { flags: { u: true, t: true, ri: true, w: true, r: true } } });
    expect(flags()).toEqual({ u: true, t: true, ri: false, w: true, r: true });
    // U off and Ri on: U first (Ri stays off), then Ri (turns U back on).
    updateSignal(doc, 0, { knx: { flags: { u: false, t: true, ri: true, w: true, r: false } } });
    expect(flags()).toEqual({ u: true, t: true, ri: true, w: true, r: false });
  });

  it("restores the previous flags when they are sent back (undo)", () => {
    const doc = parseFixture();
    const flags = () => projectFromXml(doc).signals[0].knx.flags;
    updateSignal(doc, 0, { knx: { flags: { u: false, t: true, ri: false, w: true, r: false } } });
    const before = flags();
    // Ri on with U off: U comes back on.
    updateSignal(doc, 0, { knx: { flags: { ...before, ri: true } } });
    expect(flags()).toEqual({ u: true, t: true, ri: true, w: true, r: false });
    updateSignal(doc, 0, { knx: { flags: before } });
    expect(flags()).toEqual(before);
  });

  it("does not force U on for Ri when the Modbus side is a trigger", () => {
    const doc = parseFixture();
    // Signal 3 is a trigger (mode "read"): U, W and Ri never stay on.
    updateSignal(doc, 3, { knx: { flags: { u: false, t: true, ri: true, w: false, r: true } } });
    expect(projectFromXml(doc).signals[3].knx.flags).toEqual({ u: false, t: true, ri: false, w: false, r: true });
  });

  it("only lets a fixed row change what MAPS leaves editable", () => {
    const doc = parseFixture();
    for (const side of [
      doc.findAll(["InternalProtocol", "Signals", "Signal"])[0],
      doc.findAll(["ExternalProtocol", "KNXObject"])[0],
    ]) {
      const virt = side.children.find((c) => c.kind === "element" && c.tag === "Virtual");
      if (virt && virt.kind === "element") setAttr(virt, "Fixed", "True");
    }
    expect(() => updateSignal(doc, 0, { description: "x" })).toThrow(SignalEditError);
    expect(() => updateSignal(doc, 0, { modbus: { readWrite: 0 } })).toThrow(SignalEditError);
    expect(() => updateSignal(doc, 0, { knx: { dpt: 257 } })).toThrow(SignalEditError);
    updateSignal(doc, 0, { active: false, modbus: { address: 7 }, knx: { groupAddress: 2200, priority: 2 } });
    expect(projectFromXml(doc).signals[0]).toMatchObject({
      active: false,
      modbus: { address: 7 },
      knx: { groupAddress: 2200, priority: 2 },
    });
  });
});

describe("configuration", () => {
  it("edits the Modbus Slave and KNX settings on their sides", () => {
    const doc = parseFixture();
    updateMbsConfig(doc, { media: 1, byteOrder: 2, updateCOV: false, registerBase: 1 });
    updateRtuConfig(doc, { baudrate: 19200, slaveNumber: 7 });
    setKnxPhysicalAddress(doc, 4353);
    setKnxExtendedAddresses(doc, true);
    const project = projectFromXml(doc);
    expect(project.mbs).toMatchObject({ media: 1, byteOrder: 2, updateCOV: false, registerBase: 1 });
    expect(project.mbs.rtu).toMatchObject({ baudrate: 19200, slaveNumber: 7 });
    expect(project.knx).toMatchObject({ physicalAddress: 4353, extendedAddresses: true });
  });
});
