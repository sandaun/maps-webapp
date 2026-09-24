import { describe, expect, it } from "vitest";
import { getAttr, getText, setAttr, XmlDocument, type XmlElement } from "@/core/project-format";
import { childByTag, decodeElements } from "@/core/xbl";
import { projectFromXml } from "@/gateway-families/knx-mbm";
import { projectFromXml as meProjectFromXml } from "@/gateway-families/me-mbs";
import { SYNTHETIC_ME_MBS_XML } from "@/gateway-families/me-mbs/fixtures/synthetic-project";
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
function meIdColumns(doc: XmlDocument) {
  const columns = (side: "InternalProtocol" | "ExternalProtocol") =>
    doc
      .findAll([side, "Signals", "Signal"])
      .map((el) => [getAttr(el, "ID"), childText(el, "idxConfig"), childText(el, "idxExternal")].map(Number));
  return { mbs: columns("InternalProtocol"), me: columns("ExternalProtocol") };
}

const meAddresses = (doc: XmlDocument) => meProjectFromXml(doc).signals.map((s) => s.modbus.address);

describe("ME–MBS batch patches (MAPS DeleteObject + ReorderIdxConfigs)", () => {
  it("renumbers both sides once after a multi-row delete, resolving the original IDs", () => {
    const doc = XmlDocument.parse(SYNTHETIC_ME_MBS_XML);
    const addresses = meAddresses(doc);
    me.applyPatches(doc, [
      { type: "removeSignal", id: 1 },
      { type: "removeSignal", id: 5 },
    ]);
    expect(meAddresses(doc)).toEqual(addresses.filter((_, id) => id !== 1 && id !== 5));
    const expected = addresses.slice(2).map((_, i) => [i, i, i]);
    expect(meIdColumns(doc)).toEqual({ mbs: expected, me: expected });
  });

  it("gives a later added signal the next contiguous ID on both sides", () => {
    const doc = XmlDocument.parse(SYNTHETIC_ME_MBS_XML);
    const count = meProjectFromXml(doc).signals.length;
    me.applyPatches(doc, [{ type: "removeSignal", id: 0 }]);
    me.applyPatches(doc, [{ type: "addSignal" }]);
    const expected = Array.from({ length: count }, (_, i) => [i, i, i]);
    expect(meIdColumns(doc)).toEqual({ mbs: expected, me: expected });
  });

  it("generates an XBL whose configIds point at the right signals after deleting from the middle", () => {
    const doc = XmlDocument.parse(SYNTHETIC_ME_MBS_XML);
    // The synthetic fixture references conversions its IBOX does not declare
    // (see me-mbs/xbl/generate.test.ts); they play no part in configIds.
    me.applyPatches(
      doc,
      meProjectFromXml(doc).signals.map((signal): ProjectPatch => ({
        type: "updateSignal",
        id: signal.id,
        patch: { idxOperations: "" },
      })),
    );
    me.applyPatches(doc, [
      { type: "removeSignal", id: 2 },
      { type: "removeSignal", id: 6 },
    ]);
    const xml = doc.serialize();
    const xbl = generateMeMbsXbl(xml, { now: new Date(2026, 0, 1) });
    const items = childByTag(childByTag(decodeElements(xbl)[2], 6), 1).items ?? [];
    const signals = meProjectFromXml(XmlDocument.parse(xml)).signals;
    expect(items.map((item) => xblValue(xbl, item, 7)).sort((a, b) => a - b)).toEqual(
      signals.map((_, i) => i),
    );
    // RegisterBase is 0 in the fixture, so the wire address is the XML address.
    for (const item of items) {
      expect(signals[xblValue(xbl, item, 7)].modbus.address).toBe(xblValue(xbl, item, 4));
    }
  });
});
