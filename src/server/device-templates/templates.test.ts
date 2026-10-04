import { createCipheriv, createHmac } from "node:crypto";
import { gzipSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { XmlDocument, getAttr } from "@/core/project-format";
import { projectFromXml, addTcpNode } from "@/gateway-families/knx-mbm";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import type { ApplyDeviceTemplate } from "@/core/device-templates/types";
import { decryptDeviceTemplate, encryptDeviceTemplate } from "./crypto";
import { parseDeviceTemplate, readDeviceTemplate, readDeviceTemplateMetadata } from "./read";
import { applyDeviceTemplate } from "./apply";
import { exportDeviceTemplate } from "./export";
import { TEMPLATE_XML } from "./fixtures";
import { value } from "./xml";
import { copy } from "./xml";
import { generateKnxMbmXbl } from "@/gateway-families/knx-mbm/xbl";
import { childByTag, decodeElements } from "@/core/xbl";

const options: ApplyDeviceTemplate = { type: "applyDeviceTemplate", token: "unused", locator: { kind: "rtu", nodeIndex: 0 }, name: "Imported AHU", slave: 2, enabled: [0], includeDisabled: false };
const projectDoc = () => XmlDocument.parse(SYNTHETIC_KNX_MBM_XML);

describe("MAPS device template format", () => {
  it.each([
    ["0", true, "HMS Industrial Networks SLU"],
    ["1", true, "Fujitsu General Limited"],
    ["6", true, "ABB"],
    ["-1", false, "—"],
    ["99", null, "OEM 99"],
    ["invalid", null, "—"],
    ["", null, "—"],
  ])("reports the MAPS OEM stamp for Author=%s independently of file integrity", (author, signed, name) => {
    const xml = TEMPLATE_XML.replace('Author="0"', `Author="${author}"`);
    const metadata = readDeviceTemplateMetadata(encryptDeviceTemplate(xml));
    expect(metadata).toMatchObject({ version: "1.0.0.0", mapsVersion: "1.2.34.0", signed, author: name });
    expect(parseDeviceTemplate(xml).preview).toMatchObject(metadata);
  });

  it("treats a missing OEM stamp as unsigned and rejects damaged metadata files", () => {
    expect(readDeviceTemplateMetadata(encryptDeviceTemplate(TEMPLATE_XML.replace(' Author="0"', "")))).toMatchObject({ authorCode: -1, signed: false });
    expect(() => readDeviceTemplateMetadata(Buffer.from(TEMPLATE_XML))).toThrow(/damaged/);
    expect(() => readDeviceTemplateMetadata(encryptDeviceTemplate(TEMPLATE_XML.replace('Version="1.0.0.0"', 'Version="invalid"')))).toThrow(/version header/);
  });

  it("reads current SHA256 exports and legacy SHA1 files with authenticated XML", () => {
    const bytes = encryptDeviceTemplate(TEMPLATE_XML);
    expect(decryptDeviceTemplate(bytes)).toBe(TEMPLATE_XML);
    const key = Buffer.from([106,88,157,110,26,47,85,22,119,231,226,124,44,160,109,42]);
    const iv = Buffer.from([180,212,213,66,200,32,232,45,184,41,21,87,59,236,173,46]);
    const raw = Buffer.from(TEMPLATE_XML);
    const cipher = createCipheriv("aes-128-cbc",key,iv);
    const legacy = Buffer.concat([cipher.update(gzipSync(Buffer.concat([raw,createHmac("sha1",iv).update(raw).digest()]))),cipher.final()]);
    expect(readDeviceTemplate(legacy).preview.signals).toHaveLength(2);
    const damaged = Uint8Array.from(bytes); damaged[16] ^= 1;
    expect(() => decryptDeviceTemplate(damaged)).toThrow(/damaged/);
    expect(() => decryptDeviceTemplate(Buffer.from(TEMPLATE_XML))).toThrow(/damaged/);
  });

  it("keeps actual mappings and supplies desktop device defaults and metadata", () => {
    const parsed = parseDeviceTemplate(TEMPLATE_XML,"Test manufacturer");
    expect(parsed.preview.device).toMatchObject({ manufacturer: "Test manufacturer", baseRegister: 0, timeout: 750 });
    expect(parsed.preview.signals[0]).toMatchObject({ description: "Temperature & demand", knx: { dpt: 2305, groupAddress: 102, additionalAddresses: [300], priority: 2 }, modbus: { lenBits: 32, format: 3, byteOrder: 2, address: 17, deadband: 0.25 } });
    expect(parsed.preview.signals[1]).toMatchObject({ active: false, modbus: { lenBits: 64, writeFunc: -1 } });
    // The per-signal deadband reaches the gateway (tag 15): nothing to warn about.
    expect(parsed.preview.warnings.some((w) => w.includes("deadband"))).toBe(false);
  });

  it.each([
    TEMPLATE_XML.replace('ID="1"','ID="2"'),
    TEMPLATE_XML.replace('<Address>17</Address>','<Address>NaN</Address>'),
    TEMPLATE_XML.replace('<ReadFunc>3</ReadFunc>','<ReadFunc>99</ReadFunc>'),
    TEMPLATE_XML.replace('<IdxFilters>0,1</IdxFilters>','<IdxFilters>NaN,1</IdxFilters>'),
    TEMPLATE_XML.replace('<IdxFilters>0,1</IdxFilters>','<IdxFilters>4,0</IdxFilters>'),
    TEMPLATE_XML.replace('Value="2305"','Value="oops"'),
    TEMPLATE_XML.replace('Type="1"','Type="4"'),
    TEMPLATE_XML.replace('Status="False"','Status="True"'),
    TEMPLATE_XML.replace('</Signals>','</Signals><Device Name="Second"/>'),
    '<!DOCTYPE Template [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + TEMPLATE_XML,
  ])("rejects malformed mappings before touching a project", (xml) => {
    expect(() => parseDeviceTemplate(xml)).toThrow();
  });

  it("adapts BACnet using desktop default DPT rules, keeping MBM values and dropping BACnet refs", () => {
    const doc = XmlDocument.parse(TEMPLATE_XML);
    const internal = doc.find(["InternalProtocol"])!;
    internal.attrs = [["ProtocolType","BACnet Server"]];
    internal.children = [];
    const bacXml = '<BACnetObject ID="0"><Name>BAC temperature</Name><Active>True</Active><IdxOperations>999,0</IdxOperations></BACnetObject><BACnetObject ID="1"><Name>Counter</Name><Active>False</Active></BACnetObject>';
    const bac = XmlDocument.parse(`<InternalProtocol>${bacXml}</InternalProtocol>`);
    internal.children = bac.root.children;
    const parsed = parseDeviceTemplate(doc.serialize());
    expect(parsed.preview.sourceProtocol).toBe("bacnet");
    expect(parsed.preview.signals[0]).toMatchObject({ description: "BAC temperature", knx: { dpt: 2559, groupAddress: 0, flags: { u: true, t: true, w: true, r: true } }, conversions: { internal: { operations: [] } }, modbus: { lenBits: 32, address: 17 } });
    expect(parsed.preview.signals[1].knx.dpt).toBe(2047);
    expect(parsed.preview.warnings.some((w) => w.includes("adapted to KNX"))).toBe(true);
  });
});

describe("apply / export Modbus device templates", () => {
  it("adds an enabled device and communication row, merges conversions by numeric params, and preserves existing and unknown XML", () => {
    const doc = projectDoc(), before = projectFromXml(doc);
    applyDeviceTemplate(doc,parseDeviceTemplate(TEMPLATE_XML),options);
    const after = projectFromXml(doc);
    expect(after.signals.slice(0,2)).toEqual(before.signals);
    expect(after.signals).toHaveLength(4);
    expect(after.mbm.rtuNodes[0].devices[1]).toMatchObject({ index: 1, name: "Imported AHU", slave: 2, enabled: true, baseRegister: 0, timeout: 750 });
    expect(after.signals[2]).toMatchObject({ active: true, virtual: true, modbusFixed: true, knx: { dpt: 257, flags: { u: true, t: false, w: true, r: false } }, modbus: { port: 0, deviceIndex: 1, address: -1, format: 99 } });
    expect(after.signals[3]).toMatchObject({ description: "Temperature & demand", knx: { groupAddress: 102, additionalAddresses: [300] }, conversions: { internal: { operations: [{index:0,inverted:false},{index:1,inverted:true}] }, external: { operations: [{index:1,inverted:false},{index:0,inverted:true}] } } });
    expect(after.conversions).toHaveLength(3);
    expect(after.conversions.filter((c) => c.type === 1)[0].description).toBe(before.conversions[0].description);
    expect(doc.serialize()).toContain("<VendorExtension>keep me</VendorExtension>");
    expect(doc.serialize()).toContain('VendorAttr="retained"');
  });

  it("includes disabled rows only when requested and rebases TCP ports and device indexes", () => {
    const doc = projectDoc(); addTcpNode(doc);
    applyDeviceTemplate(doc,parseDeviceTemplate(TEMPLATE_XML),{ ...options, locator: { kind:"tcp",nodeIndex:0 }, slave:0, includeDisabled:true });
    const project = projectFromXml(doc);
    expect(project.signals).toHaveLength(5);
    expect(project.signals[4]).toMatchObject({ active:false, modbus:{ port:1,deviceIndex:0,lenBits:64,address:500 } });
    expect(project.mbm.tcpNodes[0].devices[0].slave).toBe(0);
    const exported = readDeviceTemplate(exportDeviceTemplate(doc,{kind:"tcp",nodeIndex:0,deviceIndex:0}).bytes);
    expect(exported.preview).toMatchObject({ authorCode: -1, signed: false });
    expect(exported.preview.signals).toHaveLength(2);
    expect(exported.preview.signals[1]).toMatchObject({ id:1,active:false,modbus:{port:0,deviceIndex:0} });
    expect(exported.preview.signals[0].knx.additionalAddresses).toEqual([300]);
    expect(exported.preview.conversions).toHaveLength(3);
  });

  it("compiles the imported device, communication error and register in XBL with its actual address and width", () => {
    const doc = projectDoc();
    applyDeviceTemplate(doc,parseDeviceTemplate(TEMPLATE_XML),options);
    const xbl = generateKnxMbmXbl(doc.serialize(),{now:new Date(2026,0,1)});
    const mbm = decodeElements(xbl).find((node) => node.tag === 6)!;
    const devices = childByTag(childByTag(mbm,3),1).items!;
    expect(devices).toHaveLength(2);
    const signals = childByTag(childByTag(mbm,6),1).items!;
    const content = (items: typeof signals[number], tag: number) => {
      const element = items.find((e) => e.tag === tag)!;
      return [...xbl.slice(element.contentOffset,element.contentOffset+element.contentLength)];
    };
    const imported = signals.find((s) => s.some((e) => e.tag === 9 && xbl[e.contentOffset] === 17))!;
    expect(imported).toBeDefined();
    expect(content(imported,5)).toEqual([32]);
    expect(content(imported,7)).toEqual([2]);
    const slave = devices[1].find((e) => e.tag === 1)!;
    expect([...xbl.slice(slave.contentOffset,slave.contentOffset+slave.contentLength)]).toEqual([2]);
  });

  it.each([{slave:1},{name:"Heat pump"},{slave:0},{enabled:[999]},{enabled:[]},{enabled:[0,0]}, {locator:{kind:"rtu" as const,nodeIndex:9}}])("rejects invalid destination/selection without changing XML", (bad) => {
    const doc = projectDoc(), original = doc.serialize();
    expect(() => applyDeviceTemplate(doc,parseDeviceTemplate(TEMPLATE_XML),{...options,...bad})).toThrow();
    expect(doc.serialize()).toBe(original);
  });

  it.each([[3000,true],[4999,false]] as const)("counts the communication-error row against signal capacity (%s existing rows)", (count,active) => {
    const doc = projectDoc();
    const internal = doc.find(["InternalProtocol"])!, external = doc.find(["ExternalProtocol","Signals"])!;
    const k = doc.find(["InternalProtocol",{tag:"KNXObject",attr:"ID",value:"0"}])!, m = doc.find(["ExternalProtocol","Signals",{tag:"Signal",attr:"ID",value:"0"}])!;
    for (let i=2;i<count;i++) {
      const nextK=copy(k),nextM=copy(m);
      nextK.attrs=[["ID",String(i)]]; nextM.attrs=[["ID",String(i)]];
      const activeNode=nextK.children.find((n) => n.kind==="element" && n.tag==="Active")!;
      if (activeNode.kind==="element") activeNode.children=[{kind:"text",text:active ? "True" : "False"}];
      internal.children.push(nextK);external.children.push(nextM);
    }
    const xml = doc.serialize();
    expect(() => applyDeviceTemplate(doc,parseDeviceTemplate(TEMPLATE_XML),options)).toThrow(/capacity/);
    expect(doc.serialize()).toBe(xml);
  });
});

// Local official fixtures are deliberately not committed. These checks run whenever they are present.
describe("official encrypted template fixtures", () => {
  for (const [file,total,active] of [
    ["knx-daikin-ekmbdxa.knxmbm",4417,2881],
    ["knx-belimo-epiv-6way-control-valves.knxmbm",60,37],
    ["bacnet-abb-ach-550-dcu.bacmbm",609,138],
    ["bacnet-haier-super-clima-b.bacmbm",117,107],
  ] as const) {
    const path = `.local-data/fixtures/modbus-templates-research/${file}`;
    it.skipIf(!existsSync(path))(`loads, applies and exports ${file}`, () => {
      const template = readDeviceTemplate(readFileSync(path));
      expect(template.preview.signals).toHaveLength(total);
      expect(template.preview.signals.filter((s) => s.active)).toHaveLength(active);
      const doc = projectDoc();
      const enabled = template.preview.signals.filter((s) => s.active).map((s) => s.id);
      applyDeviceTemplate(doc,template,{...options,enabled,includeDisabled:true});
      expect(projectFromXml(doc).signals).toHaveLength(total + 3);
      const exported = readDeviceTemplate(exportDeviceTemplate(doc,{kind:"rtu",nodeIndex:0,deviceIndex:1}).bytes);
      expect(exported.preview.signals).toHaveLength(total);
      expect(exported.preview.signals.map((s) => s.modbus)).toEqual(template.preview.signals.map((s) => ({...s.modbus,port:0,deviceIndex:0})));
      expect(getAttr(exported.knx[0],"ID")).toBe("0");
      expect(value(exported.modbus[total-1],"idxConfig")).toBe(String(total-1));
    }, 20000);
  }
});
