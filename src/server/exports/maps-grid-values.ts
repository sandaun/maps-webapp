/**
 * Cell encodings used by MAPS desktop Excel (IntesisMb / IntesisKnx /
 * IntesisConversion). Shared by XLSX export and import so round-trips stay
 * in the desktop vocabulary, not the V9 grid labels.
 */

import { conversionCode } from "@/core/signals/conversion-code";
import type { SignalConversionRefs } from "@/core/signals/conversion-refs";
import type { KnxMbmProject, KnxMbmSignal } from "@/gateway-families/knx-mbm/model";
import type { MeMbsProject, MeMbsSignal } from "@/gateway-families/me-mbs/model";
import type { MbsKnxSignal } from "@/gateway-families/mbs-knx/model";
import { COMMON_DPT_OPTIONS, decodeDpt, formatDpt, parseDpt } from "@/protocols/knx/dpt";
import { formatGroupAddress, formatGroupAddressAtLevel, formatListeningAddresses, groupAddressLevelOf, parseGroupAddress } from "@/protocols/knx/address";
import type { MbmConfig, MbmRtuNode } from "@/protocols/modbus/master/nodes";
import { nodeForPort } from "@/protocols/modbus/master";
import { FORMATS as MB_FORMATS } from "@/protocols/modbus/slave";

/**
 * KNX–MBM columns as MAPS writes them: the grid's `HeaderText`
 * (`IntesisExcel.WriteColumnHeaders`) — the KNX side (`InternalKnx.GetInternalCols`,
 * 12 columns), the Modbus Master side (`ExternalMbm.GetExternalCols`, 13 with
 * the deadband, which KNX–MBM always has) and the two conversion columns.
 * Hidden grid columns ("Priority", the Modbus "#", "Deadband", the conversions)
 * are exported too.
 */
export const KNX_SIGNAL_HEADERS = [
  "#",
  "Active",
  "Description",
  "DPT",
  "Group Address",
  "Additional Addresses",
  "U",
  "T",
  "Ri",
  "W",
  "R",
  "Priority",
  "#",
  "Device",
  "# Slave",
  "Base",
  "Read Func",
  "Write Func",
  "Data Length",
  "Format",
  "ByteOrder",
  "Address",
  "Bit",
  "# Bits",
  "Deadband",
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

/**
 * MBS–KNX columns as MAPS writes them: the grid's `HeaderText`
 * (`IntesisExcel.WriteColumnHeaders`) — the Modbus Slave side
 * (`InternalMbs.GetInternalCols`, 9 columns), the KNX side
 * (`ExternalKnx.GetExternalCols`, 10 columns, with its own "#") and the two
 * conversion columns (`IntesisConversion.GetColumnHeaders`).
 */
export const MBS_KNX_SIGNAL_HEADERS = [
  "#",
  "Active",
  "Description",
  "Data Length",
  "Format",
  "Address",
  "Bit",
  "Read / Write",
  "String Length",
  "#",
  "DPT",
  "Group Address",
  "Additional Addresses",
  "U",
  "T",
  "Ri",
  "W",
  "R",
  "Priority",
  "Conv. Id",
  "Conversions",
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

/**
 * RTU node name in a Device cell (`MbmRtuNode.GetNodeDescription`): with a
 * KNX internal protocol every node is "Port B" (`IsOnlyPortB`, ExternalMbm.cs:686, 752).
 */
export const RTU_NODE_LABEL = "Port B";

/** The node label earlier MAPS Web versions wrote ("Port A" for the first node), still read on import. */
function earlierRtuPortLabel(nodes: MbmRtuNode[], index: number): string {
  const onlyPortB = nodes.length === 1 && nodes[0]?.physicalPort === 1;
  return index === 0 && !onlyPortB ? "Port A" : "Port B";
}

/** The signal's device: MAPS finds it by position in its node (`ContainedDevices[DeviceIndex]`). */
function deviceOf(mbm: MbmConfig, signal: KnxMbmSignal) {
  const { port, deviceIndex } = signal.modbus;
  if (port < 0 || deviceIndex < 0) return undefined;
  return nodeForPort(mbm, port)?.node.devices[deviceIndex];
}

/** Signal-table Device cell (`MbmObject.GetDeviceIndexValue`, MbmObject.cs:400-422). */
export function deviceCell(mbm: MbmConfig, signal: KnxMbmSignal): string {
  const { port, deviceIndex, isBroadcast } = signal.modbus;
  if (port < 0) return "-";
  const ref = nodeForPort(mbm, port);
  if (!ref) return "-";
  const node =
    ref.kind === "rtu" ? `RTU // ${RTU_NODE_LABEL}` : `TCP // ${mbm.tcpNodes[port - mbm.rtuNodes.length]?.description ?? ""}`;
  if (deviceIndex < 0 && !isBroadcast) return node;
  return `${node} // ${isBroadcast ? "Broadcast" : (deviceOf(mbm, signal)?.name ?? "")}`;
}

/**
 * `ExternalMbm.GetPortFromDeviceName` + the device lookup by name
 * (ExternalMbm.cs:1814-1843, 2232-2257). `found` is false when the cell names
 * a node or device the project does not have (MAPS: ERROR_COMPATIBILITY).
 */
export function parseDeviceCell(
  mbm: MbmConfig,
  raw: string,
): { port: number; deviceIndex: number; isBroadcast: boolean; found: boolean } {
  const value = raw.trim();
  const none = { port: -1, deviceIndex: -1, isBroadcast: false };
  if (value === "" || value === "-") return { ...none, found: true };
  const parts = value.split(" // ").map((p) => p.trim());
  const kind = parts[0];
  const portName = parts[1] ?? "";
  const deviceName = parts[2] ?? "";
  let port = -1;
  if (kind === "RTU") {
    port =
      portName === RTU_NODE_LABEL && mbm.rtuNodes.length > 0
        ? 0
        : mbm.rtuNodes.findIndex((_, i) => earlierRtuPortLabel(mbm.rtuNodes, i) === portName);
  } else if (kind === "TCP") {
    const tcp = mbm.tcpNodes.findIndex(
      (node) => node.description === portName || `${node.ip}:${node.port}` === portName,
    );
    port = tcp >= 0 ? tcp + mbm.rtuNodes.length : -1;
  }
  if (port < 0) return { ...none, found: false };
  if (deviceName === "Broadcast") return { port, deviceIndex: -1, isBroadcast: true, found: true };
  if (deviceName === "") return { port, deviceIndex: -1, isBroadcast: false, found: kind === "RTU" };
  const deviceIndex = nodeForPort(mbm, port)?.node.devices.findIndex((d) => d.name === deviceName) ?? -1;
  return { port, deviceIndex, isBroadcast: false, found: deviceIndex >= 0 };
}

/** KNX–MBM DPT cell: the MAPS combo text, or "1.x: (1-bit)" when the combo has none (KnxComObject.cs:366-374). */
function knxMbmDptCell(dpt: number): string {
  return DPT_LABELS.get(dpt) ?? "1.x: (1-bit)";
}

/**
 * The flag cells as the grid shows them: the letter, or two spaces when off
 * (`KnxComObject.GenerateRow`), then `CheckThisRowSpecific`
 * (IntesisProjectKnxMbm_RT.cs:588-639): a virtual row shows U, Ri and W as one
 * space; any other row blanks the flags its Modbus functions cannot use
 * (`UpdateFlagsValueFromRWObject`, IntesisKnx.cs:870-903).
 */
function knxMbmFlagCells(signal: KnxMbmSignal): [string, string, string, string, string] {
  const { flags } = signal.knx;
  const cells = { u: knxFlagCell(flags.u, "U"), t: knxFlagCell(flags.t, "T"), ri: knxFlagCell(flags.ri, "Ri"), w: knxFlagCell(flags.w, "W"), r: knxFlagCell(flags.r, "R") };
  if (signal.virtual) {
    cells.u = " ";
    cells.ri = " ";
    cells.w = " ";
  } else {
    const { readFunc, writeFunc } = signal.modbus;
    if (readFunc < 0 && writeFunc >= 0) {
      cells.r = "  ";
      cells.t = "  ";
    } else if (readFunc >= 0 && writeFunc < 0) {
      cells.w = "  ";
      cells.u = "  ";
      cells.ri = "  ";
    }
  }
  return [cells.u, cells.t, cells.ri, cells.w, cells.r];
}

/**
 * The signal's deadband as MAPS 1.2.34 loads it: its own `<Deadband>`, or the
 * old global one when the signal has none (`MigrateGlobalDeadbandToSignals`,
 * ExternalMbm.cs:726-740).
 */
function signalDeadband(project: KnxMbmProject, signal: KnxMbmSignal): number {
  const own = signal.modbus.deadband ?? 0;
  return own === 0 && project.mbm.deadband !== 0 && !signal.modbusVirtual ? project.mbm.deadband : own;
}

/**
 * A KNX–MBM row as MAPS writes it (`KnxComObject.GenerateRow`,
 * `MbmObject.GenerateRow` MbmObject.cs:187-372, `PopulateExtraParameters`,
 * `CheckThisRowSpecific`). The Modbus cells follow the Modbus object's own
 * virtual/fixed flags, as in MAPS; the deadband and flags follow the KNX one.
 */
export function knxSignalRow(project: KnxMbmProject, signal: KnxMbmSignal): string[] {
  const { knx, modbus } = signal;
  const device = deviceOf(project.mbm, signal);
  const sending = knx.groupAddress > 0 ? formatGroupAddressAtLevel(knx.groupAddress, knx.groupAddressLevel ?? 3) : "";
  const listening = formatListeningAddresses(knx.additionalAddresses, knx.additionalAddressLevels, ",");
  const modbusVirtual = signal.modbusVirtual ?? false;
  const bitFields = modbus.format === MB_FORMATS.BITFIELDS && !modbusVirtual;
  const code = conversionCode(signal.conversions);
  return [
    String(signal.id + 1),
    boolCell(signal.active),
    signal.description,
    knxMbmDptCell(knx.dpt),
    sending,
    listening,
    ...knxMbmFlagCells(signal),
    priorityCell(knx.priority),
    String(signal.id + 1),
    deviceCell(project.mbm, signal),
    device ? String(device.slave) : "-",
    device ? (device.baseRegister === 1 ? "1-based" : "0-based") : "-",
    functionCell(modbus.readFunc),
    functionCell(modbus.writeFunc),
    modbusVirtual ? "-" : dashNumber(modbus.lenBits),
    // MAPS loads String (5) as no format on this side (`ParseMBMObjects`).
    modbus.format === MB_FORMATS.STRING ? "-" : formatCell(modbus.format),
    byteOrderCell(modbus.byteOrder),
    modbusVirtual && signal.modbusFixed ? "-" : String(modbus.address),
    bitFields ? dashNumber(modbus.bit) : "-",
    bitFields ? dashNumber(modbus.numOfBits === 0 ? 1 : modbus.numOfBits) : "-",
    signal.virtual || (modbusVirtual && signal.modbusFixed) ? "-" : String(signalDeadband(project, signal)),
    code === "-" ? "" : code,
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

const DPT_LABELS = new Map(COMMON_DPT_OPTIONS.map((option) => [option.value, option.label]));

/**
 * The DPT cell (`IntesisKnx.ConvertDPTValueToString`): "9.001: temperature (ºC)",
 * "1.x: (1-bit)"; empty for main type 0 or subtype 0 (except DPT 14), and
 * "main.sub: " with no text for a DPT `GetDPTDescriptionFromValueString` does
 * not name.
 */
export function dptCell(dpt: number): string {
  const { main, sub } = decodeDpt(dpt);
  if (main === 0) return "";
  if (sub === 0 && main !== 14) return "";
  return DPT_LABELS.get(dpt) ?? `${formatDpt(dpt)}: `;
}

/** A flag cell of the KNX side: the flag's letter, or two spaces (`KnxComObject.GenerateRowExternal`). */
function knxFlagCell(on: boolean, token: string): string {
  return on ? token : "  ";
}

/**
 * An MBS–KNX row as MAPS writes it (`MbsObject.GenerateRow`,
 * `KnxComObject.GenerateRowExternal`, `PopulateExtraParameters`): the bit only
 * for BitFields and the string length only for String, "-" otherwise; "Conv. Id"
 * empty and "Conversions" "-" when the row has no conversions.
 */
export function mbsKnxSignalRow(signal: MbsKnxSignal): string[] {
  const { knx, modbus } = signal;
  const sending = knx.groupAddress > 0 ? formatGroupAddressAtLevel(knx.groupAddress, knx.groupAddressLevel ?? 3) : "";
  const listening = formatListeningAddresses(knx.additionalAddresses, knx.additionalAddressLevels, ",");
  const code = conversionCode(signal.conversions);
  return [
    String(signal.id + 1),
    boolCell(signal.active),
    signal.description,
    dashNumber(modbus.lenBits),
    formatCell(modbus.format),
    String(modbus.address),
    modbus.format === MB_FORMATS.BITFIELDS ? dashNumber(modbus.bit) : "-",
    readWriteCell(modbus.readWrite),
    modbus.format === MB_FORMATS.STRING ? dashNumber(modbus.stringLength) : "-",
    String(signal.id + 1),
    dptCell(knx.dpt),
    sending,
    listening,
    knxFlagCell(knx.flags.u, "U"),
    knxFlagCell(knx.flags.t, "T"),
    knxFlagCell(knx.flags.ri, "Ri"),
    knxFlagCell(knx.flags.w, "W"),
    knxFlagCell(knx.flags.r, "R"),
    priorityCell(knx.priority),
    code === "-" ? "" : code,
    conversionsButtonCell(signal.conversions),
  ];
}

export function parseListening(raw: string): { addresses: number[]; levels: (1 | 2 | 3)[] } {
  const addresses: number[] = [];
  const levels: (1 | 2 | 3)[] = [];
  for (const part of raw.split(",").map((value) => value.trim()).filter(Boolean)) {
    const address = parseGroupAddress(part);
    if (address === undefined || address <= 0) continue;
    addresses.push(address);
    levels.push(groupAddressLevelOf(part));
  }
  return { addresses, levels };
}

export { formatDpt, formatGroupAddress, parseGroupAddress };
