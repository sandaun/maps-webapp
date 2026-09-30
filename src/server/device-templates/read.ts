import "server-only";
import { appendChild, element, formatSingle, getAttr, parseMapsSingle, setAttr, XmlDocument, type XmlElement } from "@/core/project-format";
import { projectFromXml } from "@/gateway-families/knx-mbm";
import type { DeviceTemplatePreview } from "@/core/device-templates/types";
import { ProjectServiceError } from "@/server/projects/errors";
import { readHalfConversionRefs } from "@/core/signals/conversion-refs";
import { parseFloatLenient } from "@/core/xbl/conversions";
import { compareMapsVersions, MAPS_REFERENCE_VERSION } from "@/core/project-format/maps-version";
import { checkMbmSignal } from "@/protocols/modbus/master";
import { children, child, copy, value, write } from "./xml";
import { decryptDeviceTemplate } from "./crypto";

export interface ParsedDeviceTemplate {
  doc: XmlDocument;
  preview: Omit<DeviceTemplatePreview, "token" | "revision" | "fileName">;
  knx: XmlElement[];
  modbus: XmlElement[];
  device: XmlElement;
  conversions: XmlElement[];
}

export function readDeviceTemplate(bytes: Uint8Array, manufacturer = ""): ParsedDeviceTemplate {
  return parseDeviceTemplate(decryptDeviceTemplate(bytes), manufacturer);
}

export function parseDeviceTemplate(xml: string, manufacturer = ""): ParsedDeviceTemplate {
  // The preservation parser deliberately does not implement external entities.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ProjectServiceError(422, "Unsupported template XML declarations.");
  let depth = 0;
  for (const tag of xml.matchAll(/<\/?[A-Za-z][^>]*>/g)) {
    if (tag[0].startsWith("</")) depth--;
    else if (!tag[0].endsWith("/>")) depth++;
    if (depth > 100) throw new ProjectServiceError(422, "Template XML nesting is too deep.");
  }
  let doc: XmlDocument;
  try { doc = XmlDocument.parse(xml); } catch {
    throw new ProjectServiceError(422, "Invalid template XML.");
  }
  if (doc.root.tag !== "Template") throw new ProjectServiceError(422, "This file is not a MAPS device template.");
  const version = getAttr(doc.root, "Version") ?? "";
  const mapsVersion = getAttr(doc.root, "MAPSVersion") ?? "";
  if (![version, mapsVersion].every((v) => /^\d+(\.\d+){1,3}$/.test(v)))
    throw new ProjectServiceError(422, "Invalid template version header.");
  const external = doc.find(["ExternalProtocol"]);
  const internal = doc.find(["InternalProtocol"]);
  if (!external || !internal || !["Modbus Master", "Modbus Server"].includes(getAttr(external, "ProtocolType") ?? ""))
    throw new ProjectServiceError(422, "This template is not for a general Modbus Master device.");
  const protocol = getAttr(internal, "ProtocolType");
  if (protocol !== "KNX" && protocol !== "BACnet Server")
    throw new ProjectServiceError(422, "Unsupported template BMS protocol.");
  const device = children(external, "Device")[0];
  const modbus = doc.findAll(["ExternalProtocol", "Signals", "Signal"]);
  const objects = children(internal, protocol === "KNX" ? "KNXObject" : "BACnetObject");
  if (!device || children(external, "Device").length !== 1 || !modbus.length || modbus.length > 5000 || objects.length !== modbus.length)
    throw new ProjectServiceError(422, "Template must contain one device and matching BMS/Modbus signal rows (maximum 5000).");
  const knx = objects.map((obj, i) => {
    if (getAttr(obj, "ID") === undefined || getAttr(modbus[i], "ID") === undefined || Number(getAttr(obj, "ID")) !== i || Number(getAttr(modbus[i], "ID")) !== i)
      throw new ProjectServiceError(422, "Template signal IDs must be consecutive and aligned on both sides.");
    if ([obj, modbus[i]].some((el) => getAttr(children(el, "Virtual")[0] ?? element("Virtual"), "Status")?.toLowerCase() === "true"))
      throw new ProjectServiceError(422, "Device templates must not contain virtual signals.");
    validateModbusRow(modbus[i]);
    // Older files can contain locale decimals; store the float as MAPS writes it.
    const deadband = value(modbus[i], "Deadband");
    if (deadband !== undefined) write(modbus[i], "Deadband", formatSingle(parseMapsSingle(deadband)));
    validateBoolean(value(obj, "Active"));
    if (protocol === "KNX") validateKnxRow(obj);
    return protocol === "KNX" ? copy(obj) : bacnetToKnx(obj, modbus[i], i);
  });
  const conversions = children(doc.find(["Conversions"]) ?? element("Conversions"), "Conversion");
  for (const conv of conversions) {
    const type = Number(getAttr(conv, "Type"));
    if (getAttr(conv, "Type") === undefined || ![0,1,2,3,4].includes(type) || [1,2,3,4].some((i) => {
      const param = getAttr(conv, `Param${i}`);
      return param === undefined || param.trim() === "" || !Number.isFinite(parseFloatLenient(param));
    }))
      throw new ProjectServiceError(422, "Invalid template conversion.");
  }
  for (const obj of [...knx, ...modbus]) {
    for (const tag of ["IdxFilters", "IdxOperations"]) {
      const raw = value(obj, tag);
      if (raw && raw.split(";").filter(Boolean).some((s) => !/^\d+,[01]$/.test(s)))
        throw new ProjectServiceError(422, "Invalid template conversion reference.");
    }
    const refs = readHalfConversionRefs(value(obj, "IdxFilters"), value(obj, "IdxOperations"));
    for (const list of ["filters", "operations"] as const) {
      const library = conversions.filter((c) => (Number(getAttr(c, "Type")) === 0) === (list === "filters"));
      const size = library.length;
      if (refs[list].some((r) => !Number.isInteger(r.index) || r.index < 0 || r.index >= size))
        throw new ProjectServiceError(422, "Template refers to a conversion that is missing.");
      if (refs[list].some((r) => Number(getAttr(library[r.index], "Type")) === 4))
        throw new ProjectServiceError(422, "This template references a lookup-table conversion. MAPS device templates do not carry the required lookup data.");
    }
  }
  // Reuse the project's parsers rather than maintaining a second MBM/KNX model.
  const modelDoc = XmlDocument.parse('<Project Platform="2" InternalProtocol="KNX" ExternalProtocol="Modbus Master"><IBOX/><InternalProtocol ProtocolType="KNX"/><ExternalProtocol ProtocolType="Modbus Master"><RtuNodes><RtuNode/></RtuNodes><Signals/></ExternalProtocol></Project>');
  appendChild(modelDoc.find(["IBOX"])!, element("Conversions", [], conversions.map(copy)));
  for (const obj of knx) appendChild(modelDoc.find(["InternalProtocol"])!, copy(obj));
  const deviceCopy = copy(device);
  for (const [attr, fallback, min, max] of [["BaseRegister", 0, 0, 1], ["Timeout", 1000, 100, 30000], ["SlaveNum", 1, 0, 255]] as const) {
    const raw = getAttr(deviceCopy, attr);
    const n = raw === undefined ? fallback : Number(raw);
    if (raw === "" || !Number.isInteger(n) || n < min || n > max) throw new ProjectServiceError(422, `Invalid template device ${attr}.`);
    setAttr(deviceCopy, attr, String(n));
  }
  if (!getAttr(deviceCopy, "Manufacturer")) setAttr(deviceCopy, "Manufacturer", manufacturer);
  appendChild(modelDoc.find(["ExternalProtocol","RtuNodes","RtuNode"])!, deviceCopy);
  for (const sig of modbus) appendChild(modelDoc.find(["ExternalProtocol","Signals"])!, copy(sig));
  const project = projectFromXml(modelDoc);
  if (project.signals.some((s) => [s.modbus.address, s.modbus.lenBits, s.modbus.format, s.knx.dpt].some((n) => !Number.isInteger(n))))
    throw new ProjectServiceError(422, "Template contains invalid signal values.");
  const warnings: string[] = [];
  const paddedMapsVersion = mapsVersion.split(".").concat(["0", "0"]).slice(0, 4).join(".");
  if (compareMapsVersions(paddedMapsVersion, MAPS_REFERENCE_VERSION) > 0)
    warnings.push(`This template was saved by MAPS ${mapsVersion}, newer than the verified reference ${MAPS_REFERENCE_VERSION}. Review the mapping before deploying.`);
  const invalid = project.signals.filter((s) => checkMbmSignal({ ...s.modbus, deviceBase: project.mbm.rtuNodes[0].devices[0].baseRegister }).length);
  if (invalid.length) warnings.push(`${invalid.length} objects have Modbus settings that need review. Their original values are preserved; project validation reports active errors after import.`);
  if (protocol === "BACnet Server") warnings.push("BACnet template adapted to KNX: Modbus registers are retained; default KNX DPTs and flags replace the BACnet mapping. Assign group addresses in Signals.");
  const author = Number(getAttr(doc.root, "Author") ?? -1);
  return { doc, knx, modbus, device: deviceCopy, conversions,
    preview: { sourceProtocol: protocol === "KNX" ? "knx" : "bacnet", version, mapsVersion,
      author: author === 0 ? "Intesis" : author === -1 ? "—" : `OEM ${author}`,
      device: { ...project.mbm.rtuNodes[0].devices[0], enabled: true }, signals: project.signals, conversions: project.conversions, warnings } };
}

/** MAPS InternalKnx.CreateDefaultKNXObjects: preserve activity/name, infer flags and DPT from MBM. */
function bacnetToKnx(bac: XmlElement, mbm: XmlElement, index: number): XmlElement {
  const rawRead = Number(value(mbm, "ReadFunc")), rawWrite = Number(value(mbm, "WriteFunc"));
  const read = rawRead === 255 ? -1 : rawRead;
  const writeFunc = rawWrite === 255 ? -1 : rawWrite;
  const format = Number(value(mbm, "Format"));
  const readBit = read === 1 || read === 2, readReg = read === 3 || read === 4;
  const writeBit = writeFunc === 5 || writeFunc === 15, writeReg = writeFunc === 6 || writeFunc === 16;
  const registerPair = (readReg && writeReg) || (readReg && writeFunc === -1) || (read === -1 && writeReg);
  const bitPair = (readBit && writeBit) || (readBit && writeFunc === -1) || (read === -1 && writeBit);
  const main = registerPair ? format === 0 ? 7 : format === 1 || format === 2 ? 8 : format === 3 ? 9 : format === 4 && Number(value(mbm,"NumOfBits")) === 1 ? 1 : 0 : bitPair ? 1 : 0;
  const obj = element("KNXObject", [["ID", String(index)]]);
  write(obj, "Description", value(bac, "Name") ?? getAttr(bac, "Name") ?? value(bac, "Description") ?? "");
  write(obj, "Active", value(bac, "Active") ?? "True");
  appendChild(obj, element("DPT", [["Value", String(main ? main * 256 + 255 : 0)]]));
  appendChild(obj, element("SendingAddress", [["Value", "0"], ["String", ""]]));
  appendChild(obj, element("ListeningAddresses"));
  const r = registerPair && readReg || bitPair && readBit, w = registerPair && writeReg || bitPair && writeBit;
  // Desktop deliberately leaves T=false for a read/write coil pair.
  appendChild(obj, element("Flags", [["U", String(w)],["T",String(r && !(readBit && writeBit))],["Ri","False"],["W",String(w)],["R",String(r)]]));
  write(obj, "Priority", 0); write(obj, "UpdateGA", 0);
  write(obj, "IdxExternal", index); write(obj, "IdxConfig", index);
  child(obj, "IdxOperations"); child(obj, "IdxFilters");
  appendChild(obj, element("Virtual", [["Status","False"],["Fixed","False"],["General","False"]]));
  return obj;
}

function integer(raw: string | undefined, min: number, max: number): number {
  if (raw === undefined || raw.trim() === "" || !Number.isInteger(Number(raw)) || Number(raw) < min || Number(raw) > max)
    throw new ProjectServiceError(422, "Template contains a missing or invalid numeric value.");
  return Number(raw);
}

function validateBoolean(raw: string | undefined) {
  if (raw !== undefined && !/^(true|false)$/i.test(raw))
    throw new ProjectServiceError(422, "Template contains an invalid boolean value.");
}

function validateModbusRow(row: XmlElement) {
  for (const [tag, allowed] of [["ReadFunc", [-1,255,1,2,3,4]], ["WriteFunc", [-1,255,5,6,15,16]],
    ["LenBits",[1,16,32,48,64]], ["Format",[-1,255,0,1,2,3,4,5]], ["ByteOrder",[-1,255,0,1,2,3]]] as const) {
    if (!(allowed as readonly number[]).includes(integer(value(row,tag),-1,255)))
      throw new ProjectServiceError(422, `Invalid Modbus ${tag} in template.`);
  }
  integer(value(row,"Address"),0,65535);
  integer(value(row,"Bit"),-1,63);
  integer(value(row,"NumOfBits"),-1,64);
  validateBoolean(value(row,"IsBroadcast"));
  const deadband = value(row,"Deadband");
  if (deadband !== undefined && (deadband.trim() === "" || !Number.isFinite(parseFloatLenient(deadband))))
    throw new ProjectServiceError(422, "Invalid Modbus deadband in template.");
}

function validateKnxRow(row: XmlElement) {
  integer(getAttr(children(row,"DPT")[0] ?? element("DPT"),"Value"),0,65535);
  integer(getAttr(children(row,"SendingAddress")[0] ?? element("SendingAddress"),"Value"),0,65535);
  for (const address of children(children(row,"ListeningAddresses")[0] ?? element("ListeningAddresses"),"Address"))
    integer(getAttr(address,"Value"),0,65535);
  integer(value(row,"Priority"),0,3);
  const flags = children(row,"Flags")[0];
  if (!flags) throw new ProjectServiceError(422,"Template is missing KNX flags.");
  for (const key of ["U","T","Ri","W","R"]) {
    const raw = getAttr(flags,key);
    if (raw === undefined) throw new ProjectServiceError(422,"Template is missing KNX flags.");
    validateBoolean(raw);
  }
}
