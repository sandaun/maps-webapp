import "server-only";
import type { KnxMbmProject } from "@/gateway-families/knx-mbm/model";
import type { MeMbsProject } from "@/gateway-families/me-mbs/model";
import type { MbsKnxProject } from "@/gateway-families/mbs-knx/model";
import { MAPS_REFERENCE_VERSION } from "@/core/project-format";
import { ProjectServiceError } from "../projects/errors";
import {
  CONVERSION_HEADERS,
  conversionSheetRows,
  knxSignalRow,
  KNX_SIGNAL_HEADERS,
  mbsKnxSignalRow,
  MBS_KNX_SIGNAL_HEADERS,
  meSignalRow,
  ME_SIGNAL_HEADERS,
} from "./maps-grid-values";
import {
  cellText,
  loadWorkbook,
  newWorkbook,
  styleHeaderRow,
  workbookToBuffer,
  writeFileHeaders,
  writeTextRow,
} from "./xlsx-workbook";

export type SignalsXlsxFamily = "knx-mbm" | "me-mbs" | "mbs-knx";

export type SignalsXlsxProject =
  | { family: "knx-mbm"; project: KnxMbmProject }
  | { family: "me-mbs"; project: MeMbsProject }
  | { family: "mbs-knx"; project: MbsKnxProject };

/**
 * A signals table in the MAPS format (`IntesisExcel.Generate`). `mapsVersion`
 * goes in B3: the MAPS version that will import the file, which only accepts
 * its own version.
 */
export async function buildSignalsXlsx(
  input: SignalsXlsxProject,
  opts?: { now?: Date; mapsVersion?: string },
): Promise<Buffer> {
  const workbook = newWorkbook();
  const signals = workbook.addWorksheet("Signals");
  const { internal, external } = expectedProtocols(input.family);
  writeFileHeaders(signals, {
    title: "Intesis MAPS Excel signals file",
    projectName: input.project.name,
    versionLabel: "Intesis MAPS Version",
    version: opts?.mapsVersion ?? MAPS_REFERENCE_VERSION,
    internalProtocol: internal,
    externalProtocol: external,
    timestamp: opts?.now ?? new Date(),
  });
  const { headers, rows } = signalTable(input);
  writeTextRow(signals, 7, headers);
  styleHeaderRow(signals.getRow(7), headers.length);
  rows.forEach((row, i) => writeTextRow(signals, 8 + i, row));

  // MAPS only writes this sheet when the project enables conversions
  // (`IntesisExcel.CreateExcelConversions`); ME–MBS does not.
  if (input.family !== "me-mbs") {
    const conversions = workbook.addWorksheet("Conversions");
    writeTextRow(conversions, 1, [...CONVERSION_HEADERS]);
    styleHeaderRow(conversions.getRow(1), CONVERSION_HEADERS.length);
    conversionSheetRows(input.project.conversions).forEach((row, i) => writeTextRow(conversions, 2 + i, row));
  }

  return workbookToBuffer(workbook);
}

function signalTable(input: SignalsXlsxProject): { headers: string[]; rows: string[][] } {
  switch (input.family) {
    case "knx-mbm":
      return {
        headers: [...KNX_SIGNAL_HEADERS],
        rows: input.project.signals.map((s) => knxSignalRow(input.project, s)),
      };
    case "me-mbs":
      return {
        headers: [...ME_SIGNAL_HEADERS],
        rows: input.project.signals.map((s) => meSignalRow(input.project, s)),
      };
    case "mbs-knx":
      return { headers: [...MBS_KNX_SIGNAL_HEADERS], rows: input.project.signals.map(mbsKnxSignalRow) };
  }
}

/** Most signal rows one import takes (MAPS has no such limit). */
export const MAX_SIGNAL_ROWS = 5000;

export interface ParsedSignalsSheet {
  /** B3: the MAPS version that wrote the file (MAPS Web's own version in older MAPS Web files). */
  version: string;
  internalProtocol: string;
  externalProtocol: string;
  headers: string[];
  rows: string[][];
  /** Data rows of the "Conversions" sheet (7 cells each), or undefined when it is missing. */
  conversionRows?: { row: number; cells: string[] }[];
}

export async function parseSignalsXlsx(data: Uint8Array): Promise<ParsedSignalsSheet> {
  const workbook = await loadWorkbook(data);
  const sheet = workbook.getWorksheet("Signals");
  if (!sheet) throw new Error('Missing "Signals" worksheet');
  const version = cellText(sheet.getCell(3, 2).value).trim();
  const internalProtocol = cellText(sheet.getCell(4, 2).value);
  const externalProtocol = cellText(sheet.getCell(5, 2).value);
  const headerCount = Math.max(sheet.columnCount, 1);
  const headers: string[] = [];
  for (let col = 1; col <= headerCount; col++) {
    headers.push(cellText(sheet.getRow(7).getCell(col).value));
  }
  while (headers.length > 0 && headers[headers.length - 1] === "") headers.pop();
  const lastRow = sheet.rowCount;
  const rows: string[][] = [];
  for (let r = 8; r <= lastRow; r++) {
    const row = sheet.getRow(r);
    const cells = headers.map((_, i) => cellText(row.getCell(i + 1).value));
    if (cells.every((c) => c === "")) continue;
    rows.push(cells);
    // Refused before anything changes: dropping the rest would lose signals,
    // and on "Replace signals" delete the project's.
    if (rows.length > MAX_SIGNAL_ROWS) {
      throw new ProjectServiceError(
        422,
        `This Excel file has more than ${MAX_SIGNAL_ROWS} signals; MAPS Web imports up to ${MAX_SIGNAL_ROWS} at a time.`,
      );
    }
  }
  return { version, internalProtocol, externalProtocol, headers, rows, conversionRows: readConversionRows(workbook) };
}

/** `ExcelParser.ExcelImportConversions`: every used row after the header, cells 1–7. */
function readConversionRows(
  workbook: Awaited<ReturnType<typeof loadWorkbook>>,
): ParsedSignalsSheet["conversionRows"] {
  const sheet = workbook.getWorksheet("Conversions");
  if (!sheet) return undefined;
  const rows: NonNullable<ParsedSignalsSheet["conversionRows"]> = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const cells = [1, 2, 3, 4, 5, 6, 7].map((c) => cellText(row.getCell(c).value));
    if (cells.every((c) => c === "")) continue;
    rows.push({ row: r, cells });
  }
  return rows;
}

export function rowMap(headers: string[], cells: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((header, i) => {
    if (header) out[header] = cells[i] ?? "";
  });
  return out;
}

export function expectedProtocols(family: SignalsXlsxFamily): { internal: string; external: string } {
  switch (family) {
    case "knx-mbm":
      return { internal: "KNX", external: "Modbus Master" };
    case "me-mbs":
      return { internal: "Modbus Slave", external: "Mitsubishi Electric" };
    case "mbs-knx":
      return { internal: "Modbus Slave", external: "KNX" };
  }
}
