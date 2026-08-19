import type { KnxMbmProject, KnxMbmSignal } from "@/gateway-families/knx-mbm/model";
import { formatGroupAddress, isValidGroupAddress, parseGroupAddress } from "@/protocols/knx/address";
import { formatDpt, isValidDpt, parseDpt } from "@/protocols/knx/dpt";
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
      width: 96,
      kind: "text",
      bulkLabel: "DPT",
      mono: true,
      getText: (row) => row.dpt,
      parse: (_row, raw) => {
        const dpt = parseDpt(raw);
        if (dpt === undefined || !isValidDpt(dpt)) {
          return { error: "Invalid DPT — expected e.g. 9.001 or 1.x" };
        }
        return { patch: { knx: { dpt } } };
      },
      inverseFromText: (row) => ({ knx: { dpt: row.signal.knx.dpt } }),
    },
    {
      id: "groupAddress",
      group: "bms",
      header: "Group address",
      width: 100,
      kind: "text",
      bulkLabel: "Group address",
      mono: true,
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
      width: 74,
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
      header: "DIR",
      width: 72,
      minWidth: 64,
      maxWidth: 88,
      resizable: false,
      kind: "none",
      mono: true,
      getText: (row) => knxDirection(row.signal).arrow,
      getTitle: (row) => knxDirection(row.signal).title,
    },
    {
      id: "node",
      group: "device",
      header: "Node",
      width: 160,
      minWidth: 100,
      maxWidth: 360,
      kind: "select",
      bulkLabel: "Node",
      getText: (row) => row.nodeLabel,
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
      width: 180,
      minWidth: 100,
      maxWidth: 360,
      kind: "select",
      bulkLabel: "Device",
      getText: (row) => row.deviceLabel,
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
      width: 56,
      kind: "none",
      mono: true,
      getText: (row) => row.slaveLabel,
    },
    {
      id: "readFunc",
      group: "device",
      header: "Read",
      width: 120,
      minWidth: 84,
      maxWidth: 240,
      kind: "select",
      bulkLabel: "Read function",
      getText: (row) => READ_LABELS[row.signal.modbus.readFunc] ?? String(row.signal.modbus.readFunc),
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
      width: 120,
      minWidth: 84,
      maxWidth: 240,
      kind: "select",
      bulkLabel: "Write function",
      getText: (row) => WRITE_LABELS[row.signal.modbus.writeFunc] ?? String(row.signal.modbus.writeFunc),
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
      width: 96,
      kind: "select",
      bulkLabel: "Format",
      getText: (row) => {
        const modbus = row.signal.modbus;
        const format = FORMAT_LABELS[modbus.format] ?? "?";
        if (isBitFunction(modbus.readFunc) && isBitFunction(modbus.writeFunc)) return format;
        return format;
      },
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
      width: 100,
      kind: "select",
      bulkLabel: "Byte order",
      getText: (row) => {
        const modbus = row.signal.modbus;
        if (isBitFunction(modbus.readFunc) && isBitFunction(modbus.writeFunc)) return "—";
        return BYTE_ORDER_LABELS[modbus.byteOrder] ?? "—";
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
      width: 80,
      kind: "number",
      bulkLabel: "Register",
      mono: true,
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
