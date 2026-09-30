import "server-only";
import { XmlDocument } from "@/core/project-format";
import {
  appendImportedSignal,
  projectFromXml,
  removeAllSignals,
  setConversions,
  type ImportedSignal,
} from "@/gateway-families/mbs-knx";
import { MBS_DEFAULT_MAX_ADDRESS, type MbsReadWrite } from "@/protocols/modbus/slave";
import type { ParsedSignalsSheet } from "../exports/xlsx-signals";
import { indexFromString, MBS_KNX_SIGNAL_HEADERS } from "../exports/maps-grid-values";
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

const READ_WRITE = ["0: Read", "1: Trigger", "2: Read / Write"];

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
  const rows = positionalRows(parsed, SIGNAL_COLUMNS, "KNX ↔ Modbus Slave");
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
 * The 19 signal columns, by position, keyed by their MAPS header
 * (`MBS_KNX_SIGNAL_HEADERS`; "KNX #" for the KNX side's own "#"), with the
 * names earlier MAPS Web versions wrote. The conversion columns are found by
 * name (`importedConversions`).
 */
const EARLIER_MAPS_WEB_HEADERS: Partial<Record<number, string>> = {
  3: "Data length",
  7: "R/W",
  8: "String length",
  9: "Index",
  11: "Sending",
  12: "Listening",
};
const SIGNAL_COLUMNS: TableColumn[] = MBS_KNX_SIGNAL_HEADERS.slice(0, 19).map((header, i) => ({
  key: i === 9 ? "KNX #" : header,
  header,
  earlierHeader: EARLIER_MAPS_WEB_HEADERS[i],
}));

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

  problems.push(...knxCellProblems(row));
  return problems;
}


/** `InternalMbs.ExtractObjectInfoFromRow` + `ExternalKnx.ExtractObjectInfoFromRow`. */
function importedSignal(row: Record<string, string>): ImportedSignal {
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
    knx: importedKnxEndpoint(row),
  };
}
