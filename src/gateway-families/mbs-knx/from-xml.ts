import {
  getAttr,
  getText,
  XmlDocument,
  type XmlElement,
} from "@/core/project-format";
import { readHalfConversionRefs } from "@/core/signals/conversion-refs";
import { defaultKnxEndpoint } from "@/protocols/knx";
import { readKnxConfig, readKnxEndpoint } from "@/protocols/knx/xml";
import { defaultMbsEndpoint, FORMATS, type MbsEndpoint } from "@/protocols/modbus/slave";
import { readMbsConfig, readMbsEndpoint } from "@/protocols/modbus/slave/xml";
import type { Conversion, GatewayInfo, MbsKnxProject, MbsKnxSignal } from "./model";
import { isMbsKnxProject } from "./detect";

/** Parse an .ibmaps document into the MBS–KNX project model. */
export function projectFromXml(doc: XmlDocument): MbsKnxProject {
  if (!isMbsKnxProject(doc)) {
    throw new Error("Not a KNX ↔ Modbus Slave project");
  }
  return {
    name: doc.getAttr([], "ProjectName") ?? "",
    description: doc.getAttr([], "ProjectDescription") ?? "",
    gateway: readGateway(doc),
    mbs: readMbsConfig(doc.find(["InternalProtocol"])),
    knx: readKnxConfig(doc.find(["ExternalProtocol"])),
    signals: readSignals(doc),
    conversions: readConversions(doc),
  };
}

function readGateway(doc: XmlDocument): GatewayInfo {
  // Pwd is intentionally NOT read into the model.
  return {
    name: doc.getAttr(["IBOX"], "Name") ?? "",
    ip: doc.getAttr(["IBOX"], "IP") ?? "",
    netmask: doc.getAttr(["IBOX"], "NetMask") ?? "",
    gateway: doc.getAttr(["IBOX"], "Gateway") ?? "",
    dhcp: parseBool(doc.getAttr(["IBOX"], "DHCP"), false),
  };
}

/** Both sides are row-aligned by ID (MAPS pairs them by position; IDs follow the position). */
function readSignals(doc: XmlDocument): MbsKnxSignal[] {
  const internal = doc.find(["InternalProtocol"]);
  const external = doc.find(["ExternalProtocol"]);
  const mbsSignals = internal
    ? childrenOf(internal, "Signals").flatMap((c) => childrenOf(c, "Signal"))
    : [];
  const knxObjects = external ? childrenOf(external, "KNXObject") : [];

  const mbsById = new Map(mbsSignals.map((el) => [attrInt(el, "ID", -1), el]));
  const knxById = new Map(knxObjects.map((el) => [attrInt(el, "ID", -1), el]));
  const ids = [...new Set([...mbsById.keys(), ...knxById.keys()])]
    .filter((id) => id >= 0)
    .sort((a, b) => a - b);

  return ids.map((id) => {
    const m = mbsById.get(id);
    const k = knxById.get(id);
    return {
      id,
      active: parseBool(m ? textOf(m, "isEnabled") : undefined, false),
      description: (m ? textOf(m, "Description") : undefined) ?? "",
      modbus: m ? readMbsKnxEndpoint(m) : defaultMbsEndpoint(),
      knx: k ? readKnxEndpoint(k) : defaultKnxEndpoint(),
      conversions: {
        internal: readHalfConversionRefs(textOf(m, "IdxFilters"), textOf(m, "IdxOperations")),
        external: readHalfConversionRefs(textOf(k, "IdxFilters"), textOf(k, "IdxOperations")),
      },
      virtual: parseBool(m ? attrOfChild(m, "Virtual", "Status") : undefined, false),
      knxVirtual: parseBool(k ? attrOfChild(k, "Virtual", "Status") : undefined, false),
    };
  });
}

/**
 * The Modbus side as MAPS loads it (`MbsObject(XmlNode)`, MbsObject.cs:91-134):
 * `LenBits` 1 becomes 16 bits Unsigned, `LenBits` -1 becomes 16 and
 * `Format` 255 becomes NO_FORMAT (-1). The XML keeps its values until the
 * signal is edited.
 */
export function readMbsKnxEndpoint(el: XmlElement): MbsEndpoint {
  const endpoint = readMbsEndpoint(el);
  if (endpoint.format === 255) endpoint.format = -1;
  if (endpoint.lenBits === 1) {
    endpoint.lenBits = 16;
    endpoint.format = FORMATS.UNSIGNED;
  }
  if (endpoint.lenBits === -1) endpoint.lenBits = 16;
  return endpoint;
}

function readConversions(doc: XmlDocument): Conversion[] {
  const container = doc.find(["IBOX", "Conversions"]);
  if (!container) return [];
  return childrenOf(container, "Conversion").map((el, i) => ({
    id: parseNumber(getAttr(el, "Id"), i),
    description: getAttr(el, "Description") ?? "",
    type: parseNumber(getAttr(el, "Type"), 0),
    params: [
      getAttr(el, "Param1") ?? "",
      getAttr(el, "Param2") ?? "",
      getAttr(el, "Param3") ?? "",
      getAttr(el, "Param4") ?? "",
    ],
  }));
}

// --- helpers ---------------------------------------------------------------

function childrenOf(el: XmlElement, tag: string): XmlElement[] {
  return el.children.filter((c): c is XmlElement => c.kind === "element" && c.tag === tag);
}

function textOf(el: XmlElement | undefined, tag: string): string | undefined {
  if (!el) return undefined;
  const child = el.children.find((c): c is XmlElement => c.kind === "element" && c.tag === tag);
  return child ? getText(child) : undefined;
}

function attrOfChild(el: XmlElement, tag: string, attr: string): string | undefined {
  const child = el.children.find((c): c is XmlElement => c.kind === "element" && c.tag === tag);
  return child ? getAttr(child, attr) : undefined;
}

function attrInt(el: XmlElement, name: string, fallback: number): number {
  return parseNumber(getAttr(el, name), fallback);
}

export function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() === "true";
}

export function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
