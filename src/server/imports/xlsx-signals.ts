import "server-only";
import { XmlDocument } from "@/core/project-format";
import { addSignal as meAddSignal, updateSignal as meUpdateSignal } from "@/gateway-families/me-mbs";
import { ProjectServiceError } from "../projects/errors";
import {
  expectedProtocols,
  parseSignalsXlsx,
  rowMap,
  type ParsedSignalsSheet,
  type SignalsXlsxFamily,
} from "../exports/xlsx-signals";
import { applyKnxMbmXlsx } from "./xlsx-knx-mbm";
import { applyMbsKnxXlsx } from "./xlsx-mbs-knx";
import { indexFromString, ME_SIGNAL_HEADERS, parseBoolCell } from "../exports/maps-grid-values";

/** MAPS `frmImport`: "Add signals" (`ImportExcelMode.ADD`) or "Replace signals" (`REPLACE`). */
export type ImportMode = "add" | "replace";

export interface ImportXlsxResult {
  rows: number;
  appended: number;
  updated: number;
  /** Signals removed first by a "Replace signals" import. */
  removed?: number;
  /** KNX–MBM virtual rows with no signal on their port and device, which MAPS drops. */
  dropped?: number;
  /** B3 of the file: the MAPS version that wrote it. */
  fileVersion?: string;
}

/**
 * Apply a MAPS Excel signal table like `AddObjectsFromExcel` /
 * `ManageRowFromDataGridView`: append ordinary rows; in KNX–MBM, virtual rows
 * (data length `-`) update the matching virtual signal. MBS–KNX: `xlsx-mbs-knx.ts`.
 */
export async function applySignalsXlsx(
  doc: XmlDocument,
  family: SignalsXlsxFamily,
  data: Uint8Array,
  mode: ImportMode = "add",
): Promise<ImportXlsxResult> {
  const parsed = await parseSignalsXlsx(data);
  const expected = expectedProtocols(family);
  if (
    (parsed.internalProtocol && parsed.internalProtocol !== expected.internal) ||
    (parsed.externalProtocol && parsed.externalProtocol !== expected.external)
  ) {
    throw new ProjectServiceError(
      422,
      `This Excel file is ${parsed.internalProtocol} ↔ ${parsed.externalProtocol}, not a ${expected.internal} ↔ ${expected.external} table.`,
    );
  }
  return { ...applyFamily(doc, family, parsed, mode), fileVersion: parsed.version };
}

function applyFamily(
  doc: XmlDocument,
  family: SignalsXlsxFamily,
  parsed: ParsedSignalsSheet,
  mode: ImportMode,
): ImportXlsxResult {
  if (family === "mbs-knx") return applyMbsKnxXlsx(doc, parsed, mode);
  if (family === "knx-mbm") return applyKnxMbmXlsx(doc, parsed, mode);
  if (mode === "replace") {
    throw new ProjectServiceError(422, '"Replace signals" is not available yet for this kind of project.');
  }
  requireHeaders(parsed, ME_SIGNAL_HEADERS);
  return applyMe(doc, parsed.headers, parsed.rows);
}

/**
 * ME–MBS reads the columns by our header names, so a table with other names
 * (one exported by MAPS desktop) would import default values. Such a table is
 * rejected instead.
 */
function requireHeaders(parsed: ParsedSignalsSheet, expected: readonly string[]): void {
  const missing = expected.filter(
    (header) => header !== "Conv. Id" && header !== "Conversions" && !parsed.headers.includes(header),
  );
  if (missing.length === 0) return;
  throw new ProjectServiceError(
    422,
    `This Excel file does not have the columns ${missing.map((h) => `"${h}"`).join(", ")}. ` +
      "Tables exported by MAPS desktop cannot be imported yet for this kind of project.",
  );
}

function applyMe(doc: XmlDocument, headers: string[], rows: string[][]): ImportXlsxResult {
  let appended = 0;
  for (const cells of rows) {
    const row = rowMap(headers, cells);
    const id = meAddSignal(doc);
    meUpdateSignal(doc, id, {
      active: parseBoolCell(row.Active ?? "True"),
      description: row.Description ?? "",
      me: {
        g50Index: Number(row.Controller || 0),
        groupIndex: Number(row.Group || -1),
        unitId: Number(row.Unit || -1),
        signalSpecIndex: Number(row.Spec || 0),
        isStatus: parseBoolCell(row.Status ?? "False"),
      },
      modbus: {
        lenBits: indexFromString(row["Data length"] || "16"),
        format: indexFromString(row.Format ?? "0: Unsigned"),
        address: Number(row.Address || 0),
        bit: dashToNumber(row.Bit),
        readWrite: indexFromString(row["R/W"] ?? "0: Read") as 0 | 1 | 2,
        stringLength: dashToNumber(row["String length"]),
      },
    });
    appended += 1;
  }
  return { rows: rows.length, appended, updated: 0 };
}

function dashToNumber(raw: string | undefined): number {
  if (raw == null || raw.trim() === "" || raw.trim() === "-") return -1;
  const n = Number(raw);
  return Number.isFinite(n) ? n : -1;
}
