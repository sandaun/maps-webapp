import "server-only";
import type { KnxEndpoint } from "@/protocols/knx";
import { groupAddressLevelOf, parseGroupAddress } from "@/protocols/knx/address";
import type { ParsedSignalsSheet } from "../exports/xlsx-signals";
import { parseDptCell, parseFlagCell, parseListening, parsePriorityCell } from "../exports/maps-grid-values";
import { listError } from "./xlsx-conversions";

/**
 * Cell checks and parsers shared by the MAPS Excel imports (MBS–KNX, KNX–MBM),
 * ported from MAPS `CheckAllowedValue` / `ExtractObjectInfoFromRow` and
 * `TypeUtils`.
 */

export const FORMATS = ["0: Unsigned", "1: Signed (C2)", "2: Signed (C1)", "3: Float", "4: BitFields", "5: String", "-"];
export const PRIORITIES = ["0: System", "1: Normal", "2: Urgent", "3: Low"];
export const FLAGS = ["U", "T", "Ri", "W", "R"] as const;

/** A table column, read by position: its MAPS header and, when different, the one earlier MAPS Web versions wrote. */
export interface TableColumn {
  key: string;
  header: string;
  earlierHeader?: string;
}

/**
 * The rows keyed by `columns[i].key`. MAPS reads a table by position
 * (`ExcelParser.PopulateDGVFromRange` + `CheckExcelRowIntegrity`), so the
 * signal columns are read by position too; a header that is neither the MAPS
 * one nor the earlier MAPS Web one means another kind of table.
 */
export function positionalRows(
  parsed: ParsedSignalsSheet,
  columns: readonly TableColumn[],
  tableName: string,
): Record<string, string>[] {
  const wrong = columns.flatMap(({ header, earlierHeader }, i) => {
    const found = parsed.headers[i] ?? "";
    return found === header || found === earlierHeader ? [] : [`column ${i + 1} is "${found}", expected "${header}"`];
  });
  if (wrong.length > 0) throw listError(`This Excel file does not have the ${tableName} columns`, wrong);
  return parsed.rows.map((cells) => Object.fromEntries(columns.map(({ key }, i) => [key, cells[i] ?? ""])));
}

/** `TypeUtils.CheckBoolean` on a text cell (`bool.TryParse`). */
export function parseActive(raw: string): boolean | undefined {
  const value = raw.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/** `TypeUtils.CheckIntegerInList`: "-" is always accepted. */
export function isDashOrOneOf(raw: string, values: number[]): boolean {
  return raw === "-" || (/^-?\d+$/.test(raw.trim()) && values.includes(Number(raw)));
}

/** `TypeUtils.CheckUInt32` within a range. */
export function isUInt(raw: string, min: number, max: number): boolean {
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
export function isValidDptCell(raw: string): boolean {
  const match = /^(\d+)\.(x|\d+)$/.exec((raw.split(":")[0] ?? "").trim());
  if (!match) return false;
  const main = Number(match[1]);
  if (main === 0 || main > 255) return false;
  if (match[2] === "x") return true;
  const sub = Number(match[2]);
  return sub <= 254 && (sub !== 0 || main === 14);
}

/** `IntesisKnx.ConvertStringToKNXAddress`: a group address above 0 ("0/0/0" is not one). */
function isGroupAddress(raw: string): boolean {
  return (parseGroupAddress(raw) ?? 0) > 0;
}

/** The KNX cells of a row (`InternalKnx` / `ExternalKnx.CheckAllowedValue`), one message per bad cell. */
export function knxCellProblems(row: Record<string, string>): string[] {
  const problems: string[] = [];
  const check = (column: string, valid: boolean, expected: string) => {
    if (!valid) problems.push(`${column} "${row[column] ?? ""}" is not valid (${expected})`);
  };
  const cell = (column: string) => row[column] ?? "";
  check("DPT", isValidDptCell(cell("DPT")), "a DPT such as 1.001 or 9.x");
  const sending = cell("Group Address");
  check("Group Address", sending === "" || isGroupAddress(sending), "a group address or empty");
  const listening = cell("Additional Addresses");
  check(
    "Additional Addresses",
    listening === "" || listening.split(",").every(isGroupAddress),
    "group addresses separated by commas, or empty",
  );
  for (const column of FLAGS) {
    const value = cell(column).trim();
    check(column, value === "" || value === column, `${column} or empty`);
  }
  check("Priority", PRIORITIES.includes(cell("Priority")), PRIORITIES.join(", "));
  return problems;
}

/** The KNX side of a row as MAPS reads it back (`ExtractObjectInfoFromRow`). */
export function importedKnxEndpoint(row: Record<string, string>): KnxEndpoint {
  const sendingText = (row["Group Address"] ?? "").trim();
  const sending = parseGroupAddress(sendingText) ?? 0;
  const listening = parseListening(row["Additional Addresses"] ?? "");
  return {
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
  };
}

/** `frmImport.CheckConfigIdConsecutivity`: "#" is an integer, one more than the previous row's. */
export function configIdProblems(rows: Record<string, string>[]): string[] {
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
