import { describe, expect, it } from "vitest";
import { getAttr, getText, setAttr, XmlDocument } from "@/core/project-format";
import { SYNTHETIC_KNX_MBM_XML } from "./knx-mbm/fixtures/synthetic-project";
import { SYNTHETIC_MBS_KNX_XML } from "./mbs-knx/fixtures/synthetic-project";
import * as knx from "./knx-mbm/xml-ops";
import * as mbs from "./mbs-knx/xml-ops";

describe.each([
  { family: "knx-mbm", xml: SYNTHETIC_KNX_MBM_XML, ops: knx, paths: [["InternalProtocol", "KNXObject"], ["ExternalProtocol", "Signals", "Signal"]] },
  { family: "mbs-knx", xml: SYNTHETIC_MBS_KNX_XML, ops: mbs, paths: [["InternalProtocol", "Signals", "Signal"], ["ExternalProtocol", "KNXObject"]] },
])("$family moveSignal", ({ xml, ops, paths }) => {
  it.each([false, true])("moves both complete nodes and restores their order (compact: %s)", (compact) => {
    const doc = XmlDocument.parse(compact ? xml.replace(/>\s+</g, "><") : xml);
    ops.addSignal(doc);
    const before = doc.serialize();
    const originals = paths.map((path) => doc.findAll(path));
    const last = originals[0].length - 1;
    ops.moveSignal(doc, 0, last);
    paths.forEach((path, side) => {
      const nodes = doc.findAll(path);
      expect(nodes).toEqual([...originals[side].slice(1), originals[side][0]]);
      nodes.forEach((node, index) => {
        expect(getAttr(node, "ID")).toBe(String(index));
        for (const child of node.children) {
          if (child.kind === "element" && /^(idxconfig|idxexternal)$/i.test(child.tag)) {
            expect(getText(child)).toBe(String(index));
          }
        }
      });
    });
    ops.moveSignal(doc, last, 0);
    expect(doc.serialize()).toBe(before);
  });

  it("rejects invalid moves without changing the XML", () => {
    const doc = XmlDocument.parse(xml);
    for (const [id, target] of [[999, 0], [0, -1], [0, 999], [0, 0.5]]) {
      expect(() => ops.moveSignal(doc, id, target)).toThrow();
      expect(doc.serialize()).toBe(xml);
    }
    ops.moveSignal(doc, 0, 0);
    expect(doc.serialize()).toBe(xml);
  });

  it("rejects unpaired protocol rows without moving either side", () => {
    const doc = XmlDocument.parse(xml);
    setAttr(doc.findAll(paths[1])[1], "ID", "999");
    const before = doc.serialize();
    expect(() => ops.moveSignal(doc, 0, 1)).toThrow("not aligned");
    expect(doc.serialize()).toBe(before);
  });

  it("moves fixed virtual rows without losing their metadata", () => {
    const doc = XmlDocument.parse(xml);
    const first = doc.findAll(paths[0])[0];
    const virtual = first.children.find((child) => child.kind === "element" && child.tag === "Virtual");
    expect(virtual).toBeDefined();
    if (!virtual || virtual.kind !== "element") throw new Error("Missing Virtual on signal 0");
    setAttr(virtual!, "Fixed", "True");
    setAttr(virtual!, "Status", "True");
    const before = doc.serialize();
    ops.moveSignal(doc, 0, 1);
    expect(doc.findAll(paths[0])[1]).toBe(first);
    expect(getAttr(first, "ID")).toBe("1");
    expect(first.children).toContain(virtual);
    expect(getAttr(virtual, "Fixed")).toBe("True");
    expect(getAttr(virtual, "Status")).toBe("True");
    ops.moveSignal(doc, 1, 0);
    expect(doc.serialize()).toBe(before);
  });

  it.each([false, true])("moves a contiguous block and undoes it (compact: %s)", (compact) => {
    const doc = XmlDocument.parse(compact ? xml.replace(/>\s+</g, "><") : xml);
    ops.addSignal(doc);
    ops.addSignal(doc);
    const before = doc.serialize();
    const originals = paths.map((path) => doc.findAll(path));
    ops.moveSignal(doc, 0, 1, 2);
    paths.forEach((path, side) => {
      const nodes = doc.findAll(path);
      expect(nodes).toEqual([originals[side][2], ...originals[side].slice(0, 2), ...originals[side].slice(3)]);
      nodes.forEach((node, index) => {
        expect(getAttr(node, "ID")).toBe(String(index));
        for (const child of node.children) {
          if (child.kind === "element" && /^(idxconfig|idxexternal)$/i.test(child.tag)) expect(getText(child)).toBe(String(index));
        }
      });
    });
    ops.moveSignal(doc, 1, 0, 2);
    expect(doc.serialize()).toBe(before);
    const total = originals[0].length;
    for (const [id, target, count] of [[0, 1, 0], [0, 1, 1.5], [total - 1, 0, 2], [0, total - 1, 2], [0, -1, 2]]) {
      expect(() => ops.moveSignal(doc, id, target, count)).toThrow();
      expect(doc.serialize()).toBe(before);
    }
    ops.moveSignal(doc, 0, 0, total);
    expect(doc.serialize()).toBe(before);
  });
});