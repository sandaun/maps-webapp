import { describe, expect, it } from "vitest";
import { element, text } from "./model";
import { XmlDocument } from "./document";

/**
 * Synthetic .ibmaps-style document exercising the real formatting: BOM,
 * CRLF, 2-space indent, `<tag />` self-closing, ordered attributes, entities.
 * No secrets.
 */
const FIXTURE = [
  "\uFEFF<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
  "<Project Platform=\"2\" CreatedBy=\"IntesisMAPS\" ProjectName=\"demo.ibmaps\">",
  "  <Connection Pwd=\"\" isUSB=\"False\" Port=\"23\" />",
  "  <InternalProtocol ProtocolType=\"KNX\">",
  "    <IndAddress>65535</IndAddress>",
  "    <KNXObject ID=\"0\">",
  "      <Description>Main &amp; backup</Description>",
  "      <Active>True</Active>",
  "      <Flags U=\"True\" T=\"False\" Ri=\"False\" W=\"True\" R=\"False\" />",
  "    </KNXObject>",
  "  </InternalProtocol>",
  "</Project>",
  "",
].join("\r\n");

describe("XmlDocument", () => {
  it("round-trips byte-identical (BOM, CRLF, indent, self-closing, entities)", () => {
    const doc = XmlDocument.parse(FIXTURE);
    expect(doc.serialize()).toBe(FIXTURE);
  });

  it("stays byte-identical after a no-op parse → serialize cycle", () => {
    const doc = XmlDocument.parse(FIXTURE);
    const once = doc.serialize();
    expect(XmlDocument.parse(once).serialize()).toBe(FIXTURE);
  });

  it("reads attributes and text by path", () => {
    const doc = XmlDocument.parse(FIXTURE);
    expect(doc.getAttr(["InternalProtocol"], "ProtocolType")).toBe("KNX");
    expect(doc.getText(["InternalProtocol", "IndAddress"])).toBe("65535");
    expect(
      doc.getAttr(["InternalProtocol", { tag: "KNXObject", attr: "ID", value: "0" }, "Flags"], "Ri"),
    ).toBe("False");
  });

  it("setAttr preserves attribute position for existing attributes", () => {
    const doc = XmlDocument.parse(FIXTURE);
    doc.setAttr(["Connection"], "Port", "24");
    expect(doc.serialize()).toContain('<Connection Pwd="" isUSB="False" Port="24" />');
  });

  it("setAttr appends new attributes at the end", () => {
    const doc = XmlDocument.parse(FIXTURE);
    doc.setAttr(["Connection"], "Device", "eth0");
    expect(doc.serialize()).toContain('<Connection Pwd="" isUSB="False" Port="23" Device="eth0" />');
  });

  it("setText replaces element content and escapes entities", () => {
    const doc = XmlDocument.parse(FIXTURE);
    doc.setText(["InternalProtocol", { tag: "KNXObject", attr: "ID", value: "0" }, "Description"], "A < B & C");
    expect(doc.serialize()).toContain("<Description>A &lt; B &amp; C</Description>");
  });

  it("appendChild + remove restore the document byte-identical", () => {
    const doc = XmlDocument.parse(FIXTURE);
    const before = doc.serialize();
    doc.appendChild(
      ["InternalProtocol"],
      element("KNXObject", [["ID", "1"]], [element("Active", [], [text("True")])]),
    );
    expect(doc.findAll(["InternalProtocol", "KNXObject"])).toHaveLength(2);
    expect(doc.serialize()).toContain('ID="1"');
    expect(doc.remove(["InternalProtocol", { tag: "KNXObject", attr: "ID", value: "1" }])).toBe(true);
    expect(doc.serialize()).toBe(before);
  });

  it("throws on patching a missing path", () => {
    const doc = XmlDocument.parse(FIXTURE);
    expect(() => doc.setAttr(["DoesNotExist"], "X", "1")).toThrow(/No XML element/);
  });
});
