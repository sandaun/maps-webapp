import {
  element,
  getAttr,
  getText,
  setAttr,
  setText,
  text,
  type XmlElement,
} from "@/core/project-format";
import { defaultMbsConfig, type MbsConfig, type MbsSlave } from "./config";
import type { MbsEndpoint } from "./signal";

/**
 * Reading and patching of the Modbus Slave protocol element
 * (`InternalMbs.GetXMLProtocol`, IntesisBoxMAPS.Protocols.MB.Internal/InternalMbs.cs:1033-1091)
 * and its `<Signal>` rows (`MbsObject.ToXml`, IntesisBoxMAPS.Protocols.MB/MbsObject.cs:136-209).
 * The family passes the protocol element (`InternalProtocol`).
 */

export function readMbsConfig(internal: XmlElement | undefined): MbsConfig {
  if (!internal) return defaultMbsConfig();

  const config = defaultMbsConfig();
  config.media = parseNumber(textOf(internal, "Media"), 2) as MbsConfig["media"];
  config.byteOrder = parseNumber(textOf(internal, "ByteOrder"), 0);
  config.updateCOV = parseBool(textOf(internal, "UpdateCOV"), true);
  config.addressMode = parseNumber(textOf(internal, "AddressMode"), 0) as MbsConfig["addressMode"];
  config.tempSetpoint = parseNumber(textOf(internal, "TempSetpoint"), 0) as MbsConfig["tempSetpoint"];
  config.formatExtra = parseNumber(textOf(internal, "FormatExtra"), 0);
  config.commErrorTout = parseNumber(textOf(internal, "CommErrorTout"), 180);
  config.registerBase = parseNumber(textOf(internal, "RegisterBase"), 0) as 0 | 1;
  config.slaveAddressMode = parseNumber(textOf(internal, "SlaveAddressMode"), 0) as MbsConfig["slaveAddressMode"];

  const rtu = childElOpt(internal, "RTUConfig");
  if (rtu) {
    config.rtu = {
      connectionType: parseNumber(getAttr(rtu, "ConnectionType"), 1),
      baudrate: parseNumber(getAttr(rtu, "Baudrate"), 9600),
      dataBits: parseNumber(getAttr(rtu, "DataBits"), 8),
      parity: parseNumber(getAttr(rtu, "Parity"), 0) as 0 | 1 | 2,
      stopBits: parseNumber(getAttr(rtu, "StopBits"), 1) as 1 | 2,
      slaveNumber: parseNumber(getAttr(rtu, "SlaveNumber"), 1),
    };
  }
  const tcp = childElOpt(internal, "TCPConfig");
  if (tcp) {
    config.tcp = {
      port: parseNumber(getAttr(tcp, "Port"), 502),
      keepAlive: parseNumber(getAttr(tcp, "KeepAlive"), 10),
    };
  }
  const sensor = childElOpt(internal, "TemperatureSensor");
  config.temperatureSensorEnabled = sensor ? parseBool(getAttr(sensor, "Enabled"), false) : false;

  config.slaves = childrenOf(internal, "MBSlavesArray")
    .flatMap((c) => childrenOf(c, "MBSlave"))
    .map(readSlave);
  return config;
}

function readSlave(el: XmlElement): MbsSlave {
  return {
    address: parseNumber(getAttr(el, "Address"), 0),
    description: getAttr(el, "Description") ?? "",
  };
}

/** Modbus side of one `<Signal>`. */
export function readMbsEndpoint(el: XmlElement): MbsEndpoint {
  return {
    address: parseNumber(textOf(el, "Address"), 0),
    bit: parseNumber(textOf(el, "Bit"), 255),
    lenBits: parseNumber(textOf(el, "LenBits"), 16),
    format: parseNumber(textOf(el, "Format"), 0),
    readWrite: parseNumber(textOf(el, "ReadWrite"), 2) as MbsEndpoint["readWrite"],
    stringLength: parseNumber(textOf(el, "StringLength"), -1),
    slaveIndex: parseNumber(textOf(el, "SlaveIndex"), -1),
  };
}

export type MbsConfigPatch = Partial<
  Pick<
    MbsConfig,
    "media" | "byteOrder" | "updateCOV" | "addressMode" | "slaveAddressMode" | "commErrorTout" | "registerBase"
  >
>;

export function patchMbsConfig(internal: XmlElement, patch: MbsConfigPatch): void {
  if (patch.media !== undefined) setText(childEl(internal, "Media"), String(patch.media));
  if (patch.byteOrder !== undefined) setText(childEl(internal, "ByteOrder"), String(patch.byteOrder));
  if (patch.updateCOV !== undefined) setText(childEl(internal, "UpdateCOV"), boolText(patch.updateCOV));
  if (patch.addressMode !== undefined) setText(childEl(internal, "AddressMode"), String(patch.addressMode));
  if (patch.slaveAddressMode !== undefined) {
    setText(childEl(internal, "SlaveAddressMode"), String(patch.slaveAddressMode));
  }
  if (patch.commErrorTout !== undefined) setText(childEl(internal, "CommErrorTout"), String(patch.commErrorTout));
  if (patch.registerBase !== undefined) setText(childEl(internal, "RegisterBase"), String(patch.registerBase));
}

export function patchMbsRtuConfig(internal: XmlElement, patch: Partial<MbsConfig["rtu"]>): void {
  const rtu = childEl(internal, "RTUConfig");
  const map: Record<string, keyof MbsConfig["rtu"]> = {
    ConnectionType: "connectionType",
    Baudrate: "baudrate",
    DataBits: "dataBits",
    Parity: "parity",
    StopBits: "stopBits",
    SlaveNumber: "slaveNumber",
  };
  for (const [attr, key] of Object.entries(map)) {
    const value = patch[key];
    if (value !== undefined) setAttr(rtu, attr, String(value));
  }
}

export function patchMbsTcpConfig(internal: XmlElement, patch: Partial<MbsConfig["tcp"]>): void {
  const tcp = childEl(internal, "TCPConfig");
  if (patch.port !== undefined) setAttr(tcp, "Port", String(patch.port));
  if (patch.keepAlive !== undefined) setAttr(tcp, "KeepAlive", String(patch.keepAlive));
}

/** Apply a partial edit to the Modbus side of one `<Signal>`. */
export function patchMbsEndpoint(signal: XmlElement, patch: Partial<MbsEndpoint>): void {
  setNumberText(signal, "Address", patch.address);
  setNumberText(signal, "Bit", patch.bit);
  setNumberText(signal, "LenBits", patch.lenBits);
  setNumberText(signal, "Format", patch.format);
  setNumberText(signal, "ReadWrite", patch.readWrite);
  setNumberText(signal, "StringLength", patch.stringLength);
  setNumberText(signal, "SlaveIndex", patch.slaveIndex);
}

/**
 * A new `<Signal>` in the shape `MbsObject.ToXml` writes, with the defaults
 * of a new row (16 bits, unsigned, bit 255, address 0, read/write). Whether a
 * new row starts enabled is the family's call.
 */
export function buildMbsSignal(id: number, options: { enabled: boolean }): XmlElement {
  return element("Signal", [["ID", String(id)]], [
    element("isEnabled", [], [text(boolText(options.enabled))]),
    element("idxConfig", [], [text(String(id))]),
    element("idxExternal", [], [text(String(id))]),
    pairElement("IdxOperations"),
    pairElement("IdxFilters"),
    element("Description", [], [text("")]),
    element("LenBits", [], [text("16")]),
    element("Format", [], [text("0")]),
    element("Bit", [], [text("255")]),
    element("Address", [], [text("0")]),
    element("ReadWrite", [], [text("2")]),
    element("StringLength", [], [text("-1")]),
    element("SlaveIndex", [], [text("-1")]),
    element("GatewayIndex", [], [text("-1")]),
    element("Virtual", [
      ["Status", "False"],
      ["Fixed", "False"],
      ["General", "False"],
    ]),
    element("ProtocolIndex", [], [text("-1")]),
  ]);
}

// --- helpers ---------------------------------------------------------------

function childrenOf(el: XmlElement, tag: string): XmlElement[] {
  return el.children.filter((c): c is XmlElement => c.kind === "element" && c.tag === tag);
}

function childElOpt(el: XmlElement, tag: string): XmlElement | undefined {
  return el.children.find((c): c is XmlElement => c.kind === "element" && c.tag === tag);
}

function childEl(parent: XmlElement, tag: string): XmlElement {
  const child = childElOpt(parent, tag);
  if (!child) throw new Error(`<${parent.tag}> has no <${tag}> child`);
  return child;
}

function textOf(el: XmlElement | undefined, tag: string): string | undefined {
  if (!el) return undefined;
  const child = childElOpt(el, tag);
  return child ? getText(child) : undefined;
}

function setNumberText(parent: XmlElement, tag: string, value: number | undefined): void {
  if (value !== undefined) setText(childEl(parent, tag), String(value));
}

/** Elements written with empty-pair form (`<IdxOperations></IdxOperations>`). */
function pairElement(tag: string): XmlElement {
  return element(tag, [], [text("")]);
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() === "true";
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** `.NET` bool format. */
function boolText(value: boolean): string {
  return value ? "True" : "False";
}
