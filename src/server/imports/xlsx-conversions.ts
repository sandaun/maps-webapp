import "server-only";
import { parseConversionCode } from "@/core/signals/conversion-code";
import type { HalfConversionRefs, SignalConversionRefs } from "@/core/signals/conversion-refs";
import { parseFloatLenient } from "@/core/xbl/conversions";
import type { Conversion, KnxMbmProject } from "@/gateway-families/knx-mbm";
import { ProjectServiceError } from "../projects/errors";
import type { ParsedSignalsSheet } from "../exports/xlsx-signals";

/** `IntesisConversion.GetTypeByString`. */
const TYPE_BY_NAME: Record<string, number> = { FILTER: 0, SCALE: 1, ARITH: 2, LOGICAL: 3, LUT_REMAP: 4 };
const MAX_LISTED_ERRORS = 10;

export interface ImportedConversions {
  /** The Excel's conversion list, which replaces the project's (`frmImport.AddConversionsToProject`). */
  list: Conversion[];
  /** Refs of each Signals row, in row order. */
  refs: SignalConversionRefs[];
}

/**
 * Conversions of a KNX–MBM Excel import, following MAPS `frmImport`: the
 * "Conversions" sheet replaces the project's list and every row's "Conv. Id"
 * is split into both halves (`ConvertStringToConversion`).
 *
 * Deliberately stricter than MAPS, which clears the list when the sheet is
 * missing, skips bad sheet rows, imports refs to missing conversions and
 * re-points the project's existing signals when the list changes. Each of those
 * cases rejects the import here instead, so nothing reaches the gateway
 * pointing at the wrong conversion.
 *
 * Returns undefined when the table has no "Conv. Id" column: its rows carry no
 * conversions and the project's list is kept.
 */
export function importedConversions(
  project: KnxMbmProject,
  parsed: ParsedSignalsSheet,
): ImportedConversions | undefined {
  const column = parsed.headers.indexOf("Conv. Id");
  if (column < 0) return undefined;
  if (!parsed.conversionRows) {
    throw new ProjectServiceError(
      422,
      'This Excel file has a "Conv. Id" column but no "Conversions" sheet, so its conversions cannot be read.',
    );
  }

  const list = readConversionSheet(parsed.conversionRows);
  const filters = list.filter((conv) => conv.type === 0).length;
  const operations = list.length - filters;

  const errors: string[] = [];
  const refs = parsed.rows.map((cells, i) => {
    const code = cells[column] ?? "";
    const label = `signal ${cells[0] || i + 1}`;
    const parsedRefs = parseConversionCode(code);
    if (!parsedRefs) {
      errors.push(`${label}: "${code}" is not a valid Conv. Id`);
    } else if (!refsExist(parsedRefs, filters, operations)) {
      errors.push(`${label}: "${code}" uses a conversion that is not in the Conversions sheet`);
    }
    return parsedRefs ?? { internal: emptyHalf(), external: emptyHalf() };
  });
  if (errors.length > 0) throw listError("Some signals have wrong conversions", errors);

  if (!sameBehaviour(project.conversions, list) && project.signals.some(hasRefs)) {
    throw new ProjectServiceError(
      422,
      "The Conversions sheet of this Excel file is different from the project's conversions. Importing it would " +
        "change the conversions of the signals the project already has, so the import was cancelled. Make both " +
        "lists match, or remove the conversions from the project's signals first.",
    );
  }
  return { list, refs };
}

/**
 * Port of `ExcelParser.CheckRowConversion`. Also requires "Idx" to be the
 * entry's position in its own list (filters, then operations), which is the
 * index signal refs resolve to — MAPS checks refs against "Idx"
 * (`CheckConversionsTable`) but resolves them by position.
 */
function readConversionSheet(rows: NonNullable<ParsedSignalsSheet["conversionRows"]>): Conversion[] {
  const errors: string[] = [];
  const list: Conversion[] = [];
  let filters = 0;
  let operations = 0;
  for (const { row, cells } of rows) {
    const [idx, description, typeName, ...params] = cells;
    const type = TYPE_BY_NAME[typeName ?? ""];
    const values = params.map((p) => (p === "" ? NaN : parseFloatLenient(p)));
    if (!/^-?[0-9]+$/.test(idx ?? "")) {
      errors.push(`row ${row}: Idx "${idx}" is not a number`);
    } else if (type === undefined) {
      errors.push(`row ${row}: Type "${typeName}" is not FILTER, SCALE, ARITH, LOGICAL or LUT_REMAP`);
    } else if (values.some((v) => !Number.isFinite(v))) {
      errors.push(`row ${row}: every Param must be a number`);
    } else {
      const position = type === 0 ? filters++ : operations++;
      if (Number(idx) !== position) {
        errors.push(`row ${row}: Idx ${idx} should be ${position}, its position among the ${type === 0 ? "filters" : "operations"}`);
      }
      list.push({
        id: Number(idx),
        description: description ?? "",
        type,
        params: values.map(String) as Conversion["params"],
      });
    }
  }
  if (errors.length > 0) throw listError("The Conversions sheet has errors", errors);
  return list;
}

function refsExist({ internal, external }: SignalConversionRefs, filters: number, operations: number): boolean {
  return [internal, external].every(
    (half) =>
      half.filters.every((ref) => ref.index < filters) && half.operations.every((ref) => ref.index < operations),
  );
}

/** Same filters and operations, in the same positions, with the same numbers (descriptions aside). */
function sameBehaviour(current: Conversion[], next: Conversion[]): boolean {
  const byList = (list: Conversion[]) => [
    ...list.filter((conv) => conv.type === 0),
    ...list.filter((conv) => conv.type !== 0),
  ];
  const a = byList(current);
  const b = byList(next);
  return (
    a.length === b.length &&
    a.every(
      (conv, i) =>
        conv.type === b[i].type &&
        conv.params.every((param, p) => parseFloatLenient(param) === parseFloatLenient(b[i].params[p])),
    )
  );
}

function hasRefs(signal: KnxMbmProject["signals"][number]): boolean {
  const { internal, external } = signal.conversions;
  return [internal, external].some((half) => half.filters.length > 0 || half.operations.length > 0);
}

function emptyHalf(): HalfConversionRefs {
  return { filters: [], operations: [] };
}

function listError(title: string, errors: string[]): ProjectServiceError {
  const shown = errors.slice(0, MAX_LISTED_ERRORS).join("; ");
  const more = errors.length > MAX_LISTED_ERRORS ? ` (and ${errors.length - MAX_LISTED_ERRORS} more)` : "";
  return new ProjectServiceError(422, `${title}: ${shown}${more}.`);
}
