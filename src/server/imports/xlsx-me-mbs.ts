import "server-only";
import { XmlDocument } from "@/core/project-format";
import { projectFromXml, updateSignal, type MeMbsSignal } from "@/gateway-families/me-mbs";
import { ADDRESS_MODES } from "@/protocols/modbus/slave";
import type { ParsedSignalsSheet } from "../exports/xlsx-signals";
import { ME_SIGNAL_HEADERS } from "../exports/maps-grid-values";
import { ProjectServiceError } from "../projects/errors";
import { configIdProblems, FORMATS, isDashOrOneOf, isUInt, parseActive, positionalRows, type TableColumn } from "./xlsx-cells";
import { listError } from "./xlsx-conversions";
import type { ImportMode, ImportXlsxResult } from "./xlsx-signals";

/** `InternalMbs` max address for this project (`new InternalMbs(..., 82500)`, IntesisProjectMbsMe_RT.cs:264). */
const MAX_ADDRESS = 82500;
const READ_WRITE = ["0: Read", "1: Trigger", "2: Read / Write", "-"];

/** The 14 columns, by position, keyed by their MAPS header ("ME #" for the ME side's own "#"). */
const COLUMNS: TableColumn[] = ME_SIGNAL_HEADERS.map((header, i) => ({ key: i === 9 ? "ME #" : header, header }));

/**
 * ME–MBS Excel import, like MAPS: the signals are generated from the
 * controllers and groups, so MAPS only offers "Replace signals" (`IsFixedRows`)
 * and `ReplaceObjectsFromExcel` (IntesisProjectMbsMe_RT.cs:3322-3343) adds no
 * signal. Every row is checked first (`CheckExcelRowIntegrity`, :3345-3387, and
 * `frmImport.CheckConfigIdConsecutivity`), one bad row rejecting the file;
 * then `RestoreUserConfig` (:3146-3163) finds, for each row in order, the first
 * signal with the same controller, group, unit, indoor flag, signal and spec
 * index, and restores its state and — in CUSTOM address mode — its address.
 * Rows that match nothing are ignored.
 *
 * Stricter than MAPS: text MAPS cannot parse (a Group or Controller cell it
 * would throw on) is reported as a bad cell instead of failing the read. An
 * address above 32767 is kept, where MAPS would wrap it into a negative
 * `short`.
 */
export function applyMeMbsXlsx(doc: XmlDocument, parsed: ParsedSignalsSheet, mode: ImportMode): ImportXlsxResult {
  if (mode !== "replace") {
    throw new ProjectServiceError(
      422,
      'Mitsubishi Electric AC ↔ Modbus Slave signals are generated from the controllers and groups: MAPS only imports their table with "Replace signals".',
    );
  }
  const project = projectFromXml(doc);
  const rows = positionalRows(parsed, COLUMNS, "Mitsubishi Electric AC ↔ Modbus Slave");
  const errors: string[] = [];
  rows.forEach((row, i) => {
    const label = `signal ${row["#"] || i + 1}`;
    for (const problem of rowProblems(project.signals, row)) errors.push(`${label}: ${problem}`);
  });
  errors.push(...configIdProblems(rows));
  if (errors.length > 0) throw listError("Some signals have invalid values", errors);

  const custom = project.mbs.addressMode === ADDRESS_MODES.CUSTOM;
  let updated = 0;
  let ignored = 0;
  for (const row of rows) {
    const key = meKey(row)!;
    const match = project.signals.find(
      (s) =>
        s.me.groupIndex === key.groupIndex &&
        s.me.unitId === key.unitId &&
        s.me.isIndoor === key.isIndoor &&
        s.me.signalIndex === key.signalIndex &&
        s.me.signalSpecIndex === key.signalSpecIndex &&
        s.me.g50Index === key.g50Index,
    );
    if (!match) {
      ignored += 1;
      continue;
    }
    const address = (row.Address ?? "").trim();
    updateSignal(doc, match.id, {
      active: parseActive(row.Active ?? "") ?? false,
      ...(custom ? { modbus: { address: address === "" ? 0 : Number(address) } } : {}),
    });
    updated += 1;
  }
  return { rows: rows.length, appended: 0, updated, ignored };
}

/**
 * `InternalMbs.CheckAllowedValue` (InternalMbs.cs:1918-1993), the ME cells as
 * `new MeObject(row)` parses them (MeObject.cs:65-88), and the
 * `error_noObjectsSignal` check (ExternalME.cs:138-160).
 */
function rowProblems(signals: MeMbsSignal[], row: Record<string, string>): string[] {
  const problems: string[] = [];
  const check = (column: string, valid: boolean, expected: string) => {
    if (!valid) problems.push(`${column} "${row[column] ?? ""}" is not valid (${expected})`);
  };
  const cell = (column: string) => (row[column] ?? "").trim();

  const active = parseActive(cell("Active"));
  check("Active", active !== undefined, "True or False");
  check("Data Length", isDashOrOneOf(cell("Data Length"), [1, 16, 32, 64]), "1, 16, 32, 64 or -");
  check("Format", FORMATS.includes(cell("Format")), "one of the format list");
  // MAPS reads an empty address of an inactive row as 0.
  check(
    "Address",
    (active === false && cell("Address") === "") || isUInt(cell("Address"), 0, MAX_ADDRESS),
    `0 to ${MAX_ADDRESS}`,
  );
  check("Bit", cell("Bit") === "-" || isUInt(cell("Bit"), 0, 15), "0 to 15 or -");
  check("Read / Write", READ_WRITE.includes(cell("Read / Write")), READ_WRITE.join(", "));
  check("String Length", isDashOrOneOf(cell("String Length"), [20, 26]), "20, 26 or -");

  check("ME #", /^-?\d+$/.test(cell("ME #")), "a number");
  check("Group", groupKey(cell("Group")) !== undefined, '"-", "G<n>", "G<n> - <name>", "Indoor Unit <n>" or "Outdoor Unit <n>"');
  check("Controller", controllerIndex(cell("Controller")) !== undefined, '"-" or "Controller <n>"');
  check("Sig Specific Index", indexCell(cell("Sig Specific Index")) !== undefined, "a number or -");
  check("Sig Internal Index", indexCell(cell("Sig Internal Index")) !== undefined, "a number or -");

  const key = meKey(row);
  if (
    key &&
    !signals.some(
      (s) => s.me.g50Index === key.g50Index && s.me.signalIndex === key.signalIndex && s.me.signalSpecIndex === key.signalSpecIndex,
    )
  ) {
    problems.push("there are no objects for this signal in the project");
  }
  return problems;
}

/** The `RestoreUserConfig` key of a row, or undefined when a cell cannot be parsed. */
function meKey(row: Record<string, string>) {
  const group = groupKey((row.Group ?? "").trim());
  const g50Index = controllerIndex((row.Controller ?? "").trim());
  const signalSpecIndex = indexCell((row["Sig Specific Index"] ?? "").trim());
  const signalIndex = indexCell((row["Sig Internal Index"] ?? "").trim());
  if (!group || g50Index === undefined || signalSpecIndex === undefined || signalIndex === undefined) return undefined;
  return { ...group, g50Index, signalSpecIndex, signalIndex };
}

/**
 * `IntesisMe.GetGroupIdFromGroupName` / `GetUnidIdxFromUnitName` /
 * `GetIndoorFlagFromUnitName` (IntesisMe.cs:728-763).
 */
function groupKey(value: string): { groupIndex: number; unitId: number; isIndoor: boolean } | undefined {
  if (value === "-") return { groupIndex: -1, unitId: -1, isIndoor: false };
  const unit = /^(Indoor|Outdoor) Unit (\d+)$/.exec(value);
  if (unit) {
    const n = Number(unit[2]) + (unit[1] === "Outdoor" ? 50 : 0);
    return { groupIndex: -1, unitId: n - 1, isIndoor: unit[1] === "Indoor" };
  }
  const group = /^G(\d+)(?: - .*)?$/.exec(value);
  if (!group) return undefined;
  return { groupIndex: Number(group[1]) - 1, unitId: -1, isIndoor: false };
}

/** `IntesisMe.GetIndexFromControllerName` (IntesisMe.cs:765-773): "Controller N" → N - 1. */
function controllerIndex(value: string): number | undefined {
  if (value === "-") return -1;
  const match = /^\S+ (\d+)$/.exec(value);
  return match ? Number(match[1]) - 1 : undefined;
}

/** "-" → -1, otherwise an integer (`Convert.ToInt32`). */
function indexCell(value: string): number | undefined {
  if (value === "-") return -1;
  return /^-?\d+$/.test(value) ? Number(value) : undefined;
}
