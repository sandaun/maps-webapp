import { describe, expect, it } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { SYNTHETIC_KNX_MBM_XML } from "./fixtures/synthetic-project";
import { describeProjectFamily, isKnxMbmProject } from "./detect";
import { projectFromXml } from "./from-xml";
import {
  addDevice,
  addSignal,
  removeSignal,
  setGatewayInfo,
  setKnxExtendedAddresses,
  updateDevice,
  updateSignal,
} from "./xml-ops";

function parseFixture() {
  return XmlDocument.parse(SYNTHETIC_KNX_MBM_XML);
}

describe("detect", () => {
  it("recognises the KNX–MBM family", () => {
    expect(isKnxMbmProject(parseFixture())).toBe(true);
  });
  it("rejects other families", () => {
    const doc = parseFixture();
    doc.setAttr([], "InternalProtocol", "BACnet Server");
    expect(isKnxMbmProject(doc)).toBe(false);
    expect(describeProjectFamily(doc)).toBe("BACnet Server ↔ Modbus Master");
  });
});

describe("projectFromXml", () => {
  it("maps the synthetic fixture to the model", () => {
    const project = projectFromXml(parseFixture());
    expect(project.name).toBe("synthetic-knx-mbm.ibmaps");
    expect(project.gateway.name).toBe("SYNTH-KNX-MBM");
    expect(project.gateway.dhcp).toBe(false);
    expect(project.knx.physicalAddress).toBe(65535); // 15.15.255
    expect(project.knx.extendedAddresses).toBe(false);
    expect(project.knx.keys).toEqual(["0001", "0002", "0003"]);

    expect(project.mbm.rtuNodes).toHaveLength(1);
    expect(project.mbm.rtuNodes[0].baudrate).toBe(9600);
    expect(project.mbm.rtuNodes[0].devices[0]).toMatchObject({ name: "Heat pump", slave: 1 });

    expect(project.signals).toHaveLength(2);
    const [onOff, temp] = project.signals;
    expect(onOff.description).toBe("Heat pump on/off");
    expect(onOff.knx.dpt).toBe(257); // 1.001
    expect(onOff.knx.groupAddress).toBe(2051); // 1/0/3
    expect(onOff.knx.additionalAddresses).toEqual([2052]);
    expect(onOff.knx.flags).toMatchObject({ u: true, w: true, r: false });
    expect(onOff.modbus.writeFunc).toBe(6);
    expect(temp.modbus.readFunc).toBe(3);
    expect(temp.modbus.format).toBe(3); // Float
    expect(temp.idxOperations).toBe("0,0;");

    expect(project.conversions).toHaveLength(1);
    expect(project.conversions[0].description).toBe("x0.1 to degC");
  });

  it("does not expose the gateway password in the model", () => {
    expect(JSON.stringify(projectFromXml(parseFixture()))).not.toContain("Pwd");
  });

  it("no-change round-trip stays byte-identical", () => {
    const doc = parseFixture();
    projectFromXml(doc); // parse only
    expect(doc.serialize()).toBe(SYNTHETIC_KNX_MBM_XML);
  });
});

describe("xml-ops", () => {
  it("updateSignal patches both protocol sides", () => {
    const doc = parseFixture();
    updateSignal(doc, 0, {
      description: "Renamed",
      knx: { groupAddress: 2307, flags: { u: true, t: false, ri: false, w: true, r: false } },
      modbus: { writeFunc: 16, address: 12 },
    });
    const xml = doc.serialize();
    expect(xml).toContain("<Description>Renamed</Description>");
    expect(xml).toContain('Value="2307" String="1/1/3"');
    expect(xml).toContain("<WriteFunc>16</WriteFunc>");
    // the other signal is untouched
    expect(xml).toContain("<Description>Room temperature</Description>");
  });

  it("addSignal appends aligned nodes with defaults and removeSignal restores", () => {
    const doc = parseFixture();
    const before = doc.serialize();
    const id = addSignal(doc);
    expect(id).toBe(2);
    const project = projectFromXml(doc);
    expect(project.signals).toHaveLength(3);
    const added = project.signals[2];
    expect(added.knx.dpt).toBe(257); // 1.001 default
    expect(added.modbus.port).toBe(-1); // 255 → unset
    expect(added.modbus.readFunc).toBe(-1);
    expect(removeSignal(doc, id)).toBe(true);
    expect(doc.serialize()).toBe(before);
  });

  it("setGatewayInfo never touches Pwd", () => {
    const doc = parseFixture();
    setGatewayInfo(doc, { name: "NEW-NAME", ip: "10.0.0.5" });
    const xml = doc.serialize();
    expect(xml).toContain('Name="NEW-NAME"');
    expect(xml).toContain('Pwd=""');
  });

  it("device CRUD on RTU node", () => {
    const doc = parseFixture();
    const idx = addDevice(doc, { kind: "rtu", nodeIndex: 0 });
    expect(idx).toBe(1);
    updateDevice(doc, { kind: "rtu", nodeIndex: 0, deviceIndex: 1 }, { name: "Meter", slave: 22 });
    const project = projectFromXml(doc);
    expect(project.mbm.rtuNodes[0].devices[1]).toMatchObject({ name: "Meter", slave: 22 });
  });

  it("setKnxExtendedAddresses toggles the flag", () => {
    const doc = parseFixture();
    setKnxExtendedAddresses(doc, true);
    expect(doc.serialize()).toContain("<UseExtendedAddresses>True</UseExtendedAddresses>");
  });
});
