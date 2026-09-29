import { describe, expect, it } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { SYNTHETIC_KNX_MBM_XML } from "./knx-mbm/fixtures/synthetic-project";
import { addDevice, addRtuNode, addSignal as addKnxSignal, addTcpNode } from "./knx-mbm/xml-ops";
import { SYNTHETIC_ME_MBS_XML } from "./me-mbs/fixtures/synthetic-project";
import { addSignal as addMeSignal } from "./me-mbs/xml-ops";
import { SYNTHETIC_MBS_KNX_XML } from "./mbs-knx/fixtures/synthetic-project";
import { addSignal as addMbsKnxSignal } from "./mbs-knx/xml-ops";

function compact(xml: string): string {
  return xml.replace(/>\s+</g, "><");
}

describe("append operations on reformatted .ibmaps", () => {
  it("keeps every KNX–MBM sibling and both sides of the signal table", () => {
    const source = compact(SYNTHETIC_KNX_MBM_XML);
    const doc = XmlDocument.parse(source);
    expect(doc.serialize()).toBe(source);

    expect(addKnxSignal(doc)).toBe(2);
    expect(doc.findAll(["InternalProtocol", "KNXObject"])).toHaveLength(3);
    expect(doc.findAll(["ExternalProtocol", "Signals", "Signal"])).toHaveLength(3);
    expect(doc.getText(["InternalProtocol", "IndAddress"])).toBe("65535");
    expect(doc.getText(["InternalProtocol", { tag: "KNXObject", attr: "ID", value: "1" }, "Description"]))
      .toBe("Room temperature");
    expect(doc.serialize()).toContain("<KNXObject ID=\"0\">");
    expect(doc.serialize()).toContain("<KNXObject ID=\"1\">");
    expect(XmlDocument.parse(doc.serialize()).findAll(["InternalProtocol", "KNXObject"])).toHaveLength(3);
  });

  it("keeps KNX–MBM RTU nodes, TCP nodes and devices when appending", () => {
    const source = compact(SYNTHETIC_KNX_MBM_XML);
    const devices = XmlDocument.parse(source);
    expect(addDevice(devices, { kind: "rtu", nodeIndex: 0 })).toBe(1);
    expect(devices.findAll(["ExternalProtocol", "RtuNodes", "RtuNode", "Device"])).toHaveLength(2);
    expect(devices.getAttr(["ExternalProtocol", "RtuNodes", "RtuNode", { tag: "Device", attr: "Index", value: "0" }], "Name"))
      .toBe("Heat pump");
    expect(devices.serialize()).toContain("<Signals><Signal ID=\"0\">");

    const rtu = XmlDocument.parse(source);
    expect(addRtuNode(rtu)).toBe(1);
    expect(rtu.findAll(["ExternalProtocol", "RtuNodes", "RtuNode"])).toHaveLength(2);
    expect(rtu.findAll(["ExternalProtocol", "RtuNodes", "RtuNode", "Device"])).toHaveLength(1);

    const tcp = XmlDocument.parse(source);
    addTcpNode(tcp);
    const firstTcp = compact(tcp.serialize());
    const compactTcp = XmlDocument.parse(firstTcp);
    expect(addTcpNode(compactTcp)).toBe(1);
    expect(compactTcp.findAll(["ExternalProtocol", "TCPNodes", "TCPNode"])).toHaveLength(2);
    expect(XmlDocument.parse(compactTcp.serialize()).findAll(["ExternalProtocol", "TCPNodes", "TCPNode"])).toHaveLength(2);
  });

  it("keeps every ME–MBS signal, controller and Modbus setting", () => {
    const source = compact(SYNTHETIC_ME_MBS_XML);
    const doc = XmlDocument.parse(source);
    expect(doc.serialize()).toBe(source);

    expect(addMeSignal(doc)).toBe(9);
    expect(doc.findAll(["InternalProtocol", "Signals", "Signal"])).toHaveLength(10);
    expect(doc.findAll(["ExternalProtocol", "Signals", "Signal"])).toHaveLength(10);
    expect(doc.getText(["InternalProtocol", "Media"])).toBe("2");
    expect(doc.findAll(["ExternalProtocol", "G50List", "G50Controller"])).toHaveLength(1);
    expect(doc.findAll(["ExternalProtocol", "G50List", "G50Controller", "GroupList", "Group"])).toHaveLength(2);
    expect(doc.serialize()).toContain("<Signal ID=\"0\">");
    expect(doc.serialize()).toContain("<Signal ID=\"8\">");
    expect(XmlDocument.parse(doc.serialize()).findAll(["InternalProtocol", "Signals", "Signal"])).toHaveLength(10);
  });

  it("preserves the existing MBS–KNX compact behavior through the shared helper", () => {
    const source = compact(SYNTHETIC_MBS_KNX_XML);
    const doc = XmlDocument.parse(source);
    const internalBefore = doc.findAll(["InternalProtocol", "Signals", "Signal"]).length;
    const externalBefore = doc.findAll(["ExternalProtocol", "KNXObject"]).length;
    addMbsKnxSignal(doc);
    expect(doc.findAll(["InternalProtocol", "Signals", "Signal"])).toHaveLength(internalBefore + 1);
    expect(doc.findAll(["ExternalProtocol", "KNXObject"])).toHaveLength(externalBefore + 1);
  });
});
