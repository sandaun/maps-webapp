import { describe, expect, it } from "vitest";
import { appendChildIndented } from "./append-indented";
import { XmlDocument } from "./document";
import { element } from "./model";

const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

describe("appendChildIndented", () => {
  it("inserts before closing whitespace in MAPS-formatted XML", () => {
    const doc = XmlDocument.parse("<Project>\r\n  <Items>\r\n    <A />\r\n  </Items>\r\n</Project>");
    const parent = doc.find(["Items"]);
    expect(parent).toBeDefined();
    const child = element("B");
    appendChildIndented(parent!, child, 2);

    expect(child.parent).toBe(parent);
    expect(doc.serialize()).toBe(`${DECLARATION}<Project>\r\n  <Items>\r\n    <A />\r\n    <B />\r\n  </Items>\r\n</Project>`);
  });

  it("adds the first child to a self-closing element using MAPS indentation", () => {
    const doc = XmlDocument.parse("<Project>\r\n  <Items />\r\n</Project>");
    const parent = doc.find(["Items"]);
    expect(parent).toBeDefined();
    appendChildIndented(parent!, element("A"), 2);

    expect(doc.serialize()).toBe(`${DECLARATION}<Project>\r\n  <Items>\r\n    <A />\r\n  </Items>\r\n</Project>`);
  });

  it("keeps all siblings when the closing tag has no indentation", () => {
    const doc = XmlDocument.parse("<Project><Items><A /><B /></Items></Project>");
    const parent = doc.find(["Items"]);
    expect(parent).toBeDefined();
    appendChildIndented(parent!, element("C"), 2);

    expect(doc.serialize()).toBe(`${DECLARATION}<Project><Items><A /><B /><C /></Items></Project>`);
    expect(doc.findAll(["Items", "A"])).toHaveLength(1);
    expect(doc.findAll(["Items", "B"])).toHaveLength(1);
    expect(doc.findAll(["Items", "C"])).toHaveLength(1);
  });
});
