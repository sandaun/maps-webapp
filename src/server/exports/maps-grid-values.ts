/**
 * Cell encodings used by MAPS desktop Excel (IntesisMb / IntesisKnx /
 * IntesisConversion). Shared by XLSX export and import so round-trips stay
 * in the desktop vocabulary, not the V9 grid labels.
 */

import { conversionCode } from "@/core/signals/conversion-code";
import type { SignalConversionRefs } from "@/core/signals/conversion-refs";
import type { KnxMbmProject, KnxMbmSignal } from "@/gateway-families/knx-mbm/model";
import type { MeMbsProject, MeMbsSignal } from "@/gateway-families/me-mbs/model";
import { formatDpt, parseDpt } from "@/protocols/knx/dpt";
import { formatGroupAddress, parseGroupAddress } from "@/protocols/knx/address";
import type { MbmConfig, MbmRtuNode } from "@/protocols/modbus/master/nodes";
import { nodeForPort } from "@/protocols/modbus/master";

export const KNX_SIGNAL_HEADERS = [
  "#",
  "Active",
  "Description",
  "DPT",
  "Sending",
  "Listening",
  "U",
  "T",
  "Ri",
  "W",
  "R",
  "Priority",
  "Index",
  "Device",
  "Slave",
  "Base",
  "Read",
  "Write",
  "Data length",
  "Format",
  "Byte order",
  "Address",
  "Bit",
  "Bit length",
  "Deadband",
  // IntesisConversion.GetColumnHeaders: the grid's two conversion columns,
  // which MAPS writes to the Excel like every other grid column.
  "Conv. Id",
  "Conversions",
] as const;

export const ME_SIGNAL_HEADERS = [
  "#",
  "Active",
  "Description",
  "Data length",
  "Format",
  "Address",
  "Bit",
  "R/W",
  "String length",
  "Controller",
  "Group",
  "Unit",
  "Spec",
  "Status",
] as const;

export const CONVERSION_HEADERS = [
  "Idx",
  "Description",
  "Type",
  "Param 1",
  "Param 2",
  "Param 3",
  "Param 4",
] as const;

export const POLL_PLAN_HEADERS = [
  "#",
  "Device",
  "Function",
  "Reg start",
  "Count",
  "Idx first",
  "Idx last",
] as const;

const PRIORITY: Record<number, string> = {
  0: "0: System",
  1: "1: Normal",
  2: "2: Urgent",
  3: "3: Low",
};

const FUNCTIONS: Record<number, string> = {
  [-1]: "-",
  1: "1: Read Coils",
  2: "2: Read Discrete Inputs",
  3: "3: Read Holding Registers",
  4: "4: Read Input Registers",
  5: "5: Write Single Coil",
  6: "6: Write Single Register",
  15: "15: Write Multiple Coils",
  16: "16: Write Multiple Registers",
};

const FORMATS: Record<number, string> = {
  [-1]: "-",
  0: "0: Unsigned",
  1: "1: Signed (C2)",
  2: "2: Signed (C1)",
  3: "3: Float",
  4: "4: BitFields",
  5: "5: String",
};

const BYTE_ORDERS: Record<number, string> = {
  [-1]: "-",
  0: "0: Big Endian",
  1: "1: Little Endian",
  2: "2: Word Inv BE",
  3: "3: Word Inv LE",
};

const READ_WRITE: Record<number, string> = {
  0: "0: Read",
  1: "1: Trigger",
  2: "2: Read / Write",
};

const CONVERSION_TYPES = ["FILTER", "SCALE", "ARITH", "LOGICAL", "LUT_REMAP"] as const;

export function boolCell(value: boolean): string {
  return value ? "True" : "False";
}

export function parseBoolCell(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export function dashNumber(value: number): string {
  return value < 0 ? "-" : String(value);
}

export function flagCell(on: boolean, token: string): string {
  return on ? token : "";
}

export function parseFlagCell(raw: string, token: string): boolean {
  return raw.trim() === token;
}

export function functionCell(fn: number): string {
  return FUNCTIONS[fn] ?? "-";
}

export function formatCell(format: number): string {
  return FORMATS[format] ?? "-";
}

export function byteOrderCell(order: number): string {
  return BYTE_ORDERS[order] ?? "-";
}

export function readWriteCell(rw: number): string {
  return READ_WRITE[rw] ?? "-";
}

export function priorityCell(priority: number): string {
  return PRIORITY[priority] ?? "3: Low";
}

/**
 * Text of the "Conversions" button cell: `text_enabled` ("Enabled") when any
 * half has refs, "-" otherwise (`IntesisProjectKnxMbm_RT.PopulateExtraParameters`).
 */
export function conversionsButtonCell({ internal, external }: SignalConversionRefs): string {
  const lists = [internal.filters, internal.operations, external.filters, external.operations];
  return lists.some((refs) => refs.length > 0) ? "Enabled" : "-";
}

/**
 * Rows of the "Conversions" sheet (`IntesisExcel.CreateExcelWorksheet`): all
 * filters, then all operations, each numbered by its position in its own list
 * — the index signal refs use — not by the XML `Id` attribute.
 */
export function conversionSheetRows(conversions: KnxMbmProject["conversions"]): string[][] {
  const filters = conversions.filter((conv) => conv.type === 0);
  const operations = conversions.filter((conv) => conv.type !== 0);
  return [...filters, ...operations].map((conv) => [
    String(conv.type === 0 ? filters.indexOf(conv) : operations.indexOf(conv)),
    conv.description,
    conversionTypeCell(conv.type),
    ...conv.params,
  ]);
}

export function conversionTypeCell(type: number): string {
  return CONVERSION_TYPES[type] ?? String(type);
}

/** IntesisMb.GetIndexFromString: leading integer before `:`, or -1 for `-`. */
export function indexFromString(raw: string): number {
  const s = raw.trim();
  if (s === "" || s === "-") return -1;
  const head = s.split(":")[0]?.trim() ?? "";
  const n = Number(head);
  return Number.isFinite(n) ? n : -1;
}

export function parseDptCell(raw: string): number | undefined {
  const token = raw.trim().split(/[:\s]/)[0] ?? "";
  return parseDpt(token);
}

export function parsePriorityCell(raw: string): number {
  const n = indexFromString(raw);
  return n >= 0 && n <= 3 ? n : 3;
}

export function rtuPortLabel(nodes: MbmRtuNode[], index: number): string {
  const onlyPortB = nodes.length === 1 && nodes[0]?.physicalPort === 1;
  if (index === 0 && !onlyPortB) return "Port A";
  return "Port B";
}

/** Signal-table Device cell (`MbmObject.GetDeviceIndexValue`). */
export function deviceCell(mbm: MbmConfig, signal: KnxMbmSignal): string {
  const port = signal.modbus.port;
  if (port < 0) return "-";
  const ref = nodeForPort(mbm, port);
  if (!ref) return "-";
  if (ref.kind === "rtu") {
    const nodeLabel = `RTU // ${rtuPortLabel(mbm.rtuNodes, port)}`;
    if (signal.modbus.deviceIndex < 0 && !signal.modbus.isBroadcast) return nodeLabel;
    const device = signal.modbus.isBroadcast
      ? "Broadcast"
      : (ref.node.devices.find((d) => d.index === signal.modbus.deviceIndex)?.name ?? "-");
    return `${nodeLabel} // ${device}`;
  }
  const tcp = mbm.tcpNodes[port - mbm.rtuNodes.length];
  const nodeLabel = `TCP // ${tcp?.description || `${tcp?.ip ?? ""}:${tcp?.port ?? ""}`}`;
  if (signal.modbus.deviceIndex < 0 && !signal.modbus.isBroadcast) return nodeLabel;
  const device = signal.modbus.isBroadcast
    ? "Broadcast"
    : (ref.node.devices.find((d) => d.index === signal.modbus.deviceIndex)?.name ?? "-");
  return `${nodeLabel} // ${device}`;
}

export function parseDeviceCell(
  mbm: MbmConfig,
  raw: string,
): { port: number; deviceIndex: number; isBroadcast: boolean } {
  const value = raw.trim();
  if (value === "" || value === "-") return { port: -1, deviceIndex: -1, isBroadcast: false };
  const parts = value.split(" // ").map((p) => p.trim());
  const kind = parts[0];
  const portName = parts[1] ?? "";
  const deviceName = parts[2] ?? "";
  let port = -1;
  if (kind === "RTU") {
    port = mbm.rtuNodes.findIndex((_, i) => rtuPortLabel(mbm.rtuNodes, i) === portName);
  } else if (kind === "TCP") {
    const tcp = mbm.tcpNodes.findIndex(
      (node) => node.description === portName || `${node.ip}:${node.port}` === portName,
    );
    port = tcp >= 0 ? tcp + mbm.rtuNodes.length : -1;
  }
  if (port < 0) return { port: -1, deviceIndex: -1, isBroadcast: false };
  if (deviceName === "Broadcast") return { port, deviceIndex: -1, isBroadcast: true };
  if (deviceName === "") return { port, deviceIndex: -1, isBroadcast: false };
  const ref = nodeForPort(mbm, port);
  const deviceIndex = ref?.node.devices.findIndex((d) => d.name === deviceName) ?? -1;
  return { port, deviceIndex: deviceIndex >= 0 ? deviceIndex : -1, isBroadcast: false };
}

export function knxSignalRow(project: KnxMbmProject, signal: KnxMbmSignal): string[] {
  const { knx, modbus } = signal;
  const ref = nodeForPort(project.mbm, modbus.port);
  const device = ref?.node.devices.find((d) => d.index === modbus.deviceIndex);
  const sending = knx.groupAddress > 0 ? formatGroupAddress(knx.groupAddress) : "";
  const listening = knx.additionalAddresses.map(formatGroupAddress).join(",");
  return [
    String(signal.id + 1),
    boolCell(signal.active),
    signal.description,
    formatDpt(knx.dpt),
    sending,
    listening,
    flagCell(knx.flags.u, "U"),
    flagCell(knx.flags.t, "T"),
    flagCell(knx.flags.ri, "Ri"),
    flagCell(knx.flags.w, "W"),
    flagCell(knx.flags.r, "R"),
    priorityCell(knx.priority),
    String(signal.id + 1),
    deviceCell(project.mbm, signal),
    device ? String(device.slave) : "-",
    device ? (device.baseRegister === 1 ? "1-based" : "0-based") : "-",
    functionCell(modbus.readFunc),
    functionCell(modbus.writeFunc),
    signal.virtual ? "-" : dashNumber(modbus.lenBits),
    formatCell(modbus.format),
    byteOrderCell(modbus.byteOrder),
    signal.virtual ? "-" : dashNumber(modbus.address),
    dashNumber(modbus.bit),
    dashNumber(modbus.numOfBits),
    signal.virtual ? "-" : String(project.mbm.deadband),
    conversionCode(signal.conversions),
    conversionsButtonCell(signal.conversions),
  ];
}

export function meSignalRow(project: MeMbsProject, signal: MeMbsSignal): string[] {
  return [
    String(signal.id + 1),
    boolCell(signal.active),
    signal.description,
    dashNumber(signal.modbus.lenBits),
    formatCell(signal.modbus.format),
    dashNumber(signal.modbus.address),
    dashNumber(signal.modbus.bit),
    readWriteCell(signal.modbus.readWrite),
    dashNumber(signal.modbus.stringLength),
    String(signal.me.g50Index),
    String(signal.me.groupIndex),
    String(signal.me.unitId),
    String(signal.me.signalSpecIndex),
    boolCell(signal.me.isStatus),
  ];
}

export function parseListening(raw: string): number[] {
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((part) => parseGroupAddress(part.trim()))
    .filter((n): n is number => n !== undefined && n > 0);
}

export { formatDpt, formatGroupAddress, parseGroupAddress };
