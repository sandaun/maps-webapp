import "server-only";
import { XmlDocument } from "@/core/project-format";
import { ProjectServiceError } from "../projects/errors";
import {
  expectedProtocols,
  parseSignalsXlsx,
  type ParsedSignalsSheet,
  type SignalsXlsxFamily,
} from "../exports/xlsx-signals";
import { applyKnxMbmXlsx } from "./xlsx-knx-mbm";
import { applyMbsKnxXlsx } from "./xlsx-mbs-knx";
import { applyMeMbsXlsx } from "./xlsx-me-mbs";

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
  /** ME–MBS rows that match no generated signal, which MAPS ignores. */
  ignored?: number;
  /** B3 of the file: the MAPS version that wrote it. */
  fileVersion?: string;
}

/**
 * Apply a MAPS Excel signal table (`frmImport`): the family's importer checks
 * every row and applies them like MAPS — `xlsx-mbs-knx.ts`, `xlsx-knx-mbm.ts`,
 * `xlsx-me-mbs.ts`.
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
  return applyMeMbsXlsx(doc, parsed, mode);
}
