/**
 * Modbus Slave protocol side of the XBL pipeline: parses the `InternalMbs`
 * settings and `<Signal>` list into the structures the MBS writer
 * (`./nodes.ts`) consumes. Shared by every family whose BMS side is Modbus
 * Slave (ME–MBS, MBS–KNX).
 *
 * Provenance: `InternalMbs.ParseProtocolXML`
 * (temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS.Protocols.MB.Internal/InternalMbs.cs:900-956)
 * and `MbsObject(XmlNode)` (IntesisBoxMAPS.Protocols.MB/MbsObject.cs:92-132).
 *
 * Which signals are enabled, their order and their external/conversion ids
 * are decided by each family's `PreXBLActions` port — not here.
 */

import { getAttr, getText, type XmlElement } from "@/core/project-format";
import { parseConversionIds, type ConversionIdRef } from "@/core/xbl";

/** Port of `MbsObject` (MbsObject.cs:17-55) limited to the XBL-relevant fields. */
export interface MbsSignalParsed {
  configId: number;
  isEnabled: boolean;
  lenBits: number;
  format: number;
  bit: number;
  address: number;
  readWrite: number;
  stringLength: number;
  slaveIndex: number;
  isVirtual: boolean;
  filterIds: ConversionIdRef[];
  operationIds: ConversionIdRef[];
}

/** Port of `MBSlave` (MBSlave.cs). */
export interface MbSlaveParsed {
  address: number;
}

export interface EnabledMbsSignal extends MbsSignalParsed {
  externalId: number;
  conversionId: number;
}

export interface EnabledMbSlave extends MbSlaveParsed {
  indexFirst: number;
  indexLast: number;
}

/** Input of the MBS writer (`buildMbsNode`). */
export interface MbsXblNode {
  media: number;
  byteOrder: number;
  updateCOV: boolean;
  commErrorTout: number;
  registerBase: number;
  rtu: {
    connectionType: number;
    baudrate: number;
    dataBits: number;
    parity: number;
    stopBits: number;
    slaveNumber: number;
  };
  tcp: { port: number; keepAlive: number };
  slaveAddressMode: number;
  slaves: EnabledMbSlave[];
  signals: EnabledMbsSignal[];
}

/** Port of InternalMbs.ParseProtocolXML (InternalMbs.cs:900-956). */
export function parseMbsXblSettings(
  protocol: XmlElement,
): Omit<MbsXblNode, "slaves" | "signals"> & { slaves: MbSlaveParsed[] } {
  // Media: C# int.TryParse, falling back to "True"→1/else 0.
  const mediaText = textOf(protocol, "Media") ?? "";
  const mediaNum = Number(mediaText);
  const media = Number.isInteger(mediaNum) ? mediaNum : mediaText === "True" ? 1 : 0;
  const rtuEl = child(protocol, "RTUConfig");
  const tcpEl = child(protocol, "TCPConfig");
  return {
    media,
    byteOrder: parseIntText(protocol, "ByteOrder", 0),
    updateCOV: parseBoolText(textOf(protocol, "UpdateCOV"), false),
    commErrorTout: parseIntText(protocol, "CommErrorTout", 180),
    registerBase: parseIntText(protocol, "RegisterBase", 0),
    rtu: {
      connectionType: parseNumberAttr(rtuEl, "ConnectionType", 0),
      baudrate: parseNumberAttr(rtuEl, "Baudrate", 9600),
      dataBits: parseNumberAttr(rtuEl, "DataBits", 8),
      parity: parseNumberAttr(rtuEl, "Parity", 0),
      stopBits: parseNumberAttr(rtuEl, "StopBits", 1),
      slaveNumber: parseNumberAttr(rtuEl, "SlaveNumber", 1),
    },
    tcp: {
      port: parseNumberAttr(tcpEl, "Port", 502),
      keepAlive: parseNumberAttr(tcpEl, "KeepAlive", 10),
    },
    slaveAddressMode: parseIntText(protocol, "SlaveAddressMode", 0),
    slaves: childrenOf(protocol, "MBSlavesArray")
      .flatMap((c) => childrenOf(c, "MBSlave"))
      .map((el) => ({ address: parseNumberAttr(el, "Address", 0) })),
  };
}

/** Port of MbsObject(XmlNode) (MbsObject.cs:92-132). */
export function parseMbsSignals(protocol: XmlElement): MbsSignalParsed[] {
  const signals = childrenOf(protocol, "Signals").flatMap((c) => childrenOf(c, "Signal"));
  return signals.map((el) => {
    const virtEl = child(el, "Virtual");
    let lenBits = parseIntText(el, "LenBits", 0);
    // GetFormatFromIndex: 255 → -1 (IntesisMb.cs:912-919).
    let format = parseIntText(el, "Format", 0);
    if (format === 255) format = -1;
    if (lenBits === 1) {
      lenBits = 16;
      format = 0; // UNSIGNED
    }
    return {
      configId: parseIntText(el, "idxConfig", 0),
      isEnabled: parseBoolText(textOf(el, "isEnabled"), false),
      lenBits,
      format,
      bit: parseIntText(el, "Bit", 0),
      address: parseIntText(el, "Address", 0),
      readWrite: parseIntText(el, "ReadWrite", 0),
      stringLength: parseIntText(el, "StringLength", -1),
      slaveIndex: parseIntText(el, "SlaveIndex", -1),
      isVirtual: parseBoolAttr(virtEl, "Status", false),
      filterIds: parseConversionIds(textOf(el, "IdxFilters")),
      operationIds: parseConversionIds(textOf(el, "IdxOperations")),
    };
  });
}

// --- XML helpers --------------------------------------------------------------

function childrenOf(el: XmlElement, tag: string): XmlElement[] {
  return el.children.filter((c): c is XmlElement => c.kind === "element" && c.tag === tag);
}

function child(el: XmlElement, tag: string): XmlElement | undefined {
  return el.children.find((c): c is XmlElement => c.kind === "element" && c.tag === tag);
}

function textOf(el: XmlElement | undefined, tag: string): string | undefined {
  if (!el) return undefined;
  const c = child(el, tag);
  return c ? getText(c) : undefined;
}

function parseIntText(el: XmlElement, tag: string, fallback: number): number {
  const v = textOf(el, tag);
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function parseBoolText(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() === "true";
}

function parseBoolAttr(el: XmlElement | undefined, name: string, fallback: boolean): boolean {
  return parseBoolText(el ? getAttr(el, name) : undefined, fallback);
}

function parseNumberAttr(el: XmlElement | undefined, name: string, fallback: number): number {
  const v = el ? getAttr(el, name) : undefined;
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
