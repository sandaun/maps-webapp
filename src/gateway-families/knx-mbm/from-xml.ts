import {
  getAttr,
  getText,
  XmlDocument,
  type XmlElement,
} from "@/core/project-format";
import { DEFAULT_FLAGS, type KnxFlags } from "@/protocols/knx";
import {
  defaultMbmConfig,
  type MbmConfig,
  type MbmDevice,
  type MbmRtuNode,
  type MbmTcpNode,
} from "@/protocols/modbus/master";
import type {
  Conversion,
  GatewayInfo,
  KnxMbmProject,
  KnxMbmSignal,
} from "./model";
import { isKnxMbmProject } from "./detect";

/** Parse an .ibmaps document into the KNX–MBM project model. */
export function projectFromXml(doc: XmlDocument): KnxMbmProject {
  if (!isKnxMbmProject(doc)) {
    throw new Error("Not a KNX ↔ Modbus Master project");
  }
  return {
    name: doc.getAttr([], "ProjectName") ?? "",
    description: doc.getAttr([], "ProjectDescription") ?? "",
    gateway: readGateway(doc),
    knx: readKnxConfig(doc),
    mbm: readMbmConfig(doc),
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

function readKnxConfig(doc: XmlDocument): KnxMbmProject["knx"] {
  const internal = doc.find(["InternalProtocol"]);
  const keys = doc.find(["InternalProtocol", "Keys"]);
  return {
    physicalAddress: parseIntText(internal, "IndAddress", 65535),
    extendedAddresses: parseBool(textOf(internal, "UseExtendedAddresses"), false),
    keys: [
      keys ? (getAttr(keys, "Key1") ?? "0001") : "0001",
      keys ? (getAttr(keys, "Key2") ?? "0002") : "0002",
      keys ? (getAttr(keys, "Key3") ?? "0003") : "0003",
    ],
  };
}

function readMbmConfig(doc: XmlDocument): MbmConfig {
  const external = doc.find(["ExternalProtocol"]);
  if (!external) return defaultMbmConfig();

  const config = defaultMbmConfig();
  config.enabled = parseBool(textOf(external, "Enabled"), true);
  config.media = parseNumber(textOf(external, "Media"), 0) as MbmConfig["media"];
  config.deadband = parseNumber(textOf(external, "Deadband"), 0);

  const pollRecords = external.children.find(
    (c): c is XmlElement => c.kind === "element" && c.tag === "PollRecords",
  );
  if (pollRecords) {
    config.pollRecords = {
      enabled: parseBool(getAttr(pollRecords, "Enabled"), false),
      useMissingReg: parseBool(getAttr(pollRecords, "UseMissingReg"), false),
      maxRegisters: parseNumber(getAttr(pollRecords, "MaxRegisters"), 100),
    };
  }

  config.rtuNodes = childrenOf(external, "RtuNodes")
    .flatMap((c) => childrenOf(c, "RtuNode"))
    .map(readRtuNode);
  config.tcpNodes = childrenOf(external, "TCPNodes")
    .flatMap((c) => childrenOf(c, "TCPNode"))
    .map(readTcpNode);
  return config;
}

function readRtuNode(el: XmlElement): MbmRtuNode {
  return {
    baudrate: parseNumber(getAttr(el, "Baudrate"), 9600),
    dataBits: parseNumber(getAttr(el, "DataBits"), 8),
    parity: parseNumber(getAttr(el, "Parity"), 0) as 0 | 1 | 2,
    stopBits: parseNumber(getAttr(el, "StopBits"), 1) as 1 | 2,
    timeInterFrame: parseNumber(getAttr(el, "TimeInterFrame"), 60),
    physicalPort: parseNumber(getAttr(el, "PhysicalPort"), 0) as 0 | 1,
    pollAfterWrite: parseBool(getAttr(el, "PollAfterWrite"), false),
    pollReadSignal: parseBool(getAttr(el, "PollReadSignal"), false),
    devices: childrenOf(el, "Device").map(readDevice),
  };
}

function readTcpNode(el: XmlElement): MbmTcpNode {
  return {
    nodeIndex: parseNumber(getAttr(el, "NodeIndex"), 0),
    ip: getAttr(el, "IP") ?? "",
    port: parseNumber(getAttr(el, "Port"), 502),
    description: getAttr(el, "Description") ?? "",
    timeInterFrame: parseNumber(getAttr(el, "TimeInterFrame"), 10),
    retryTimeout: parseNumber(getAttr(el, "RetryTimeout"), 5000),
    connTimeout: parseNumber(getAttr(el, "ConnTimeout"), 10000),
    rxTimeout: parseNumber(getAttr(el, "RxTimeout"), 5000),
    timeInterFrameSlaveChange: parseNumber(getAttr(el, "TimeInterFrameNode"), 10),
    devices: childrenOf(el, "Device").map(readDevice),
  };
}

function readDevice(el: XmlElement): MbmDevice {
  return {
    index: parseNumber(getAttr(el, "Index"), 0),
    name: getAttr(el, "Name") ?? "",
    manufacturer: getAttr(el, "Manufacturer") ?? "",
    slave: parseNumber(getAttr(el, "SlaveNum"), 1),
    baseRegister: parseNumber(getAttr(el, "BaseRegister"), 0) as 0 | 1,
    timeout: parseNumber(getAttr(el, "Timeout"), 1000),
    enabled: parseBool(getAttr(el, "Enabled"), true),
  };
}

function readSignals(doc: XmlDocument): KnxMbmSignal[] {
  const internal = doc.find(["InternalProtocol"]);
  const external = doc.find(["ExternalProtocol"]);
  const knxObjects = internal ? childrenOf(internal, "KNXObject") : [];
  const mbmSignals = external
    ? childrenOf(external, "Signals").flatMap((c) => childrenOf(c, "Signal"))
    : [];

  const knxById = new Map(knxObjects.map((el) => [attrInt(el, "ID", -1), el]));
  const mbmById = new Map(mbmSignals.map((el) => [attrInt(el, "ID", -1), el]));
  const ids = [...new Set([...knxById.keys(), ...mbmById.keys()])]
    .filter((id) => id >= 0)
    .sort((a, b) => a - b);

  return ids.map((id) => {
    const k = knxById.get(id);
    const m = mbmById.get(id);
    return {
      id,
      active: parseBool(k ? textOf(k, "Active") : undefined, true),
      description: (k ? textOf(k, "Description") : undefined) ?? "",
      knx: k ? readKnxEndpoint(k) : defaultKnxEndpoint(),
      modbus: m ? readMbmEndpoint(m) : defaultMbmEndpoint(),
      idxOperations: (k ? textOf(k, "IdxOperations") : undefined) ?? (m ? textOf(m, "IdxOperations") : "") ?? "",
      idxFilters: (k ? textOf(k, "IdxFilters") : undefined) ?? (m ? textOf(m, "IdxFilters") : "") ?? "",
      virtual: parseBool(k ? attrOfChild(k, "Virtual", "Status") : undefined, false),
    };
  });
}

function readKnxEndpoint(el: XmlElement): KnxMbmSignal["knx"] {
  const flagsEl = el.children.find(
    (c): c is XmlElement => c.kind === "element" && c.tag === "Flags",
  );
  const flags: KnxFlags = flagsEl
    ? {
        u: parseBool(getAttr(flagsEl, "U"), false),
        t: parseBool(getAttr(flagsEl, "T"), false),
        ri: parseBool(getAttr(flagsEl, "Ri"), false),
        w: parseBool(getAttr(flagsEl, "W"), false),
        r: parseBool(getAttr(flagsEl, "R"), false),
      }
    : { ...DEFAULT_FLAGS };

  const dptEl = el.children.find((c): c is XmlElement => c.kind === "element" && c.tag === "DPT");
  const sending = el.children.find(
    (c): c is XmlElement => c.kind === "element" && c.tag === "SendingAddress",
  );
  const listening = el.children.find(
    (c): c is XmlElement => c.kind === "element" && c.tag === "ListeningAddresses",
  );

  return {
    dpt: dptEl ? parseNumber(getAttr(dptEl, "Value"), 0) : 0,
    groupAddress: sending ? parseNumber(getAttr(sending, "Value"), 0) : 0,
    additionalAddresses: listening
      ? childrenOf(listening, "Address").map((a) => parseNumber(getAttr(a, "Value"), 0))
      : [],
    flags,
    priority: parseNumber(textOf(el, "Priority"), 3),
  };
}

function readMbmEndpoint(el: XmlElement): KnxMbmSignal["modbus"] {
  const port = parseNumber(textOf(el, "Port"), -1);
  return {
    port: port === 255 ? -1 : port,
    deviceIndex: parseNumber(textOf(el, "DeviceIndex"), -1),
    isBroadcast: parseBool(textOf(el, "IsBroadcast"), false),
    readFunc: normalizeMinusOne(textOf(el, "ReadFunc")),
    writeFunc: normalizeMinusOne(textOf(el, "WriteFunc")),
    lenBits: parseNumber(textOf(el, "LenBits"), -1),
    format: normalizeMinusOne(textOf(el, "Format")),
    byteOrder: parseNumber(textOf(el, "ByteOrder"), -1),
    bit: parseNumber(textOf(el, "Bit"), -1),
    numOfBits: parseNumber(textOf(el, "NumOfBits"), -1),
    address: parseNumber(textOf(el, "Address"), 0),
  };
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

function defaultKnxEndpoint(): KnxMbmSignal["knx"] {
  return { dpt: 0, groupAddress: 0, additionalAddresses: [], flags: { ...DEFAULT_FLAGS }, priority: 3 };
}

function defaultMbmEndpoint(): KnxMbmSignal["modbus"] {
  return {
    port: -1,
    deviceIndex: -1,
    isBroadcast: false,
    readFunc: -1,
    writeFunc: -1,
    lenBits: -1,
    format: -1,
    byteOrder: -1,
    bit: -1,
    numOfBits: -1,
    address: 0,
  };
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

/** MAPS writes -1 as 255 in some ushort fields. */
function normalizeMinusOne(value: string | undefined): number {
  const n = parseNumber(value, -1);
  return n === 255 ? -1 : n;
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

function parseIntText(el: XmlElement | undefined, tag: string, fallback: number): number {
  return parseNumber(el ? textOf(el, tag) : undefined, fallback);
}
