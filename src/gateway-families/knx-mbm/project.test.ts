import { describe, expect, it } from "vitest";
import { setAttr, XmlDocument } from "@/core/project-format";
import { SYNTHETIC_KNX_MBM_XML } from "./fixtures/synthetic-project";
import { describeProjectFamily, isKnxMbmProject } from "./detect";
import { projectFromXml } from "./from-xml";
import {
  addConversion,
  addDevice,
  addSignal,
  addTcpNode,
  removeDevice,
  removeConversion,
  removeNode,
  removeSignal,
  setGatewayInfo,
  setConversions,
  setKnxExtendedAddresses,
  updateConversion,
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
    expect(temp.conversions).toEqual({
      internal: { filters: [], operations: [{ index: 0, inverted: false }] },
      external: { filters: [], operations: [{ index: 0, inverted: false }] },
    });

    expect(project.conversions).toHaveLength(1);
    expect(project.conversions[0].description).toBe("x0.1 to degC");
  });

  it("reads the conversion refs of each half, even when the KNX half is empty", () => {
    const knxLine = "\r\n      <IdxOperations>0,0;</IdxOperations>";
    expect(SYNTHETIC_KNX_MBM_XML).toContain(knxLine);
    const doc = XmlDocument.parse(
      SYNTHETIC_KNX_MBM_XML.replace(knxLine, "\r\n      <IdxOperations></IdxOperations>"),
    );
    const temp = projectFromXml(doc).signals[1];
    expect(temp.conversions).toEqual({
      internal: { filters: [], operations: [] },
      external: { filters: [], operations: [{ index: 0, inverted: false }] },
    });
  });

  it("writes the conversion list like MAPS: filters first, then operations", () => {
    const doc = parseFixture();
    setConversions(doc, [
      { id: 0, description: "x0.1", type: 2, params: ["-1", "1", "0", "0"] },
      { id: 0, description: "Positive", type: 0, params: ["1", "3", "0", "100"] },
    ]);
    expect(projectFromXml(doc).conversions.map((c) => [c.description, c.type])).toEqual([
      ["Positive", 0],
      ["x0.1", 2],
    ]);
    expect(doc.serialize()).toContain(
      '    <Conversions>\r\n      <Conversion Id="0" Description="Positive" Type="0" Param1="1" Param2="3" Param3="0" Param4="100" />\r\n      <Conversion Id="0" Description="x0.1" Type="2" Param1="-1" Param2="1" Param3="0" Param4="0" />\r\n    </Conversions>',
    );
    setConversions(doc, []);
    expect(doc.serialize()).toContain("    <Conversions />");
  });

  it("writes each half's conversion refs without a trailing separator", () => {
    const doc = parseFixture();
    updateSignal(doc, 1, {
      conversionRefs: {
        internal: { filters: [{ index: 0, inverted: false }], operations: [{ index: 0, inverted: false }] },
        external: { filters: [{ index: 0, inverted: true }], operations: [{ index: 0, inverted: true }] },
      },
    });
    const xml = doc.serialize();
    expect(xml).toContain("      <IdxOperations>0,0</IdxOperations>\r\n      <IdxFilters>0,0</IdxFilters>");
    expect(xml).toContain("        <IdxOperations>0,1</IdxOperations>\r\n        <IdxFilters>0,1</IdxFilters>");
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

  it("adds devices disabled, on the first free slave and named after it (MAPS CreateRTUSlave)", () => {
    const doc = parseFixture();
    const slaves = projectFromXml(doc).mbm.rtuNodes[0].devices.map((device) => device.slave);
    const idx = addDevice(doc, { kind: "rtu", nodeIndex: 0 });
    let expected = 1;
    while (slaves.includes(expected)) expected++;
    expect(projectFromXml(doc).mbm.rtuNodes[0].devices[idx]).toMatchObject({
      slave: expected,
      name: `Device ${expected}`,
      timeout: 1000,
      enabled: false,
    });
  });

  it("skips taken names when naming a new device (MAPS GetFirstFreeDeviceName)", () => {
    const doc = parseFixture();
    addTcpNode(doc);
    addDevice(doc, { kind: "tcp", nodeIndex: 0 });
    updateDevice(doc, { kind: "tcp", nodeIndex: 0, deviceIndex: 0 }, { slave: 5, name: "Device 1" });
    addDevice(doc, { kind: "tcp", nodeIndex: 0 });
    expect(projectFromXml(doc).mbm.tcpNodes[0].devices[1]).toMatchObject({ slave: 1, name: "Device 2" });
  });

  it("setKnxExtendedAddresses toggles the flag", () => {
    const doc = parseFixture();
    setKnxExtendedAddresses(doc, true);
    expect(doc.serialize()).toContain("<UseExtendedAddresses>True</UseExtendedAddresses>");
  });
});

/**
 * RTU node 0: devices 0 (fixture), 1, 2. TCP nodes 0 and 1 (ports 1 and 2),
 * one device each. Signals 0–1 → RTU dev 0 (fixture), 2 → RTU dev 1,
 * 3 → RTU dev 2, 4 → RTU dev 1 (virtual), 5 → TCP 0, 6 → TCP 1, 7 → TCP 0 (virtual).
 */
function topologyFixture() {
  const doc = parseFixture();
  addDevice(doc, { kind: "rtu", nodeIndex: 0 });
  addDevice(doc, { kind: "rtu", nodeIndex: 0 });
  addTcpNode(doc);
  addTcpNode(doc);
  addDevice(doc, { kind: "tcp", nodeIndex: 0 });
  addDevice(doc, { kind: "tcp", nodeIndex: 1 });
  const refs: [port: number, device: number, virtual: boolean][] = [
    [0, 1, false],
    [0, 2, false],
    [0, 1, true],
    [1, 0, false],
    [2, 0, false],
    [1, 0, true],
  ];
  for (const [port, deviceIndex, virtual] of refs) {
    const id = addSignal(doc);
    updateSignal(doc, id, { modbus: { port, deviceIndex } });
    if (virtual) {
      const el = doc.find(["InternalProtocol", { tag: "KNXObject", attr: "ID", value: String(id) }, "Virtual"]);
      setAttr(el!, "Status", "True");
    }
  }
  return doc;
}

const refOf = (doc: XmlDocument, id: number) => {
  const signal = projectFromXml(doc).signals.find((s) => s.id === id);
  return signal && { port: signal.modbus.port, device: signal.modbus.deviceIndex, active: signal.active };
};

describe("topology removal (MAPS DeleteDevice / DeleteTCPNode)", () => {
  it("renumbers later devices and deletes the device's signals", () => {
    const doc = topologyFixture();
    removeDevice(doc, { kind: "rtu", nodeIndex: 0, deviceIndex: 1 }, "delete");
    const project = projectFromXml(doc);
    expect(project.mbm.rtuNodes[0].devices.map((d) => [d.index, d.name])).toEqual([
      [0, "Heat pump"],
      [1, "Device 3"],
    ]);
    expect(refOf(doc, 2)).toBeUndefined();
    expect(refOf(doc, 4)).toBeUndefined();
    expect(refOf(doc, 3)).toMatchObject({ port: 0, device: 1 });
    expect(refOf(doc, 0)).toMatchObject({ port: 0, device: 0 });
    expect(refOf(doc, 5)).toMatchObject({ port: 1, device: 0 });
  });

  it("can keep the device's signals unassigned and deactivated, still deleting virtual ones", () => {
    const doc = topologyFixture();
    removeDevice(doc, { kind: "rtu", nodeIndex: 0, deviceIndex: 1 }, "unassign");
    expect(refOf(doc, 2)).toEqual({ port: -1, device: -1, active: false });
    expect(refOf(doc, 4)).toBeUndefined();
    expect(refOf(doc, 3)).toMatchObject({ port: 0, device: 1, active: true });
  });

  it("adds and edits by position after a removal, without duplicate indexes", () => {
    const doc = topologyFixture();
    removeDevice(doc, { kind: "rtu", nodeIndex: 0, deviceIndex: 0 }, "delete");
    expect(addDevice(doc, { kind: "rtu", nodeIndex: 0 })).toBe(2);
    updateDevice(doc, { kind: "rtu", nodeIndex: 0, deviceIndex: 1 }, { name: "Edited" });
    const devices = projectFromXml(doc).mbm.rtuNodes[0].devices;
    expect(devices.map((d) => d.index)).toEqual([0, 1, 2]);
    // Slave 1 was freed by the removal, so the new device takes it and its name.
    expect(devices.map((d) => d.name)).toEqual(["Device 2", "Edited", "Device 1"]);
  });

  it("removes a TCP node: renumbers later nodes, unassigns its signals and shifts later ports", () => {
    const doc = topologyFixture();
    expect(removeNode(doc, { kind: "tcp", nodeIndex: 0 })).toBe(true);
    const project = projectFromXml(doc);
    expect(project.mbm.tcpNodes.map((n) => n.nodeIndex)).toEqual([0]);
    const signal5 = project.signals.find((s) => s.id === 5)!;
    expect(signal5.modbus).toMatchObject({ port: -1, deviceIndex: -1, isBroadcast: false });
    expect(refOf(doc, 7)).toBeUndefined();
    expect(refOf(doc, 6)).toMatchObject({ port: 1, device: 0 });
    expect(refOf(doc, 3)).toMatchObject({ port: 0, device: 2 });
  });

  it("removing an RTU node shifts every TCP port", () => {
    const doc = topologyFixture();
    removeNode(doc, { kind: "rtu", nodeIndex: 0 });
    expect(refOf(doc, 0)).toMatchObject({ port: -1, device: -1 });
    expect(refOf(doc, 4)).toBeUndefined();
    expect(refOf(doc, 5)).toMatchObject({ port: 0, device: 0 });
    expect(refOf(doc, 6)).toMatchObject({ port: 1, device: 0 });
  });
});

describe("conversion library", () => {
  /** Two filters, a LUT, two editable operations; signal 1 uses filter 1 and operation 2 (x0.01). */
  function libraryDoc() {
    const doc = parseFixture();
    setConversions(doc, [
      { id: 0, description: "Valid", type: 0, params: ["1", "4", "-50", "150"] },
      { id: 1, description: "Positive", type: 0, params: ["1", "3", "0", "100"] },
      { id: 0, description: "LUT", type: 4, params: ["0", "0", "0", "0"] },
      { id: 0, description: "x0.1", type: 2, params: ["-1", "1", "0", "0"] },
      { id: 1, description: "x0.01", type: 2, params: ["-2", "1", "0", "0"] },
    ]);
    updateSignal(doc, 1, {
      conversionRefs: {
        internal: { filters: [], operations: [] },
        external: {
          filters: [{ index: 1, inverted: false }, { index: 0, inverted: true }],
          operations: [{ index: 2, inverted: false }, { index: 1, inverted: false }],
        },
      },
    });
    return doc;
  }
  const list = (doc: XmlDocument) => projectFromXml(doc).conversions.map((c) => [c.id, c.description, c.type, ...c.params]);

  it("adds entries at the end of their list with the MAPS defaults and numbering", () => {
    const doc = libraryDoc();
    expect(addConversion(doc, 0)).toBe(2);
    expect(addConversion(doc, 1)).toBe(3);
    // The LUT is not counted: the manager does not list it (frmGateway.cs:579).
    expect(list(doc).slice(2, 3)).toEqual([[2, "Filter_2", 0, "0", "3", "0", "100"]]);
    expect(list(doc).at(-1)).toEqual([2, "Operation_2", 1, "0", "3", "0", "100"]);
    expect(doc.serialize()).toContain(
      '<Conversion Id="1" Description="Positive" Type="0" Param1="1" Param2="3" Param3="0" Param4="100" />\r\n      <Conversion Id="2" Description="Filter_2" Type="0"',
    );
  });

  it("adds a copy with the given values and validates it", () => {
    const doc = libraryDoc();
    expect(addConversion(doc, 2, { description: "Kelvin", params: [0, 1, -273.15, 0] })).toBe(3);
    expect(list(doc).at(-1)).toEqual([2, "Kelvin", 2, "0", "1", "-273.15", "0"]);
    expect(() => addConversion(doc, 1, { description: "Bad", params: [10, 0, 0, 100] })).toThrow(
      "Input min must not be greater than input max.",
    );
  });

  it("adds the first filter before the operations and into an empty list", () => {
    const doc = parseFixture();
    addConversion(doc, 0);
    expect(list(doc).map((c) => c[1])).toEqual(["Filter_0", "x0.1 to degC"]);
    setConversions(doc, []);
    addConversion(doc, 2);
    expect(doc.serialize()).toContain(
      '    <Conversions>\r\n      <Conversion Id="0" Description="Operation_0" Type="2" Param1="0" Param2="1" Param3="0" Param4="0" />\r\n    </Conversions>',
    );
  });

  it("updates the edited fields and stores Param4 = 0 for arithmetic", () => {
    const doc = libraryDoc();
    updateConversion(doc, { list: "filters", index: 0 }, { param3: -40, description: "Valid temp" });
    expect(list(doc)[0]).toEqual([0, "Valid temp", 0, "1", "4", "-40", "150"]);
    updateConversion(doc, { list: "operations", index: 1 }, { type: 1, param2: 1000, param3: 0, param4: 100 });
    expect(list(doc)[3]).toEqual([0, "x0.1", 1, "-1", "1000", "0", "100"]);
    updateConversion(doc, { list: "operations", index: 1 }, { type: 2 });
    expect(list(doc)[3]).toEqual([0, "x0.1", 2, "-1", "1000", "0", "0"]);
  });

  it("rejects invalid edits and system entries", () => {
    const doc = libraryDoc();
    expect(() => updateConversion(doc, { list: "filters", index: 0 }, { param3: 200 })).toThrow(
      "Low must not be greater than High.",
    );
    expect(() => updateConversion(doc, { list: "operations", index: 0 }, { description: "x" })).toThrow(
      "cannot be edited or removed",
    );
    expect(() => removeConversion(doc, { list: "operations", index: 0 })).toThrow("cannot be edited or removed");
    expect(() => updateConversion(doc, { list: "filters", index: 5 }, { description: "x" })).toThrow("There is no filter 5.");
  });

  it("removes an entry, drops its refs and shifts the later ones on both halves", () => {
    const doc = libraryDoc();
    expect(removeConversion(doc, { list: "operations", index: 1 })).toEqual([1]);
    expect(projectFromXml(doc).signals[1].conversions.external.operations).toEqual([{ index: 1, inverted: false }]);
    // The KNX half of signal 1 was empty; signal 0 had no refs.
    expect(projectFromXml(doc).signals[1].conversions.internal.operations).toEqual([]);
    expect(removeConversion(doc, { list: "filters", index: 0 })).toEqual([1]);
    expect(projectFromXml(doc).signals[1].conversions.external.filters).toEqual([{ index: 0, inverted: false }]);
    expect(list(doc).map((c) => c[1])).toEqual(["Positive", "LUT", "x0.01"]);
  });

  it("writes an emptied list as <Conversions />", () => {
    const doc = parseFixture();
    removeConversion(doc, { list: "operations", index: 0 });
    expect(doc.serialize()).toContain("  <IBOX");
    expect(doc.serialize()).toContain("    <Conversions />\r\n  </IBOX>");
    expect(projectFromXml(doc).signals[1].conversions.external.operations).toEqual([]);
  });
});
