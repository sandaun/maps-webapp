import "server-only";
import { XmlDocument } from "@/core/project-format";
import {
  addSignal,
  projectFromXml,
  removeNonVirtualSignals,
  setConversions,
  updateSignal,
  type KnxMbmProject,
  type KnxMbmSignal,
} from "@/gateway-families/knx-mbm";
import type { ParsedSignalsSheet } from "../exports/xlsx-signals";
import { indexFromString, KNX_SIGNAL_HEADERS, parseDeviceCell } from "../exports/maps-grid-values";
import {
  configIdProblems,
  FORMATS,
  importedKnxEndpoint,
  isDashOrOneOf,
  isUInt,
  knxCellProblems,
  parseActive,
  positionalRows,
  type TableColumn,
} from "./xlsx-cells";
import { importedConversions, listError } from "./xlsx-conversions";
import type { ImportMode, ImportXlsxResult } from "./xlsx-signals";

const FUNCTIONS = [
  "-",
  "1: Read Coils",
  "2: Read Discrete Inputs",
  "3: Read Holding Registers",
  "4: Read Input Registers",
  "5: Write Single Coil",
  "6: Write Single Register",
  "15: Write Multiple Coils",
  "16: Write Multiple Registers",
];
const BYTE_ORDERS = ["-", "0: Big Endian", "1: Little Endian", "2: Word Inv BE", "3: Word Inv LE"];
const BASES = ["-", "0-based", "1-based"];

/**
 * The 25 signal columns, by position, keyed by their MAPS header
 * (`KNX_SIGNAL_HEADERS`; "Modbus #" for the Modbus side's own "#"), with the
 * names earlier MAPS Web versions wrote. The conversion columns are found by
 * name (`importedConversions`).
 */
const EARLIER_MAPS_WEB_HEADERS: Partial<Record<number, string>> = {
  4: "Sending",
  5: "Listening",
  12: "Index",
  14: "Slave",
  16: "Read",
  17: "Write",
  18: "Data length",
  20: "Byte order",
  23: "Bit length",
};
const SIGNAL_COLUMNS: TableColumn[] = KNX_SIGNAL_HEADERS.slice(0, 25).map((header, i) => ({
  key: i === 12 ? "Modbus #" : header,
  header,
  earlierHeader: EARLIER_MAPS_WEB_HEADERS[i],
}));

/**
 * KNX–MBM Excel import, like MAPS `frmImport`: every row is checked first
 * (`IntesisProjectKnxMbm_RT.CheckExcelRowIntegrity`, :1144-1180, and
 * `frmImport.CheckConfigIdConsecutivity`) and one bad row rejects the whole
 * file; then each row goes through `ManageRowFromDataGridView` (:1112-1142):
 * - an ordinary row is appended as it is;
 * - a virtual row (Data Length "-") updates the first signal on the same port
 *   and device — only its state, description, addresses and priority — and is
 *   dropped when there is none.
 * "Replace signals" first keeps only the virtual signals, renumbered
 * (`ReplaceObjectsFromExcel`, :1073-1090).
 *
 * Stricter than MAPS: an Address "-" on an ordinary row is rejected (MAPS
 * accepts it and then fails half-way through the import).
 */
export function applyKnxMbmXlsx(doc: XmlDocument, parsed: ParsedSignalsSheet, mode: ImportMode): ImportXlsxResult {
  const project = projectFromXml(doc);
  const rows = positionalRows(parsed, SIGNAL_COLUMNS, "KNX ↔ Modbus Master");
  const errors: string[] = [];
  rows.forEach((row, i) => {
    const label = `signal ${row["#"] || i + 1}`;
    for (const problem of rowProblems(project, row)) errors.push(`${label}: ${problem}`);
  });
  errors.push(...configIdProblems(rows));
  if (errors.length > 0) throw listError("Some signals have invalid values", errors);

  // Validated before touching the document, so a rejected import changes nothing.
  // On replace only the virtual signals stay, so only their conversions matter.
  const kept = mode === "replace" ? project.signals.filter((s) => s.virtual) : project.signals;
  const conversions = importedConversions({ ...project, signals: kept }, parsed);
  const removed = mode === "replace" ? removeNonVirtualSignals(doc) : 0;
  if (conversions) setConversions(doc, conversions.list);

  let appended = 0;
  let updated = 0;
  let dropped = 0;
  rows.forEach((row, i) => {
    const device = parseDeviceCell(project.mbm, row.Device ?? "");
    const knx = importedKnxEndpoint(row);
    const active = parseActive(row.Active ?? "") ?? false;
    const description = (row.Description ?? "").replace(/\0/g, "");
    if ((row["Data Length"] ?? "").trim() === "-") {
      const match = projectFromXml(doc).signals.find(
        (s) => s.modbus.port === device.port && s.modbus.deviceIndex === device.deviceIndex,
      );
      if (!match) {
        dropped += 1;
        return;
      }
      updateSignal(doc, match.id, {
        active,
        description,
        knx: {
          groupAddress: knx.groupAddress,
          ...(knx.groupAddressLevel ? { groupAddressLevel: knx.groupAddressLevel } : {}),
          additionalAddresses: knx.additionalAddresses,
          additionalAddressLevels: knx.additionalAddressLevels,
          priority: knx.priority,
        },
      });
      updated += 1;
      return;
    }
    const id = addSignal(doc);
    updateSignal(doc, id, {
      active,
      description,
      knx,
      modbus: importedModbus(row, device),
      ...(conversions ? { conversionRefs: conversions.refs[i] } : {}),
    });
    appended += 1;
  });
  return { rows: rows.length, appended, updated, removed, dropped };
}

/**
 * `InternalKnx.CheckAllowedValue` (InternalKnx.cs:1329-1424) and
 * `ExternalMbm.CheckAllowedValue` (ExternalMbm.cs:2744-2937), one message per
 * bad cell.
 */
function rowProblems(project: KnxMbmProject, row: Record<string, string>): string[] {
  const problems: string[] = [];
  const check = (column: string, valid: boolean, expected: string) => {
    if (!valid) problems.push(`${column} "${row[column] ?? ""}" is not valid (${expected})`);
  };
  const cell = (column: string) => (row[column] ?? "").trim();

  check("Active", parseActive(cell("Active")) !== undefined, "True or False");
  problems.push(...knxCellProblems(row));

  const device = parseDeviceCell(project.mbm, cell("Device"));
  check("Device", device.found, "a node and device of the project");
  const node = device.port >= 0 ? nodeDevices(project, device.port) : undefined;
  const slave = cell("# Slave");
  check(
    "# Slave",
    slave === "-" || (isUInt(slave, 0, 255) && node !== undefined && node.some((d) => d.slave === Number(slave))),
    "- or the slave number of a device on that node",
  );
  const base = cell("Base");
  const baseDevice = device.deviceIndex >= 0 ? node?.[device.deviceIndex] : undefined;
  check(
    "Base",
    BASES.includes(base) && (!baseDevice || base === "-" || base === (baseDevice.baseRegister === 1 ? "1-based" : "0-based")),
    "0-based, 1-based or -, as the device has it",
  );
  check("Read Func", FUNCTIONS.includes(cell("Read Func")), "a Modbus read function or -");
  check("Write Func", FUNCTIONS.includes(cell("Write Func")), "a Modbus write function or -");
  const virtual = cell("Data Length") === "-";
  check("Data Length", isDashOrOneOf(cell("Data Length"), [1, 16, 32, 48, 64]), "1, 16, 32, 48, 64 or -");
  check("Format", FORMATS.includes(cell("Format")), "one of the format list");
  check("ByteOrder", BYTE_ORDERS.includes(cell("ByteOrder")), BYTE_ORDERS.join(", "));
  const address = cell("Address");
  check("Address", (virtual && address === "-") || isUInt(address, 0, 65535), virtual ? "0 to 65535 or -" : "0 to 65535");
  const bitFields = cell("Format") === "4: BitFields";
  check("Bit", bitFields ? isUInt(cell("Bit"), 0, 15) : cell("Bit") === "-", bitFields ? "0 to 15" : "- unless the format is BitFields");
  check("# Bits", bitFields ? isUInt(cell("# Bits"), 1, 15) : cell("# Bits") === "-", bitFields ? "1 to 15" : "- unless the format is BitFields");
  const deadband = cell("Deadband");
  check(
    "Deadband",
    deadband === "" || deadband === "-" || (/^[\d,.]+$/.test(deadband) && Number(deadband.replace(",", ".")) <= 100),
    "a number from 0 to 100, or -",
  );
  return problems;
}

function nodeDevices(project: KnxMbmProject, port: number) {
  const rtu = project.mbm.rtuNodes;
  return port < rtu.length ? rtu[port]?.devices : project.mbm.tcpNodes[port - rtu.length]?.devices;
}

/** `ExternalMbm.ExtractObjectInfoFromRow` (ExternalMbm.cs:2271-2326) for an ordinary row. */
function importedModbus(
  row: Record<string, string>,
  device: { port: number; deviceIndex: number; isBroadcast: boolean },
): Partial<KnxMbmSignal["modbus"]> {
  const bit = (row.Bit ?? "").trim();
  const deadband = (row.Deadband ?? "").trim();
  return {
    port: device.port,
    deviceIndex: device.deviceIndex,
    isBroadcast: device.isBroadcast,
    readFunc: indexFromString(row["Read Func"] ?? "-"),
    writeFunc: indexFromString(row["Write Func"] ?? "-"),
    lenBits: indexFromString(row["Data Length"] ?? "-"),
    format: indexFromString(row.Format ?? "-"),
    byteOrder: indexFromString(row.ByteOrder ?? "-"),
    address: Number(row.Address),
    bit: bit === "-" ? -1 : Number(bit),
    numOfBits: bit === "-" ? -1 : Number(row["# Bits"]),
    ...(deadband !== "" && deadband !== "-" ? { deadband: Number(deadband.replace(",", ".")) } : {}),
  };
}
