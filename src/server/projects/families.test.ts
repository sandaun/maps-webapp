import { describe, expect, it } from "vitest";
import { getAttr, getText, setAttr, setText, XmlDocument, type XmlElement } from "@/core/project-format";
import { childByTag, decodeElements } from "@/core/xbl";
import { projectFromXml } from "@/gateway-families/knx-mbm";
import { projectFromXml as meProjectFromXml } from "@/gateway-families/me-mbs";
import { SYNTHETIC_ME_MBS_XML } from "@/gateway-families/me-mbs/fixtures/synthetic-project";
import { SYNTHETIC_ME_MBS_EMPTY_XML } from "@/gateway-families/me-mbs/fixtures/synthetic-empty-project";
import { generateMeMbsXbl } from "@/gateway-families/me-mbs/xbl";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { generateKnxMbmXbl } from "@/gateway-families/knx-mbm/xbl";
import { familyById, type ProjectPatch } from "./families";

const knx = familyById("knx-mbm");

/**
 * RTU node 0: devices 0 (fixture), 1, 2. TCP nodes 0 and 1 (ports 1 and 2),
 * one device each. Every signal is described `s<id>` and has address 100+id
 * (fixture signals 0 and 1 keep theirs). 2 → RTU dev 1, 3 → RTU dev 2,
 * 4 → RTU dev 1 (virtual), 5 → TCP 0, 6 → TCP 1, 7 → TCP 0 (virtual).
 */
function topology() {
  const doc = XmlDocument.parse(SYNTHETIC_KNX_MBM_XML);
  const refs: [port: number, deviceIndex: number][] = [[0, 1], [0, 2], [0, 1], [1, 0], [2, 0], [1, 0]];
  knx.applyPatches(doc, [
    { type: "updateMbmConfig", patch: { media: 2 } }, // RTU and TCP, so every node is emitted
    { type: "addDevice", locator: { kind: "rtu", nodeIndex: 0 } },
    { type: "addDevice", locator: { kind: "rtu", nodeIndex: 0 } },
    { type: "addTcpNode" },
    { type: "addTcpNode" },
    { type: "addDevice", locator: { kind: "tcp", nodeIndex: 0 } },
    { type: "addDevice", locator: { kind: "tcp", nodeIndex: 1 } },
    // New devices start disabled, as in MAPS; enable them so their signals are emitted.
    ...([["rtu", 0, 1], ["rtu", 0, 2], ["tcp", 0, 0], ["tcp", 1, 0]] as const).map(
      ([kind, nodeIndex, deviceIndex]): ProjectPatch => ({
        type: "updateDevice",
        locator: { kind, nodeIndex },
        deviceIndex,
        patch: { enabled: true },
      }),
    ),
    ...refs.map((): ProjectPatch => ({ type: "addSignal" })),
    { type: "updateSignal", id: 0, patch: { description: "s0" } },
    { type: "updateSignal", id: 1, patch: { description: "s1" } },
    ...refs.map(([port, deviceIndex], i): ProjectPatch => ({
      type: "updateSignal",
      id: i + 2,
      patch: { description: `s${i + 2}`, modbus: { port, deviceIndex, address: 102 + i, readFunc: 3 } },
    })),
  ]);
  for (const id of [4, 7]) {
    const el = doc.find(["InternalProtocol", { tag: "KNXObject", attr: "ID", value: String(id) }, "Virtual"]);
    setAttr(el!, "Status", "True");
  }
  return doc;
}

const me = familyById("me-mbs");

const childText = (el: XmlElement, tag: string) =>
  getText(el.children.find((c): c is XmlElement => c.kind === "element" && c.tag === tag)!);

/** Numeric XBL value of a decoded item child (big-endian bytes). */
function xblValue(xbl: Uint8Array, item: { tag: number; contentOffset: number; contentLength: number }[], tag: number) {
  const el = item.find((c) => c.tag === tag)!;
  return Array.from(xbl.subarray(el.contentOffset, el.contentOffset + el.contentLength)).reduce(
    (n, byte) => n * 256 + byte,
    0,
  );
}

/** [ID, IdxConfig, IdxExternal] of each side, in document order. */
function idColumns(doc: XmlDocument) {
  return {
    knx: doc
      .findAll(["InternalProtocol", "KNXObject"])
      .map((el) => [getAttr(el, "ID"), childText(el, "IdxConfig"), childText(el, "IdxExternal")].map(Number)),
    mbm: doc
      .findAll(["ExternalProtocol", "Signals", "Signal"])
      .map((el) => [getAttr(el, "ID"), childText(el, "idxConfig"), childText(el, "idxExternal")].map(Number)),
  };
}

const descriptions = (doc: XmlDocument) => projectFromXml(doc).signals.map((s) => s.description);

describe("KNX–MBM batch patches (MAPS ReorderIdxConfigs)", () => {
  it("renumbers both sides after removing a signal from the middle", () => {
    const doc = topology();
    knx.applyPatches(doc, [{ type: "removeSignal", id: 3 }]);
    const expected = [0, 1, 2, 3, 4, 5, 6].map((i) => [i, i, i]);
    expect(idColumns(doc)).toEqual({ knx: expected, mbm: expected });
    expect(descriptions(doc)).toEqual(["s0", "s1", "s2", "s4", "s5", "s6", "s7"]);
    // Both sides stay paired: the KNX description travels with its Modbus endpoint.
    expect(projectFromXml(doc).signals[3].modbus.address).toBe(104);
  });

  it("resolves every ID of a multi-row delete against the document before the batch", () => {
    const doc = topology();
    knx.applyPatches(doc, [
      { type: "removeSignal", id: 2 },
      { type: "removeSignal", id: 5 },
      { type: "removeSignal", id: 7 },
    ]);
    expect(descriptions(doc)).toEqual(["s0", "s1", "s3", "s4", "s6"]);
    expect(projectFromXml(doc).signals.map((s) => s.id)).toEqual([0, 1, 2, 3, 4]);
  });

  it("leaves IDs alone when nothing is deleted", () => {
    const doc = topology();
    const before = doc.serialize();
    knx.applyPatches(doc, [{ type: "removeNode", locator: { kind: "tcp", nodeIndex: 1 } }]);
    // TCP 1 only has an ordinary signal, which is unassigned rather than deleted.
    expect(idColumns(doc)).toEqual(idColumns(XmlDocument.parse(before)));
  });

  it("generates an XBL whose configIds point at the right signals after a device removal", () => {
    const doc = topology();
    knx.applyPatches(doc, [
      { type: "removeDevice", locator: { kind: "rtu", nodeIndex: 0 }, deviceIndex: 1, signals: "delete" },
    ]);
    expect(descriptions(doc)).toEqual(["s0", "s1", "s3", "s5", "s6", "s7"]);
    const expected = [0, 1, 2, 3, 4, 5].map((i) => [i, i, i]);
    expect(idColumns(doc)).toEqual({ knx: expected, mbm: expected });

    const xml = doc.serialize();
    const xbl = generateKnxMbmXbl(xml, { now: new Date(2026, 0, 1) });
    const items = childByTag(childByTag(decodeElements(xbl)[3], 6), 1).items ?? [];
    const signals = projectFromXml(XmlDocument.parse(xml)).signals;
    const decoded = items.map((item) => {
      const value = (tag: number) => {
        const el = item.find((c) => c.tag === tag)!;
        return Array.from(xbl.subarray(el.contentOffset, el.contentOffset + el.contentLength)).reduce(
          (n, byte) => n * 256 + byte,
          0,
        );
      };
      return { configId: value(11), address: value(9) };
    });
    // Every non-virtual signal on an enabled device is emitted exactly once…
    expect(decoded.map((d) => d.configId).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    // …and its configId is the position of the signal it was generated from.
    for (const { configId, address } of decoded) {
      expect(signals[configId].modbus.address).toBe(address);
    }
  });
});

/** [ID, idxConfig, idxExternal] of both ME–MBS sides, in document order. */
describe("KNX–MBM conversion patches (frmSelectConversion)", () => {
  const selection = { internalFilter: null, operations: [0], externalFilter: null, master: "internal" as const };
  const ref = (index: number, inverted = false) => ({ index, inverted });

  it("saves both halves from the KNX flags: signal 1 only reads, signal 0 only writes", () => {
    const doc = XmlDocument.parse(SYNTHETIC_KNX_MBM_XML);
    knx.applyPatches(doc, [
      { type: "updateSignal", id: 0, patch: { conversions: selection } },
      { type: "updateSignal", id: 1, patch: { conversions: selection } },
    ]);
    const [write, read] = projectFromXml(doc).signals;
    expect(write.conversions).toEqual({
      internal: { filters: [], operations: [ref(0)] },
      external: { filters: [], operations: [] },
    });
    expect(read.conversions).toEqual({
      internal: { filters: [], operations: [] },
      external: { filters: [], operations: [ref(0)] },
    });
  });

  it("uses the flags of the same edit and inverts the other flow for read + write signals", () => {
    const doc = XmlDocument.parse(SYNTHETIC_KNX_MBM_XML);
    const flags = { u: true, t: true, ri: false, w: true, r: true };
    knx.applyPatches(doc, [{ type: "updateSignal", id: 1, patch: { knx: { flags }, conversions: selection } }]);
    expect(projectFromXml(doc).signals[1].conversions).toEqual({
      internal: { filters: [], operations: [ref(0)] },
      external: { filters: [], operations: [ref(0, true)] },
    });
  });

  it("rejects conversions that are not in the project and virtual signals", () => {
    const doc = XmlDocument.parse(SYNTHETIC_KNX_MBM_XML);
    const missing: ProjectPatch = { type: "updateSignal", id: 1, patch: { conversions: { ...selection, operations: [1] } } };
    expect(() => knx.applyPatches(doc, [missing])).toThrow(/not in the project/);
    const virtualDoc = XmlDocument.parse(SYNTHETIC_KNX_MBM_XML);
    const knxObject = virtualDoc.find(["InternalProtocol", { tag: "KNXObject", attr: "ID", value: "1" }])!;
    const virtualEl = knxObject.children.find((c): c is XmlElement => c.kind === "element" && c.tag === "Virtual")!;
    setAttr(virtualEl, "Status", "True");
    expect(() =>
      knx.applyPatches(virtualDoc, [{ type: "updateSignal", id: 1, patch: { conversions: selection } }]),
    ).toThrow(/virtual signals cannot have conversions/);
  });
});

describe("KNX–MBM conversion library patches", () => {
  it("adds, edits and removes library entries, answering the MAPS rules with 422", () => {
    const doc = XmlDocument.parse(SYNTHETIC_KNX_MBM_XML);
    knx.applyPatches(doc, [
      { type: "addConversion", conversionType: 0 },
      { type: "updateConversion", list: "filters", index: 0, patch: { param1: 1, param2: 4, param3: -50, param4: 150 } },
    ]);
    expect(projectFromXml(doc).conversions.map((c) => [c.description, ...c.params])).toEqual([
      ["Filter_0", "1", "4", "-50", "150"],
      ["x0.1 to degC", "0", "1000", "0", "100"],
    ]);
    const invalid: ProjectPatch = { type: "updateConversion", list: "filters", index: 0, patch: { param3: 151 } };
    expect(() => knx.applyPatches(doc, [invalid])).toThrow(
      expect.objectContaining({ status: 422, message: "Low must not be greater than High." }),
    );
    knx.applyPatches(doc, [{ type: "removeConversion", list: "operations", index: 0 }]);
    expect(projectFromXml(doc).signals[1].conversions.external.operations).toEqual([]);
  });
});

describe("ME–MBS batch patches", () => {
  it("rejects conversion library edits, which MAPS does not offer for this family", () => {
    for (const patch of [
      { type: "addConversion", conversionType: 0 },
      { type: "updateConversion", list: "operations", index: 0, patch: { description: "x" } },
      { type: "removeConversion", list: "operations", index: 0 },
    ] as ProjectPatch[]) {
      const doc = XmlDocument.parse(SYNTHETIC_ME_MBS_XML);
      expect(familyById("me-mbs").accepts(patch)).toBe(true);
      expect(() => familyById("me-mbs").applyPatches(doc, [patch])).toThrow(
        expect.objectContaining({ status: 409, message: expect.stringMatching(/conversions are fixed/) }),
      );
      expect(doc.serialize()).toBe(SYNTHETIC_ME_MBS_XML);
    }
  });

  it("rejects conversion edits, which MAPS disables for this family", () => {
    const doc = XmlDocument.parse(SYNTHETIC_ME_MBS_XML);
    const patch = {
      type: "updateSignal",
      id: 0,
      patch: { conversions: { internalFilter: null, operations: [0], externalFilter: null, master: "internal" } },
    } as unknown as ProjectPatch;
    expect(() => me.applyPatches(doc, [patch])).toThrow(/conversions are fixed/);
    expect(doc.serialize()).toBe(SYNTHETIC_ME_MBS_XML);
  });

  it("rejects adding or removing signals, which derive from the controllers and groups", () => {
    for (const patch of [{ type: "addSignal" }, { type: "removeSignal", id: 0 }] as ProjectPatch[]) {
      const doc = XmlDocument.parse(SYNTHETIC_ME_MBS_XML);
      expect(() => me.applyPatches(doc, [patch])).toThrow(/cannot be added or removed/);
      expect(doc.serialize()).toBe(SYNTHETIC_ME_MBS_XML);
    }
  });

  it("applies the signal patches before the model patches that regenerate signals", () => {
    const doc = XmlDocument.parse(SYNTHETIC_ME_MBS_XML);
    me.applyPatches(doc, [{ type: "updateGroup", controllerIndex: 0, groupIndex: 1, patch: { enabled: true } }]);
    const target = meProjectFromXml(doc).signals.findIndex((s) => s.me.groupIndex === 1 && s.me.signalSpecIndex === 0);
    // Regenerating G1 shifts G2's signals; the signal ID still refers to the
    // document before the batch, whatever the patch order.
    me.applyPatches(doc, [
      { type: "updateGroup", controllerIndex: 0, groupIndex: 0, patch: { description: "Office (edited)" } },
      { type: "updateSignal", id: target, patch: { active: false } },
    ]);
    const disabled = meProjectFromXml(doc).signals.filter((s) => !s.active);
    expect(disabled.map((s) => [s.me.groupIndex, s.me.signalSpecIndex])).toEqual([[1, 0]]);
  });

  it("generates an XBL whose configIds point at the right signals after disabling a middle group", () => {
    const doc = XmlDocument.parse(SYNTHETIC_ME_MBS_EMPTY_XML);
    me.applyPatches(
      doc,
      [0, 1, 2].map((groupIndex): ProjectPatch => ({
        type: "updateGroup",
        controllerIndex: 0,
        groupIndex,
        patch: { enabled: true },
      })),
    );
    me.applyPatches(doc, [{ type: "updateGroup", controllerIndex: 0, groupIndex: 1, patch: { enabled: false } }]);
    // The synthetic project declares no conversions; they play no part in configIds.
    for (const side of ["InternalProtocol", "ExternalProtocol"]) {
      for (const signal of doc.findAll([side, "Signals", "Signal"])) {
        const refs = signal.children.find((c): c is XmlElement => c.kind === "element" && c.tag === "IdxOperations");
        if (refs) setText(refs, "");
      }
    }
    const xml = doc.serialize();
    const xbl = generateMeMbsXbl(xml, { now: new Date(2026, 0, 1) });
    const items = childByTag(childByTag(decodeElements(xbl)[2], 6), 1).items ?? [];
    const signals = meProjectFromXml(XmlDocument.parse(xml)).signals;
    expect(signals).toHaveLength(98);
    expect(items.map((item) => xblValue(xbl, item, 7)).sort((a, b) => a - b)).toEqual(
      signals.map((_, i) => i),
    );
    // RegisterBase is 0, so the wire address is the XML address.
    for (const item of items) {
      expect(signals[xblValue(xbl, item, 7)].modbus.address).toBe(xblValue(xbl, item, 4));
    }
  });
});
