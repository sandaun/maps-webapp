import ExcelJS from "exceljs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import packageJson from "../../../package.json";

/** MAPS Web's own version, independent of the MAPS version a file targets. */
export const APP_VERSION: string = packageJson.version;

const CORAL = "FFF08080";
const GRAY = "FFD3D3D3";

/** A workbook that names MAPS Web as its author, in the file properties MAPS does not read. */
export function newWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = `MAPS Web ${APP_VERSION}`;
  workbook.lastModifiedBy = workbook.creator;
  return workbook;
}

export function styleHeaderRow(row: ExcelJS.Row, columnCount: number): void {
  for (let col = 1; col <= columnCount; col++) {
    const cell = row.getCell(col);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CORAL } };
    cell.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };
    cell.font = { bold: true };
  }
}

/**
 * The rows above a table (`IntesisExcel.WriteFileHeaders`). MAPS reads the
 * version cell (B3) on import and refuses a file unless it is its own
 * version (`ExcelParser.ExcelScanInformation`).
 */
export function writeFileHeaders(
  sheet: ExcelJS.Worksheet,
  opts: {
    title: string;
    projectName: string;
    versionLabel: string;
    version: string;
    internalProtocol: string;
    externalProtocol?: string;
    /** A date is written as MAPS does: an Excel date in the short date format (built-in 14). */
    timestamp: string | Date;
  },
): void {
  sheet.getCell(1, 1).value = opts.title;
  sheet.getCell(2, 1).value = "PROJECT_NAME";
  sheet.getCell(2, 2).value = opts.projectName;
  sheet.getCell(3, 1).value = opts.versionLabel;
  sheet.getCell(3, 2).value = opts.version;
  sheet.getCell(4, 1).value = "Internal Protocol";
  sheet.getCell(4, 2).value = opts.internalProtocol;
  let last = 4;
  if (opts.externalProtocol !== undefined) {
    sheet.getCell(5, 1).value = "External Protocol";
    sheet.getCell(5, 2).value = opts.externalProtocol;
    last = 5;
  }
  sheet.getCell(last + 1, 1).value = "Timestamp";
  const timestamp = sheet.getCell(last + 1, 2);
  if (opts.timestamp instanceof Date) {
    // ExcelJS stores dates as UTC serials: keep the local calendar day.
    const day = opts.timestamp;
    timestamp.value = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()));
    timestamp.numFmt = "mm-dd-yy";
  } else {
    timestamp.value = opts.timestamp;
  }
  for (let row = 2; row <= last + 1; row++) {
    sheet.getCell(row, 1).font = { bold: true };
    for (const col of [1, 2]) {
      const cell = sheet.getCell(row, col);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY } };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    }
  }
}

export function writeTextRow(sheet: ExcelJS.Worksheet, rowNumber: number, values: string[]): void {
  for (let i = 0; i < values.length; i++) {
    const cell = sheet.getCell(rowNumber, i + 1);
    cell.value = values[i];
    cell.numFmt = "@";
  }
}

export function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value == null) return "";
  if (typeof value === "string") return stripTick(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return stripTick(value.richText.map((part) => part.text).join(""));
    }
    if ("text" in value && typeof value.text === "string") return stripTick(value.text);
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("formula" in value && "result" in value) return cellText(value.result as ExcelJS.CellValue);
  }
  return stripTick(String(value));
}

function stripTick(raw: string): string {
  return raw.replace(/^'/, "").trim();
}

export async function workbookToBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function loadWorkbook(data: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(withDefaultNamespaces(data) as unknown as ExcelJS.Buffer);
  return workbook;
}

/** Namespaces ExcelJS reads only as the default one (it wants `cp:`/`dc:` in core.xml). */
const DEFAULT_ONLY_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
]);

/**
 * MAPS writes its Excel files with the OpenXML SDK, which prefixes the
 * elements of each part (`<x:worksheet xmlns:x="…">`, `<ap:Properties>`).
 * ExcelJS fails on those files, so a part whose root is prefixed with one of
 * `DEFAULT_ONLY_NAMESPACES` gets it as its default namespace. Files without
 * prefixes, like the ones Excel or ExcelJS write, are unchanged.
 */
function withDefaultNamespaces(data: Uint8Array): Uint8Array {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    return data; // Not a zip: let ExcelJS report it.
  }
  let changed = false;
  for (const [name, bytes] of Object.entries(files)) {
    if (!name.endsWith(".xml")) continue;
    const xml = strFromU8(bytes);
    const root = /^\uFEFF?(?:<\?xml[^>]*\?>\s*)?<([A-Za-z][\w.-]*):[^\s>]+([^>]*)>/.exec(xml);
    if (!root || / xmlns=/.test(root[2])) continue;
    const prefix = root[1];
    const uri = new RegExp(`xmlns:${prefix}="([^"]*)"`).exec(root[2])?.[1];
    if (!uri || !DEFAULT_ONLY_NAMESPACES.has(uri)) continue;
    files[name] = strToU8(
      xml.replace(new RegExp(`<(/?)${prefix}:`, "g"), "<$1").replace(`xmlns:${prefix}=`, "xmlns="),
    );
    changed = true;
  }
  return changed ? zipSync(files) : data;
}
