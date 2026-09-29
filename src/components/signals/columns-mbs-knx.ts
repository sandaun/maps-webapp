import type { MbsKnxSignal } from "@/gateway-families/mbs-knx/model";
import { conversionCode } from "@/core/signals/conversion-code";
import type { ConversionValues } from "@/core/conversions/rules";
import { conversionChain, type ConversionChain } from "./conversion-chain";
import { MBS_KNX_CONVERSION_SIDES } from "./conversion-sides";
import {
  formatGroupAddress,
  formatGroupAddressAtLevel,
  groupAddressLevelOf,
  isValidGroupAddress,
  parseGroupAddress,
} from "@/protocols/knx/address";
import { COMMON_DPT_OPTIONS, formatDpt } from "@/protocols/knx/dpt";
import type { KnxFlags } from "@/protocols/knx/flags";
import { FORMATS, MBS_DEFAULT_MAX_ADDRESS, READ_WRITE } from "@/protocols/modbus/slave";
import { projectColumns } from "./columns-project";
import type { BandId, GridColumn } from "./types";

/**
 * Signal table of a KNX ↔ Modbus Slave project, with the options of the MAPS
 * grid (`MbsObject.GenerateRow` + `ExternalKnx` columns): the Modbus side is
 * the BMS one, KNX the device one. The server fits every edit as MAPS does
 * (BitFields → 16 bits, flags against the read/write mode, flag interlocks),
 * so the cells send what the user chose and show what the project holds.
 */

/** `IntesisMb.PopulateDataLengthComboBox(isInternal)`. */
const LEN_BITS = [16, 32, 64] as const;

/** `IntesisMb.PopulateFormatComboBox` without String (`stringFormatAvailable = false`). */
const FORMAT_LABELS: Record<number, string> = {
  [FORMATS.NO_FORMAT]: "—",
  [FORMATS.UNSIGNED]: "Unsigned",
  [FORMATS.SIGNED_C2]: "Signed (C2)",
  [FORMATS.SIGNED_C1]: "Signed (C1)",
  [FORMATS.FLOAT]: "Float",
  [FORMATS.BITFIELDS]: "BitFields",
};

const FORMAT_COMPACT: Record<number, string> = {
  [FORMATS.NO_FORMAT]: "—",
  [FORMATS.UNSIGNED]: "U",
  [FORMATS.SIGNED_C2]: "C2",
  [FORMATS.SIGNED_C1]: "C1",
  [FORMATS.FLOAT]: "F",
  [FORMATS.BITFIELDS]: "BF",
};

/** `IntesisMb.PopulateReadWriteComboBoxMBS`. */
const READ_WRITE_LABELS: Record<number, string> = {
  [READ_WRITE.READ]: "Read",
  [READ_WRITE.TRIGGER]: "Trigger",
  [READ_WRITE.READWRITE]: "Read / Write",
};

const READ_WRITE_COMPACT: Record<number, string> = {
  [READ_WRITE.READ]: "R",
  [READ_WRITE.TRIGGER]: "Trg",
  [READ_WRITE.READWRITE]: "R/W",
};

/**
 * Left is the Modbus side, right the KNX one. A register the BMS reads gets
 * its value from KNX; a trigger the BMS writes goes to KNX.
 */
const DIRECTION: Record<number, { arrow: string; title: string }> = {
  [READ_WRITE.READ]: { arrow: "←", title: "Read · the BMS reads the value KNX sends" },
  [READ_WRITE.TRIGGER]: { arrow: "→", title: "Trigger · the BMS writes, the gateway sends it to KNX" },
  [READ_WRITE.READWRITE]: { arrow: "↔", title: "Read / write" },
};

/** `KnxComObject.GetPriorityString`. */
const PRIORITY_LABELS: Record<number, string> = { 0: "0 · System", 1: "1 · Normal", 2: "2 · Urgent", 3: "3 · Low" };

export const MBS_KNX_GROUP_LABELS: Record<BandId, string> = {
  project: "PROJECT SIGNAL",
  bms: "MODBUS SLAVE · BMS SIDE",
  gateway: "GATEWAY",
  device: "KNX TP · DEVICE SIDE",
};

export const MBS_KNX_GROUP_LABELS_COMPACT: Record<BandId, string> = {
  project: "PROJECT SIGNAL",
  bms: "BMS",
  gateway: "GW",
  device: "DEVICE",
};

export const MBS_KNX_COLUMN_GROUPS: { id: BandId; label: string; color: string }[] = [
  { id: "bms", label: MBS_KNX_GROUP_LABELS.bms, color: "#8A5A12" },
  { id: "gateway", label: MBS_KNX_GROUP_LABELS.gateway, color: "var(--color-hms-blue)" },
  { id: "device", label: MBS_KNX_GROUP_LABELS.device, color: "#1268B3" },
];

export const MBS_KNX_TAB_ORDER = [
  "description",
  "lenBits",
  "format",
  "address",
  "bit",
  "readWrite",
  "dpt",
  "groupAddress",
  "additionalAddresses",
];

export interface MbsKnxSignalRow {
  signal: MbsKnxSignal;
  groupAddress: string;
  additionalAddresses: string;
  dpt: string;
  conversionCode: string;
  conversionChain: ConversionChain;
  searchText: string;
}

export function toMbsKnxRow(signal: MbsKnxSignal, conversions: readonly ConversionValues[] = []): MbsKnxSignalRow {
  const groupAddress = signal.knx.groupAddress > 0
    ? formatGroupAddressAtLevel(signal.knx.groupAddress, signal.knx.groupAddressLevel ?? 3)
    : "—";
  const additionalAddresses = signal.knx.additionalAddresses.map(formatGroupAddress).join(", ");
  const dpt = formatDpt(signal.knx.dpt);
  return {
    signal,
    groupAddress,
    additionalAddresses,
    dpt,
    conversionCode: conversionCode(signal.conversions),
    conversionChain: conversionChain(signal, [...conversions], MBS_KNX_CONVERSION_SIDES),
    searchText: [signal.id, signal.description, signal.modbus.address, groupAddress, additionalAddresses, dpt]
      .join(" ")
      .toLowerCase(),
  };
}

const DPT_SELECT_OPTIONS = COMMON_DPT_OPTIONS.map((opt) => ({ value: String(opt.value), label: opt.label }));

function isBitFields(row: MbsKnxSignalRow): boolean {
  return row.signal.modbus.format === FORMATS.BITFIELDS;
}

export function mbsKnxColumns(project: { knx: { extendedAddresses: boolean } }): GridColumn<MbsKnxSignalRow>[] {
  const extended = project.knx.extendedAddresses;
  const gaError = `Invalid group address — expected main/middle/sub (max ${extended ? "31/7/255" : "15/7/255"})`;

  return [
    ...projectColumns<MbsKnxSignalRow>({
      id: (row) => row.signal.id,
      description: (row) => row.signal.description,
      active: (row) => row.signal.active,
    }),
    {
      id: "lenBits",
      group: "bms",
      header: "Len",
      headerHint: "Data length (bits) · BitFields registers are always 16 bits",
      width: 56,
      kind: "select",
      bulkLabel: "Data length (bits)",
      mono: true,
      getText: (row) => String(row.signal.modbus.lenBits),
      options: () => LEN_BITS.map((len) => ({ value: String(len), label: String(len) })),
      parse: (_row, raw) => ({ patch: { modbus: { lenBits: Number(raw) } } }),
      inverseFromText: (row) => ({ modbus: { lenBits: row.signal.modbus.lenBits } }),
    },
    {
      id: "format",
      group: "bms",
      header: "Format",
      headerShort: "Fmt",
      width: 110,
      kind: "select",
      bulkLabel: "Format",
      getText: (row) => FORMAT_LABELS[row.signal.modbus.format] ?? "?",
      getCompactText: (row) => FORMAT_COMPACT[row.signal.modbus.format] ?? "?",
      getEditorValue: (row) => String(row.signal.modbus.format),
      options: () =>
        Object.entries(FORMAT_LABELS)
          .filter(([value]) => value !== String(FORMATS.NO_FORMAT))
          .map(([value, label]) => ({ value, label })),
      parse: (_row, raw) => ({ patch: { modbus: { format: Number(raw) } } }),
      // The row the format leaves (length, bit) is restored with it.
      inverseFromText: (row) => ({
        modbus: { format: row.signal.modbus.format, lenBits: row.signal.modbus.lenBits, bit: row.signal.modbus.bit },
      }),
    },
    {
      id: "address",
      group: "bms",
      header: "Register",
      headerShort: "Reg",
      width: 80,
      kind: "number",
      bulkLabel: "Register",
      mono: true,
      textTone: "strong",
      getText: (row) => String(row.signal.modbus.address),
      parse: (_row, raw) => {
        const address = Number(raw);
        if (!Number.isInteger(address) || address < 0 || address > MBS_DEFAULT_MAX_ADDRESS) {
          return { error: `Invalid register address — 0–${MBS_DEFAULT_MAX_ADDRESS}` };
        }
        return { patch: { modbus: { address } } };
      },
      inverseFromText: (row) => ({ modbus: { address: row.signal.modbus.address } }),
    },
    {
      id: "bit",
      group: "bms",
      header: "Bit",
      headerHint: "Bit of a BitFields register (0–15)",
      width: 52,
      kind: "number",
      bulkLabel: "Bit",
      mono: true,
      getText: (row) => (isBitFields(row) ? String(row.signal.modbus.bit) : "—"),
      getEditorValue: (row) => (isBitFields(row) ? String(row.signal.modbus.bit) : ""),
      parse: (row, raw) => {
        if (!isBitFields(row)) return { error: "Only BitFields registers have a bit." };
        const bit = Number(raw);
        if (!Number.isInteger(bit) || bit < 0 || bit > 15) return { error: "Invalid bit — 0–15" };
        return { patch: { modbus: { bit } } };
      },
      inverseFromText: (row) => ({ modbus: { bit: row.signal.modbus.bit } }),
    },
    {
      id: "readWrite",
      group: "bms",
      header: "Read / Write",
      headerShort: "R/W",
      headerHint: "Modbus access · it also sets which KNX flags the signal can have",
      width: 112,
      kind: "select",
      bulkLabel: "Read / Write",
      getText: (row) => READ_WRITE_LABELS[row.signal.modbus.readWrite] ?? "—",
      getCompactText: (row) => READ_WRITE_COMPACT[row.signal.modbus.readWrite] ?? "—",
      getEditorValue: (row) => String(row.signal.modbus.readWrite),
      options: () => Object.entries(READ_WRITE_LABELS).map(([value, label]) => ({ value, label })),
      parse: (_row, raw) => ({ patch: { modbus: { readWrite: Number(raw) as 0 | 1 | 2 } } }),
      // A new read/write mode also changes the KNX flags: undo restores both.
      inverseFromText: (row) => ({
        modbus: { readWrite: row.signal.modbus.readWrite },
        knx: { flags: { ...row.signal.knx.flags } },
      }),
    },
    {
      id: "direction",
      group: "gateway",
      header: "Direction",
      headerShort: "DIR",
      width: 96,
      minWidth: 80,
      kind: "none",
      mono: true,
      getText: (row) => DIRECTION[row.signal.modbus.readWrite]?.arrow ?? "—",
      getTitle: (row) => DIRECTION[row.signal.modbus.readWrite]?.title ?? "",
    },
    {
      // Visible by default, as in KNX–MBM: the grid is where conversions are assigned.
      id: "conversionChain",
      group: "gateway",
      header: "Conversions",
      headerShort: "Conv",
      headerHint: "Filters and operations between Modbus and KNX · click to assign",
      width: 220,
      minWidth: 110,
      maxWidth: 420,
      kind: "none",
      getText: (row) => row.conversionChain.text,
      getTitle: (row) => row.conversionChain.title,
    },
    {
      id: "conversions",
      group: "gateway",
      header: "Conv. Id",
      headerHint: "Conversions applied to the signal (MAPS Conv. Id)",
      width: 160,
      minWidth: 100,
      maxWidth: 360,
      // Hidden by default as in KNX–MBM: the raw MAPS code.
      defaultHidden: true,
      kind: "none",
      mono: true,
      getText: (row) => row.conversionCode || "—",
    },
    {
      id: "dpt",
      group: "device",
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
        return [{ value: current, label: row.dpt }, ...DPT_SELECT_OPTIONS];
      },
      parse: (_row, raw) => ({ patch: { knx: { dpt: Number(raw) } } }),
      inverseFromText: (row) => ({ knx: { dpt: row.signal.knx.dpt } }),
    },
    {
      id: "groupAddress",
      group: "device",
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
        if (ga === undefined || !isValidGroupAddress(ga, { extended })) return { error: gaError };
        return { patch: { knx: { groupAddress: ga, groupAddressLevel: groupAddressLevelOf(raw) } } };
      },
      inverseFromText: (row) => ({
        knx: { groupAddress: row.signal.knx.groupAddress, groupAddressLevel: row.signal.knx.groupAddressLevel ?? 3 },
      }),
    },
    {
      id: "additionalAddresses",
      group: "device",
      header: "Additional addresses",
      headerShort: "Add. GA",
      headerHint: "Additional (listening) group addresses, comma separated · they need the U or W flag",
      width: 184,
      minWidth: 100,
      maxWidth: 360,
      kind: "text",
      mono: true,
      getText: (row) => row.additionalAddresses || "—",
      getEditorValue: (row) => row.additionalAddresses,
      parse: (_row, raw) => {
        const parts = raw.split(",").map((part) => part.trim()).filter((part) => part !== "");
        const addresses: number[] = [];
        for (const part of parts) {
          const ga = parseGroupAddress(part);
          if (ga === undefined || !isValidGroupAddress(ga, { extended })) return { error: `${gaError}: “${part}”` };
          addresses.push(ga);
        }
        return { patch: { knx: { additionalAddresses: addresses } } };
      },
      inverseFromText: (row) => ({ knx: { additionalAddresses: [...row.signal.knx.additionalAddresses] } }),
    },
    {
      id: "flags",
      group: "device",
      header: "Flags",
      headerHint: "KNX flags (U T Ri W R) · the Modbus read/write mode limits them",
      width: 118,
      minWidth: 110,
      maxWidth: 160,
      kind: "flags",
      getText: (row) => {
        const f = row.signal.knx.flags;
        return (["u", "t", "ri", "w", "r"] as const)
          .filter((k) => f[k])
          .map((k) => (k === "ri" ? "Ri" : k.toUpperCase()))
          .join(" ");
      },
      getFlags: (row) => row.signal.knx.flags,
      // The server applies the MAPS interlocks and the read/write limits to the clicked flag.
      toggleFlag: (flags: KnxFlags, flag: keyof KnxFlags) => ({ ...flags, [flag]: !flags[flag] }),
      toPatchFromFlags: (_row, flags) => ({ knx: { flags } }),
      inverseFromFlags: (row) => ({ knx: { flags: { ...row.signal.knx.flags } } }),
    },
    {
      id: "priority",
      group: "device",
      header: "Priority",
      headerShort: "Prio",
      width: 96,
      defaultHidden: true,
      kind: "select",
      bulkLabel: "Priority",
      getText: (row) => PRIORITY_LABELS[row.signal.knx.priority] ?? String(row.signal.knx.priority),
      getEditorValue: (row) => String(row.signal.knx.priority),
      options: () => Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label })),
      parse: (_row, raw) => ({ patch: { knx: { priority: Number(raw) } } }),
      inverseFromText: (row) => ({ knx: { priority: row.signal.knx.priority } }),
    },
  ];
}
