import ExcelJS from "exceljs";

const CORAL = "FFF08080";
const GRAY = "FFD3D3D3";

export function newWorkbook(): ExcelJS.Workbook {
  return new ExcelJS.Workbook();
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

export function writeFileHeaders(
  sheet: ExcelJS.Worksheet,
  opts: {
    title: string;
    projectName: string;
    version: string;
    internalProtocol: string;
    externalProtocol?: string;
    timestamp: string;
  },
): void {
  sheet.getCell(1, 1).value = opts.title;
  sheet.getCell(2, 1).value = "PROJECT_NAME";
  sheet.getCell(2, 2).value = opts.projectName;
  sheet.getCell(3, 1).value = "MAPS Web Version";
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
  sheet.getCell(last + 1, 2).value = opts.timestamp;
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
  await workbook.xlsx.load(data as unknown as ExcelJS.Buffer);
  return workbook;
}
