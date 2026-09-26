import "server-only";
import type { KnxMbmProject } from "@/gateway-families/knx-mbm/model";
import type { MeMbsProject } from "@/gateway-families/me-mbs/model";
import {
  CONVERSION_HEADERS,
  conversionSheetRows,
  knxSignalRow,
  KNX_SIGNAL_HEADERS,
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

const APP_VERSION = "0.1.0";

export async function buildSignalsXlsx(
  family: "knx-mbm" | "me-mbs",
  project: KnxMbmProject | MeMbsProject,
  opts?: { now?: Date },
): Promise<Buffer> {
  const workbook = newWorkbook();
  const signals = workbook.addWorksheet("Signals");
  const timestamp = (opts?.now ?? new Date()).toLocaleDateString();
  const internal = family === "knx-mbm" ? "KNX" : "Modbus Slave";
  const external = family === "knx-mbm" ? "Modbus Master" : "Mitsubishi Electric";
  writeFileHeaders(signals, {
    title: "MAPS Web Excel signals file",
    projectName: project.name,
    version: APP_VERSION,
    internalProtocol: internal,
    externalProtocol: external,
    timestamp,
  });
  const headers = family === "knx-mbm" ? [...KNX_SIGNAL_HEADERS] : [...ME_SIGNAL_HEADERS];
  writeTextRow(signals, 7, headers);
  styleHeaderRow(signals.getRow(7), headers.length);

  const rows =
    family === "knx-mbm"
      ? (project as KnxMbmProject).signals.map((s) => knxSignalRow(project as KnxMbmProject, s))
      : (project as MeMbsProject).signals.map((s) => meSignalRow(project as MeMbsProject, s));
  rows.forEach((row, i) => writeTextRow(signals, 8 + i, row));

  // MAPS only writes this sheet when the project enables conversions
  // (`IntesisExcel.CreateExcelConversions`); ME–MBS does not.
  if (family === "knx-mbm") {
    const conversions = workbook.addWorksheet("Conversions");
    writeTextRow(conversions, 1, [...CONVERSION_HEADERS]);
    styleHeaderRow(conversions.getRow(1), CONVERSION_HEADERS.length);
    conversionSheetRows(project.conversions).forEach((row, i) => writeTextRow(conversions, 2 + i, row));
  }

  return workbookToBuffer(workbook);
}

export interface ParsedSignalsSheet {
  internalProtocol: string;
  externalProtocol: string;
  headers: string[];
  rows: string[][];
}

export async function parseSignalsXlsx(data: Uint8Array): Promise<ParsedSignalsSheet> {
  const workbook = await loadWorkbook(data);
  const sheet = workbook.getWorksheet("Signals");
  if (!sheet) throw new Error('Missing "Signals" worksheet');
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
    if (rows.length >= 5000) break;
  }
  return { internalProtocol, externalProtocol, headers, rows };
}

export function rowMap(headers: string[], cells: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((header, i) => {
    if (header) out[header] = cells[i] ?? "";
  });
  return out;
}

export function expectedProtocols(family: "knx-mbm" | "me-mbs"): { internal: string; external: string } {
  return family === "knx-mbm"
    ? { internal: "KNX", external: "Modbus Master" }
    : { internal: "Modbus Slave", external: "Mitsubishi Electric" };
}
