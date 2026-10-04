import "server-only";
import { appendChildIndented, getAttr, setAttr, XmlDocument } from "@/core/project-format";
import { MAPS_REFERENCE_VERSION } from "@/core/project-format/maps-version";
import { projectFromXml } from "@/gateway-families/knx-mbm";
import { ProjectServiceError } from "@/server/projects/errors";
import { readHalfConversionRefs } from "@/core/signals/conversion-refs";
import { copy, value, write, children } from "./xml";
import { remapReferences } from "./apply";
import { encryptDeviceTemplate } from "./crypto";

export function exportDeviceTemplate(doc: XmlDocument, locator: { kind: "rtu" | "tcp"; nodeIndex: number; deviceIndex: number }) {
  const project = projectFromXml(doc);
  const node = locator.kind === "rtu"
    ? doc.findAll(["ExternalProtocol","RtuNodes","RtuNode"])[locator.nodeIndex]
    : doc.findAll(["ExternalProtocol","TCPNodes","TCPNode"])[locator.nodeIndex];
  const device = node && children(node,"Device")[locator.deviceIndex];
  if (!device) throw new ProjectServiceError(404,"Modbus device not found.");
  const port = locator.kind === "rtu" ? locator.nodeIndex : project.mbm.rtuNodes.length + locator.nodeIndex;
  const selected = project.signals.filter((s) => s.modbus.port === port && s.modbus.deviceIndex === locator.deviceIndex && !s.virtual && !s.modbusVirtual);
  if (!selected.length) throw new ProjectServiceError(422,"This device has no non-virtual signals to export.");
  const out = XmlDocument.parse('<?xml version="1.0" encoding="UTF-8"?><Template Version="1.0.0.0" MAPSVersion="" Author="-1"><Conversions/><InternalProtocol ProtocolType="KNX"/><ExternalProtocol ProtocolType="Modbus Master"><Signals/></ExternalProtocol></Template>');
  setAttr(out.root,"MAPSVersion", MAPS_REFERENCE_VERSION);
  const d = copy(device); setAttr(d,"Index","0");
  appendChildIndented(out.find(["ExternalProtocol"])!,d,2);
  // Index once: looking up each row by scanning the document makes large exports quadratic.
  const knxById = new Map(doc.findAll(["InternalProtocol","KNXObject"]).map((el) => [getAttr(el,"ID"),el]));
  const modbusById = new Map(doc.findAll(["ExternalProtocol","Signals","Signal"]).map((el) => [getAttr(el,"ID"),el]));
  const sources = selected.map((s) => {
    const k = knxById.get(String(s.id)), m = modbusById.get(String(s.id));
    if (!k || !m) throw new ProjectServiceError(422,"The device has an incomplete signal mapping. Fix it before exporting.");
    return { k: copy(k), m: copy(m) };
  });
  const conversions = doc.findAll(["IBOX","Conversions","Conversion"]);
  const maps = { filters: [] as number[], operations: [] as number[] };
  for (const list of ["filters","operations"] as const) {
    const library = conversions.filter((c) => (Number(getAttr(c,"Type")) === 0) === (list === "filters"));
    const used = new Set(sources.flatMap(({k,m}) => [k,m].flatMap((obj) => readHalfConversionRefs(value(obj,"IdxFilters"),value(obj,"IdxOperations"))[list].map((r) => r.index))));
    for (const [newIndex,index] of [...used].sort((a,b) => a-b).entries()) {
      if (!library[index]) throw new ProjectServiceError(422,"The device references a missing conversion. Fix it before exporting.");
      if (Number(getAttr(library[index],"Type")) === 4) throw new ProjectServiceError(422,"Cannot export a device that uses lookup-table conversions: MAPS templates do not carry the required lookup data.");
      const c = copy(library[index]); setAttr(c,"Id",String(newIndex));
      appendChildIndented(out.find(["Conversions"])!,c,2); maps[list][index] = newIndex;
    }
  }
  sources.forEach(({k,m},i) => {
    setAttr(k,"ID",String(i)); write(k,"IdxConfig",i); write(k,"IdxExternal",i);
    setAttr(m,"ID",String(i)); write(m,"idxConfig",i); write(m,"idxExternal",i);
    write(m,"Port",0); write(m,"DeviceIndex",0);
    remapReferences(k,maps); remapReferences(m,maps);
    appendChildIndented(out.find(["InternalProtocol"])!,k,2);
    appendChildIndented(out.find(["ExternalProtocol","Signals"])!,m,3);
  });
  return { bytes: encryptDeviceTemplate(out.serialize()), fileName: `${getAttr(device,"Name") ?? "device"}.knxmbm` };
}
