import "server-only";
import { XmlDocument } from "@/core/project-format";
import {
  appendImportedSignal,
  projectFromXml,
  removeAllSignals,
  setConversions,
  type ImportedSignal,
} from "@/gateway-families/mbs-knx";
import { groupAddressLevelOf, parseGroupAddress } from "@/protocols/knx/address";
import { MBS_DEFAULT_MAX_ADDRESS, type MbsReadWrite } from "@/protocols/modbus/slave";
import type { ParsedSignalsSheet } from "../exports/xlsx-signals";
import {
  indexFromString,
  MBS_KNX_SIGNAL_HEADERS,
  parseDptCell,
  parseFlagCell,
  parseListening,
  parsePriorityCell,
} from "../exports/maps-grid-values";
import { importedConversions, listError } from "./xlsx-conversions";
import type { ImportMode, ImportXlsxResult } from "./xlsx-signals";

const FORMATS = ["0: Unsigned", "1: Signed (C2)", "2: Signed (C1)", "3: Float", "4: BitFields", "5: String", "-"];
const READ_WRITE = ["0: Read", "1: Trigger", "2: Read / Write"];
const PRIORITIES = ["0: System", "1: Normal", "2: Urgent", "3: Low"];
const FLAGS = ["U", "T", "Ri", "W", "R"] as const;

/**
 * MBS–KNX Excel import, like MAPS `frmImport`: every row is checked first
 * (`IntesisProjectMBSKNX_RT.CheckExcelRowIntegrity`, :896-930, and
 * `frmImport.CheckConfigIdConsecutivity`) and one bad row rejects the whole
 * file; then each row is appended as it is (`AddObjectsFromExcel`, :875-894).
 * "Replace signals" first removes every signal of both sides, fixed ones
 * included (`ReplaceObjectsFromExcel`, :868-873).
 *
 * Stricter than MAPS in one case: R/W "-" (`MbsReadWrite.NOT_DEFINED`) is
 * rejected, because the grid has no such value to show or edit.
 */
export function applyMbsKnxXlsx(doc: XmlDocument, parsed: ParsedSignalsSheet, mode: ImportMode): ImportXlsxResult {
  const rows = signalRows(parsed);
  const errors: string[] = [];
  rows.forEach((row, i) => {
    const label = `signal ${row["#"] || i + 1}`;
    for (const problem of rowProblems(row)) errors.push(`${label}: ${problem}`);
  });
  errors.push(...configIdProblems(rows));
  if (errors.length > 0) throw listError("Some signals have invalid values", errors);

  // Validated before touching the document, so a rejected import changes nothing.
  // On replace the project's signals go away, so their conversions cannot be
  // affected by a new list.
  const project = projectFromXml(doc);
  const conversions = importedConversions(mode === "replace" ? { ...project, signals: [] } : project, parsed);
  const removed = mode === "replace" ? removeAllSignals(doc) : 0;
  if (conversions) setConversions(doc, conversions.list);
  rows.forEach((row, i) => {
    appendImportedSignal(doc, {
      ...importedSignal(row),
      ...(conversions ? { conversionRefs: conversions.refs[i] } : {}),
    });
  });
  return { rows: rows.length, appended: rows.length, updated: 0, removed };
}

/**
 * The 19 signal columns, by position: each row is keyed by the MAPS header
 * (`MBS_KNX_SIGNAL_HEADERS`; "KNX #" for the KNX side's own "#").
 * Tables exported by earlier MAPS Web versions used other names, still accepted.
 */
const SIGNAL_COLUMNS = MBS_KNX_SIGNAL_HEADERS.slice(0, 19);
const COLUMN_KEYS = SIGNAL_COLUMNS.map((header, i) => (i === 9 ? "KNX #" : header));
const EARLIER_MAPS_WEB_HEADERS: Partial<Record<number, string>> = {
  3: "Data length",
  7: "R/W",
  8: "String length",
  9: "Index",
  11: "Sending",
  12: "Listening",
};

/**
 * The rows keyed by `COLUMN_KEYS`. MAPS reads the table by position
 * (`CheckExcelRowIntegrity` splits each row at `InternalMbs.ColumnsCount`), so
 * the signal columns are read by position too. The conversion columns are
 * found by name (`importedConversions`).
 */
function signalRows(parsed: ParsedSignalsSheet): Record<string, string>[] {
  const wrong = SIGNAL_COLUMNS.flatMap((header, i) => {
    const found = parsed.headers[i] ?? "";
    return found === header || found === EARLIER_MAPS_WEB_HEADERS[i]
      ? []
      : [`column ${i + 1} is "${found}", expected "${header}"`];
  });
  if (wrong.length > 0) throw listError("This Excel file does not have the KNX ↔ Modbus Slave columns", wrong);
  return parsed.rows.map((cells) => Object.fromEntries(COLUMN_KEYS.map((key, i) => [key, cells[i] ?? ""])));
}

/**
 * `InternalMbs.CheckThisExcelRow` / `CheckAllowedValue` (InternalMbs.cs:639-667,
 * :1918-1990) and `ExternalKnx.CheckThisExcelRow` / `CheckAllowedValue`
 * (ExternalKnx.cs:265-284, :1448-1520), one message per bad cell.
 */
function rowProblems(row: Record<string, string>): string[] {
  const problems: string[] = [];
  const check = (column: string, valid: boolean, expected: string) => {
    if (!valid) problems.push(`${column} "${row[column] ?? ""}" is not valid (${expected})`);
  };
  const cell = (column: string) => row[column] ?? "";

  const active = parseActive(cell("Active"));
  check("Active", active !== undefined, "True or False");
  check("Data Length", isDashOrOneOf(cell("Data Length"), [1, 16, 32, 64]), "1, 16, 32, 64 or -");
  check("Format", FORMATS.includes(cell("Format")), "one of the format list");
  // MAPS reads an empty address of an inactive row as 0.
  check(
    "Address",
    (active === false && cell("Address") === "") || isUInt(cell("Address"), 0, MBS_DEFAULT_MAX_ADDRESS),
    `0 to ${MBS_DEFAULT_MAX_ADDRESS}`,
  );
  check("Bit", cell("Bit") === "-" || isUInt(cell("Bit"), 0, 15), "0 to 15 or -");
  check("Read / Write", READ_WRITE.includes(cell("Read / Write")), READ_WRITE.join(", "));
  check("String Length", isDashOrOneOf(cell("String Length"), [20, 26]), "20, 26 or -");

  check("DPT", isValidDptCell(cell("DPT")), "a DPT such as 1.001 or 9.x");
  const sending = cell("Group Address");
  check("Group Address", sending === "" || parseGroupAddress(sending) !== undefined, "a group address or empty");
  const listening = cell("Additional Addresses");
  check(
    "Additional Addresses",
    listening === "" || listening.split(",").every((address) => parseGroupAddress(address) !== undefined),
    "group addresses separated by commas, or empty",
  );
  for (const column of FLAGS) {
    const value = cell(column).trim();
    check(column, value === "" || value === column, `${column} or empty`);
  }
  check("Priority", PRIORITIES.includes(cell("Priority")), PRIORITIES.join(", "));
  return problems;
}

/** `frmImport.CheckConfigIdConsecutivity`: "#" is an integer, one more than the previous row's. */
function configIdProblems(rows: Record<string, string>[]): string[] {
  const problems: string[] = [];
  let expected: number | undefined;
  for (const [i, row] of rows.entries()) {
    const raw = (row["#"] ?? "").trim();
    if (!/^-?\d+$/.test(raw)) {
      problems.push(`row ${i + 1}: "#" "${raw}" is not an integer`);
      continue;
    }
    const id = Number(raw);
    if (expected !== undefined && id !== expected) {
      problems.push(`signal ${id}: "#" is not in order, expected ${expected}`);
    }
    expected = (expected ?? id) + 1;
  }
  return problems;
}

/** `InternalMbs.ExtractObjectInfoFromRow` + `ExternalKnx.ExtractObjectInfoFromRow`. */
function importedSignal(row: Record<string, string>): ImportedSignal {
  const sendingText = (row["Group Address"] ?? "").trim();
  const sending = parseGroupAddress(sendingText) ?? 0;
  const listening = parseListening(row["Additional Addresses"] ?? "");
  return {
    active: parseActive(row.Active ?? "") ?? false,
    description: (row.Description ?? "").replace(/\0/g, ""),
    modbus: {
      lenBits: indexFromString(row["Data Length"] ?? ""),
      format: indexFromString(row.Format ?? ""),
      address: row.Address ? Number(row.Address) : 0,
      bit: row.Bit === "-" ? -1 : Number(row.Bit),
      readWrite: indexFromString(row["Read / Write"] ?? "") as MbsReadWrite,
      stringLength: indexFromString(row["String Length"] ?? ""),
    },
    knx: {
      dpt: parseDptCell(row.DPT ?? "") ?? 0,
      groupAddress: sending,
      ...(sending > 0 ? { groupAddressLevel: groupAddressLevelOf(sendingText) } : {}),
      additionalAddresses: listening.addresses,
      additionalAddressLevels: listening.levels,
      flags: {
        u: parseFlagCell(row.U ?? "", "U"),
        t: parseFlagCell(row.T ?? "", "T"),
        ri: parseFlagCell(row.Ri ?? "", "Ri"),
        w: parseFlagCell(row.W ?? "", "W"),
        r: parseFlagCell(row.R ?? "", "R"),
      },
      priority: parsePriorityCell(row.Priority ?? ""),
    },
  };
}

/** `TypeUtils.CheckBoolean` on a text cell (`bool.TryParse`). */
function parseActive(raw: string): boolean | undefined {
  const value = raw.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/** `TypeUtils.CheckIntegerInList`: "-" is always accepted. */
function isDashOrOneOf(raw: string, values: number[]): boolean {
  return raw === "-" || (/^-?\d+$/.test(raw.trim()) && values.includes(Number(raw)));
}

/** `TypeUtils.CheckUInt32` within a range. */
function isUInt(raw: string, min: number, max: number): boolean {
  if (!/^\d+$/.test(raw.trim())) return false;
  const n = Number(raw);
  return n >= min && n <= max;
}

/**
 * `IntesisKnx.IsValidDPT` (IntesisKnx.cs:1573-1600) on the cell's own text:
 * "main.sub" before any ":", main above 0 and sub a number or "x"; sub 0 only
 * for DPT 14. Stricter than MAPS on the range: main and sub must fit their
 * byte (sub up to 254, 255 is "x"), where MAPS would carry the excess into
 * another DPT when encoding it.
 */
function isValidDptCell(raw: string): boolean {
  const match = /^(\d+)\.(x|\d+)$/.exec((raw.split(":")[0] ?? "").trim());
  if (!match) return false;
  const main = Number(match[1]);
  if (main === 0 || main > 255) return false;
  if (match[2] === "x") return true;
  const sub = Number(match[2]);
  return sub <= 254 && (sub !== 0 || main === 14);
}
