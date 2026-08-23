import type { KnxMbmProject, KnxMbmSignal } from "@/gateway-families/knx-mbm/model";
import { formatGroupAddress, isValidGroupAddress, parseGroupAddress } from "@/protocols/knx/address";
import { COMMON_DPT_OPTIONS, formatDpt } from "@/protocols/knx/dpt";
import type { KnxFlags } from "@/protocols/knx/flags";
import {
  BYTE_ORDER_LABELS,
  FORMAT_LABELS,
  LEN_BITS,
  MAX_ADDRESS,
  READ_FUNCTIONS,
  WRITE_FUNCTIONS,
  isBitFunction,
  nodeForPort,
  portForTcpNode,
  type MbmConfig,
} from "@/protocols/modbus/master";
import type { SignalPatchInput } from "@/lib/project-types";
import { projectColumns } from "./columns-project";
import type { GridColumn } from "./types";

const READ_LABELS: Record<number, string> = {
  [-1]: "—",
  1: "1 · Coils",
  2: "2 · Discrete inputs",
  3: "3 · Holding registers",
  4: "4 · Input registers",
};

const WRITE_LABELS: Record<number, string> = {
  [-1]: "—",
  5: "5 · Single coil",
  6: "6 · Single register",
  15: "15 · Multiple coils",
  16: "16 · Multiple registers",
};

const FORMAT_COMPACT: Record<number, string> = {
  [-1]: "—",
  0: "U",
  1: "C2",
  2: "C1",
  3: "F",
  4: "BF",
  5: "Str",
};

const BYTE_ORDER_COMPACT: Record<number, string> = {
  [-1]: "—",
  0: "BE",
  1: "LE",
  2: "BE↕",
  3: "LE↕",
};

function compactFunc(code: number): string {
  return code >= 0 ? String(code) : "—";
}

function knxNodeCompact(mbm: MbmConfig, port: number): string {
  const ref = nodeForPort(mbm, port);
  if (!ref) return "—";
  if (ref.kind === "rtu") return `RTU ${port + 1}`;
  return `TCP ${port - mbm.rtuNodes.length + 1}`;
}

function knxDeviceCompact(signal: KnxMbmSignal): string {
  if (signal.modbus.isBroadcast) return "BC";
  return signal.modbus.deviceIndex >= 0 ? String(signal.modbus.deviceIndex) : "—";
}

function knxDirection(signal: KnxMbmSignal): { arrow: string; title: string } {
  const reads = signal.modbus.readFunc >= 0;
  const writes = signal.modbus.writeFunc >= 0;
  if (reads && writes) return { arrow: "↔", title: "Read + write" };
  if (reads) return { arrow: "←", title: "Read · status towards KNX" };
  if (writes) return { arrow: "→", title: "Write · control towards Modbus" };
  return { arrow: "—", title: "No Modbus function configured" };
}

export interface KnxSignalRow {
  signal: KnxMbmSignal;
  groupAddress: string;
  dpt: string;
  nodeLabel: string;
  deviceLabel: string;
  slaveLabel: string;
  searchText: string;
}

export function knxNodeLabel(mbm: MbmConfig, port: number): string {
  const ref = nodeForPort(mbm, port);
  if (!ref) return "—";
  if (ref.kind === "rtu") return `RTU ${port + 1}`;
  const node = ref.node as MbmConfig["tcpNodes"][number];
  return `TCP ${port - mbm.rtuNodes.length + 1} · ${node.ip}:${node.port}`;
}

export function knxDeviceLabel(mbm: MbmConfig, signal: KnxMbmSignal): string {
  if (signal.modbus.isBroadcast) return "Broadcast";
  const ref = nodeForPort(mbm, signal.modbus.port);
  if (!ref) return "—";
  const device = ref.node.devices.find((d) => d.index === signal.modbus.deviceIndex);
  return device ? device.name : "—";
}

export function knxSlaveLabel(mbm: MbmConfig, signal: KnxMbmSignal): string {
  if (signal.modbus.isBroadcast) return "—";
  const ref = nodeForPort(mbm, signal.modbus.port);
  const device = ref?.node.devices.find((d) => d.index === signal.modbus.deviceIndex);
  return device ? String(device.slave) : "—";
}

export function toKnxRow(mbm: MbmConfig, signal: KnxMbmSignal): KnxSignalRow {
  const groupAddress = signal.knx.groupAddress > 0 ? formatGroupAddress(signal.knx.groupAddress) : "—";
  const dpt = formatDpt(signal.knx.dpt);
  const node = knxNodeLabel(mbm, signal.modbus.port);
  const device = knxDeviceLabel(mbm, signal);
  const slave = knxSlaveLabel(mbm, signal);
  return {
    signal,
    groupAddress,
    dpt,
    nodeLabel: node,
    deviceLabel: device,
    slaveLabel: slave,
    searchText: [signal.id, signal.description, groupAddress, dpt, node, device, signal.modbus.address]
      .join(" ")
      .toLowerCase(),
  };
}

const DPT_SELECT_OPTIONS = COMMON_DPT_OPTIONS.map((opt) => ({
  value: String(opt.value),
  label: opt.label,
}));

function nodeOptions(mbm: MbmConfig) {
  return [
    { value: "-1", label: "Not set" },
    ...mbm.rtuNodes.map((node, i) => ({
      value: String(i),
      label: `RTU ${i + 1} — ${node.baudrate} baud`,
    })),
    ...mbm.tcpNodes.map((node, i) => ({
      value: String(portForTcpNode(mbm, i)),
      label: `TCP ${i + 1} — ${node.ip}:${node.port}`,
    })),
  ];
}

function deviceOptions(mbm: MbmConfig, row: KnxSignalRow) {
  const port = row.signal.modbus.port;
  const ref = nodeForPort(mbm, port);
  const devices = ref?.node.devices ?? [];
  return [
    { value: "broadcast", label: "Broadcast" },
    { value: "-1", label: "Not set" },
    ...devices.map((device) => ({
      value: String(device.index),
      label: `${device.name} (slave ${device.slave})`,
    })),
  ];
}

function parseRegister(raw: string): { address: number } | { error: string } {
  const register = Number(raw);
  if (!Number.isInteger(register) || register < 0 || register > MAX_ADDRESS) {
    return { error: `Invalid register address — 0–${MAX_ADDRESS}` };
  }
  return { address: register };
}

export const KNX_TAB_ORDER = [
  "description",
  "dpt",
  "groupAddress",
  "node",
  "device",
  "readFunc",
  "writeFunc",
  "lenBits",
  "format",
  "byteOrder",
  "address",
];

export function knxMbmColumns(project: KnxMbmProject): GridColumn<KnxSignalRow>[] {
  const { mbm } = project;
  const extended = project.knx.extendedAddresses;

  return [
    ...projectColumns<KnxSignalRow>({
      id: (row) => row.signal.id,
      description: (row) => row.signal.description,
      active: (row) => row.signal.active,
    }),
    {
      id: "dpt",
      group: "bms",
      header: "DPT",
      headerHint: "KNX datapoint type",
      width: 96,
      kind: "select",
      bulkLabel: "DPT",
      mono: true,
      getText: (row) => row.dpt,
      getEditorValue: (row) => String(row.signal.knx.dpt),
      options: (row) => {
        const current = String(row.signal.knx.dpt);
        if (DPT_SELECT_OPTIONS.some((opt) => opt.value === current)) return DPT_SELECT_OPTIONS;
        // Value outside the COMMON list (e.g. imported) — show it so the cell is not blank.
        return [{ value: current, label: row.dpt }, ...DPT_SELECT_OPTIONS];
      },
      parse: (_row, raw) => ({ patch: { knx: { dpt: Number(raw) } } }),
      inverseFromText: (row) => ({ knx: { dpt: row.signal.knx.dpt } }),
    },
    {
      id: "groupAddress",
      group: "bms",
      header: "Group address",
      headerShort: "GA",
      width: 118,
      minWidth: 100,
      kind: "text",
      bulkLabel: "Group address",
      mono: true,
      textTone: "strong",
      getText: (row) => row.groupAddress,
      getEditorValue: (row) => (row.signal.knx.groupAddress > 0 ? row.groupAddress : ""),
      parse: (_row, raw) => {
        const ga = parseGroupAddress(raw);
        if (ga === undefined || !isValidGroupAddress(ga, { extended })) {
          return {
            error: `Invalid group address — expected main/middle/sub (max ${extended ? "31/7/255" : "15/7/255"})`,
          };
        }
        return { patch: { knx: { groupAddress: ga } } };
      },
      inverseFromText: (row) => ({ knx: { groupAddress: row.signal.knx.groupAddress } }),
    },
    {
      id: "flags",
      group: "bms",
      header: "Flags",
      headerHint: "KNX flags (U T Ri W R)",
      width: 118,
      minWidth: 110,
      maxWidth: 160,
      kind: "flags",
      getText: (row) => {
        const f = row.signal.knx.flags;
        return ["u", "t", "ri", "w", "r"]
          .filter((k) => f[k as keyof KnxFlags])
          .map((k) => (k === "ri" ? "Ri" : k.toUpperCase()))
          .join(" ");
      },
      getFlags: (row) => row.signal.knx.flags,
      toPatchFromFlags: (_row, flags) => ({ knx: { flags } }),
      inverseFromFlags: (row) => ({ knx: { flags: { ...row.signal.knx.flags } } }),
    },
    {
      id: "direction",
      group: "gateway",
      header: "Direction",
      headerShort: "DIR",
      headerHint: "Direction",
      width: 112,
      minWidth: 96,
      maxWidth: 160,
      kind: "none",
      mono: true,
      getText: (row) => knxDirection(row.signal).arrow,
      getTitle: (row) => knxDirection(row.signal).title,
    },
    {
      id: "node",
      group: "device",
      header: "Node",
      headerHint: "Modbus node",
      width: 160,
      minWidth: 100,
      maxWidth: 360,
      kind: "select",
      bulkLabel: "Node",
      getText: (row) => row.nodeLabel,
      getCompactText: (row) => knxNodeCompact(mbm, row.signal.modbus.port),
      getEditorValue: (row) => String(row.signal.modbus.port),
      options: () => nodeOptions(mbm),
      parse: (_row, raw) => {
        const port = Number(raw);
        return { patch: { modbus: { port, deviceIndex: -1, isBroadcast: false } } };
      },
      inverseFromText: (row) => ({
        modbus: {
          port: row.signal.modbus.port,
          deviceIndex: row.signal.modbus.deviceIndex,
          isBroadcast: row.signal.modbus.isBroadcast,
        },
      }),
    },
    {
      id: "device",
      group: "device",
      header: "Device",
      headerShort: "DV",
      width: 180,
      minWidth: 100,
      maxWidth: 360,
      kind: "select",
      bulkLabel: "Device",
      textTone: "strong",
      getText: (row) => row.deviceLabel,
      getCompactText: (row) => knxDeviceCompact(row.signal),
      getEditorValue: (row) => (row.signal.modbus.isBroadcast ? "broadcast" : String(row.signal.modbus.deviceIndex)),
      options: (row) => deviceOptions(mbm, row),
      parse: (_row, raw) => {
        if (raw === "broadcast") return { patch: { modbus: { isBroadcast: true, deviceIndex: -1 } } };
        return { patch: { modbus: { isBroadcast: false, deviceIndex: Number(raw) } } };
      },
      inverseFromText: (row) => ({
        modbus: { isBroadcast: row.signal.modbus.isBroadcast, deviceIndex: row.signal.modbus.deviceIndex },
      }),
    },
    {
      id: "slave",
      group: "device",
      header: "Slave",
      headerShort: "Slv",
      width: 72,
      minWidth: 68,
      kind: "none",
      mono: true,
      getText: (row) => row.slaveLabel,
    },
    {
      id: "readFunc",
      group: "device",
      header: "Read",
      headerHint: "Read function",
      width: 176,
      minWidth: 120,
      maxWidth: 240,
      kind: "select",
      bulkLabel: "Read function",
      getText: (row) => READ_LABELS[row.signal.modbus.readFunc] ?? String(row.signal.modbus.readFunc),
      getCompactText: (row) => compactFunc(row.signal.modbus.readFunc),
      getEditorValue: (row) => String(row.signal.modbus.readFunc),
      options: () => [
        { value: "-1", label: "None" },
        ...READ_FUNCTIONS.map((fn) => ({ value: String(fn), label: READ_LABELS[fn] })),
      ],
      parse: (_row, raw) => ({ patch: { modbus: { readFunc: Number(raw) } } }),
      inverseFromText: (row) => ({ modbus: { readFunc: row.signal.modbus.readFunc } }),
    },
    {
      id: "writeFunc",
      group: "device",
      header: "Write",
      headerHint: "Write function",
      width: 184,
      minWidth: 120,
      maxWidth: 240,
      kind: "select",
      bulkLabel: "Write function",
      getText: (row) => WRITE_LABELS[row.signal.modbus.writeFunc] ?? String(row.signal.modbus.writeFunc),
      getCompactText: (row) => compactFunc(row.signal.modbus.writeFunc),
      getEditorValue: (row) => String(row.signal.modbus.writeFunc),
      options: () => [
        { value: "-1", label: "None" },
        ...WRITE_FUNCTIONS.map((fn) => ({ value: String(fn), label: WRITE_LABELS[fn] })),
      ],
      parse: (_row, raw) => ({ patch: { modbus: { writeFunc: Number(raw) } } }),
      inverseFromText: (row) => ({ modbus: { writeFunc: row.signal.modbus.writeFunc } }),
    },
    {
      id: "lenBits",
      group: "device",
      header: "Len",
      headerHint: "Length (bits)",
      width: 56,
      kind: "select",
      bulkLabel: "Length (bits)",
      mono: true,
      getText: (row) => String(row.signal.modbus.lenBits),
      options: () => LEN_BITS.map((len) => ({ value: String(len), label: String(len) })),
      parse: (_row, raw) => ({ patch: { modbus: { lenBits: Number(raw) } } }),
      inverseFromText: (row) => ({ modbus: { lenBits: row.signal.modbus.lenBits } }),
    },
    {
      id: "format",
      group: "device",
      header: "Format",
      headerShort: "Fmt",
      width: 96,
      kind: "select",
      bulkLabel: "Format",
      getText: (row) => {
        const modbus = row.signal.modbus;
        const format = FORMAT_LABELS[modbus.format] ?? "?";
        if (isBitFunction(modbus.readFunc) && isBitFunction(modbus.writeFunc)) return format;
        return format;
      },
      getCompactText: (row) => FORMAT_COMPACT[row.signal.modbus.format] ?? "?",
      getEditorValue: (row) => String(row.signal.modbus.format),
      options: () =>
        Object.entries(FORMAT_LABELS)
          .filter(([value]) => value !== "-1")
          .map(([value, label]) => ({ value, label })),
      parse: (_row, raw) => ({ patch: { modbus: { format: Number(raw) } } }),
      inverseFromText: (row) => ({ modbus: { format: row.signal.modbus.format } }),
    },
    {
      id: "byteOrder",
      group: "device",
      header: "Byte order",
      headerShort: "BO",
      width: 118,
      minWidth: 100,
      kind: "select",
      bulkLabel: "Byte order",
      getText: (row) => {
        const modbus = row.signal.modbus;
        if (isBitFunction(modbus.readFunc) && isBitFunction(modbus.writeFunc)) return "—";
        return BYTE_ORDER_LABELS[modbus.byteOrder] ?? "—";
      },
      getCompactText: (row) => {
        const modbus = row.signal.modbus;
        if (isBitFunction(modbus.readFunc) && isBitFunction(modbus.writeFunc)) return "—";
        return BYTE_ORDER_COMPACT[modbus.byteOrder] ?? "—";
      },
      getEditorValue: (row) => String(row.signal.modbus.byteOrder),
      options: () =>
        Object.entries(BYTE_ORDER_LABELS).map(([value, label]) => ({ value, label })),
      parse: (_row, raw) => ({ patch: { modbus: { byteOrder: Number(raw) } } }),
      inverseFromText: (row) => ({ modbus: { byteOrder: row.signal.modbus.byteOrder } }),
    },
    {
      id: "address",
      group: "device",
      header: "Register",
      headerShort: "Reg",
      width: 80,
      kind: "number",
      bulkLabel: "Register",
      mono: true,
      textTone: "strong",
      getText: (row) => String(row.signal.modbus.address),
      parse: (_row, raw) => {
        const parsed = parseRegister(raw);
        if ("error" in parsed) return parsed;
        return { patch: { modbus: { address: parsed.address } } };
      },
      inverseFromText: (row) => ({ modbus: { address: row.signal.modbus.address } }),
    },
  ];
}
