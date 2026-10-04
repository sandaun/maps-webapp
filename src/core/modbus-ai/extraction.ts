import { z } from "zod";
import type { CandidateSignal, EvidencePage } from "./model";

// Adapted from Signal's raw-table extraction contract. Keep source data before
// normalization; document claims never become live validation claims here.
export const rawRowSchema = z.object({
  sourceAddress: z.union([z.string(), z.number()]).nullable(),
  normalizedAddress: z.number().int().nullable(),
  name: z.string(),
  groupText: z.string().nullable(),
  registerTypeHint: z
    .enum(["HoldingRegister", "InputRegister", "Coil", "DiscreteInput"])
    .nullable(),
  dataText: z.string().nullable(),
  sourceBit: z.number().int().nullable(),
  descriptionText: z.string().nullable(),
  modeText: z.string().nullable(),
  applicableModels: z.array(z.string()).nullable(),
  isReserved: z.boolean().nullable(),
  addressBasis: z.enum(["zero", "one", "plc", "explicit", "unknown"]),
  dataType: z
    .enum([
      "bit",
      "uint16",
      "int16",
      "uint32",
      "int32",
      "float32",
      "uint64",
      "int64",
      "float64",
    ])
    .nullable(),
  byteOrder: z.enum(["ABCD", "BADC", "CDAB", "DCBA"]).nullable(),
  scale: z.number().nullable(),
  offset: z.number().nullable(),
  unit: z.string().nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  enumValues: z.array(z.number()),
  sentinels: z.array(z.number()),
  sourcePages: z.array(z.number().int()),
  sourceQuote: z.string(),
});
export const rawExtractionSchema = z.object({
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  globalNotes: z.array(z.string()).nullable(),
  tables: z.array(
    z.object({
      title: z.string().nullable(),
      applicableModels: z.array(z.string()).nullable(),
      registerTypeHint: rawRowSchema.shape.registerTypeHint,
      tableNotes: z.array(z.string()).nullable(),
      rows: z.array(rawRowSchema),
    }),
  ),
});
export type RawExtraction = z.infer<typeof rawExtractionSchema>;
export type RawModbusRow = z.infer<typeof rawRowSchema>;
const FUNCTIONS = {
  Coil: 1,
  DiscreteInput: 2,
  HoldingRegister: 3,
  InputRegister: 4,
} as const;
function integer(text: string): number | null {
  const value = /^0x[\da-f]+$/i.test(text.trim())
    ? parseInt(text, 16)
    : /^\d+$/.test(text.trim())
      ? Number(text)
      : NaN;
  return Number.isInteger(value) ? value : null;
}
function printedAddress(value: number, basis: CandidateSignal["addressBasis"]) {
  if (basis !== "plc")
    return { address: value - (basis === "one" ? 1 : 0), fn: undefined };
  const divisor = value >= 100000 ? 100000 : 10000;
  const prefix = Math.floor(value / divisor);
  const fn = ({ 4: 3, 3: 4, 1: 2, 0: 1 } as const)[prefix as 4 | 3 | 1 | 0];
  return fn === undefined ? null : { address: (value % divisor) - 1, fn };
}
/** Signal's source-first addressing rules, with ambiguous bases kept visible. */
export function normalizeExtraction(raw: RawExtraction, pages: EvidencePage[]) {
  const signals: CandidateSignal[] = [];
  const warnings = [...(raw.globalNotes ?? [])];
  for (const table of raw.tables)
    for (const row of table.rows) {
      if (row.isReserved || !row.name.trim()) continue;
      const sourceAddress = String(row.sourceAddress ?? "");
      const rowWarnings: string[] = [];
      let fn =
        FUNCTIONS[
          row.registerTypeHint ?? table.registerTypeHint ?? "HoldingRegister"
        ];
      if (!row.registerTypeHint && !table.registerTypeHint)
        rowWarnings.push(
          "Read function is unspecified; FC03 is a candidate to review.",
        );
      const printed = integer(sourceAddress);
      let address = row.normalizedAddress;
      let basis = row.addressBasis;
      const addresses: number[] = [];
      if (address === null && printed !== null) {
        const converted = printedAddress(printed, basis);
        if (converted) {
          address = converted.address;
          fn = converted.fn ?? fn;
        } else
          rowWarnings.push(
            "Unsupported PLC address notation; review the PDU address.",
          );
      }
      if (address !== null) addresses.push(address);
      else {
        // Only expand explicit numeric ranges, never an undocumented unit count.
        const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(sourceAddress);
        if (
          range &&
          Number(range[2]) >= Number(range[1]) &&
          Number(range[2]) - Number(range[1]) < 256
        ) {
          const inferred =
            row.dataType ??
            inferDataType(`${row.dataText ?? ""} ${row.descriptionText ?? ""}`);
          const width = /64/.test(inferred) ? 4 : /32/.test(inferred) ? 2 : 1;
          if (width > 1 && Number(range[2]) - Number(range[1]) + 1 !== width) {
            warnings.push(
              `Unresolved multi-register range: ${row.name} (${sourceAddress}). Review array layout before adding rows.`,
            );
            continue;
          }
          for (let n = Number(range[1]); n <= Number(range[2]); n += width) {
            const converted = printedAddress(n, basis);
            if (converted) {
              addresses.push(converted.address);
              fn = converted.fn ?? fn;
            }
          }
          rowWarnings.push(
            width > 1
              ? "Source range describes one atomic multi-register value; review the span."
              : "Expanded source range; review whether each address is a separate signal.",
          );
        } else {
          warnings.push(
            `Unresolved source address/formula: ${row.name} (${sourceAddress}). Expand or resolve it before import.`,
          );
          continue;
        }
      }
      if (row.normalizedAddress !== null) basis = "explicit";
      if (basis === "unknown")
        rowWarnings.push(
          "Source address base is unknown. Review the candidate PDU address.",
        );
      const text = `${row.dataText ?? ""} ${row.descriptionText ?? ""}`;
      const dataType =
        fn <= 2 || row.sourceBit !== null
          ? "bit"
          : (row.dataType ?? inferDataType(text));
      if (
        fn > 2 &&
        !row.dataType &&
        !/\b(?:u?int|s16|u16|s32|u32|float|signed|unsigned)/i.test(text)
      )
        rowWarnings.push("Datatype is unspecified; uint16 raw is a candidate.");
      const mode = row.modeText ?? "";
      const access = /trigger|reset|pulse/i.test(mode)
        ? "Trigger"
        : /r\s*\/\s*w|read\s*\/\s*write/i.test(mode)
          ? "R/W"
          : /^w$|write.?only/i.test(mode)
            ? "W"
            : /^r$|read.?only/i.test(mode)
              ? "R"
              : "unknown";
      if (access === "unknown")
        rowWarnings.push(
          "Access is undocumented. Reading cannot establish write or trigger support.",
        );
      const selectedPages = pages.filter((p) =>
        row.sourcePages.includes(p.page),
      );
      const quote = row.sourceQuote.trim();
      const normalize = (s: string) =>
        s.replace(/\s+/g, " ").trim().toLowerCase();
      if (
        !quote ||
        !selectedPages.some((p) => normalize(p.text).includes(normalize(quote)))
      )
        rowWarnings.push(
          "Source quote was not matched in extracted page text; visually review the PDF.",
        );
      if (row.sourcePages.some((p) => !pages.some((page) => page.page === p)))
        rowWarnings.push("Source page is outside the supplied document.");
      if (/32|64/.test(dataType) && row.byteOrder === null)
        rowWarnings.push(
          "Multi-register byte/word order is undocumented; choose it before validation/import.",
        );
      for (const [index, resolved] of addresses.entries()) {
        const width = /64/.test(dataType) ? 4 : /32/.test(dataType) ? 2 : 1;
        if (resolved < 0 || resolved + width > 65536) {
          warnings.push(
            `Invalid PDU address/span for ${row.name}: ${resolved}`,
          );
          continue;
        }
        signals.push({
          id: `signal-${signals.length + 1}`,
          name: `${row.groupText ? row.groupText + " — " : ""}${row.name}${addresses.length > 1 ? ` (${index + 1})` : ""}`,
          description: row.descriptionText ?? "",
          function: fn,
          address: resolved,
          sourceAddress,
          addressBasis: basis,
          dataType,
          byteOrder: row.byteOrder,
          bit: fn <= 2 ? null : row.sourceBit,
          scale: row.scale,
          offset: row.offset,
          unit: row.unit,
          access,
          min: row.min,
          max: row.max,
          enumValues: row.enumValues,
          sentinels: row.sentinels,
          sourcePages: row.sourcePages,
          sourceQuote: quote,
          applicableModels:
            row.applicableModels ?? table.applicableModels ?? [],
          warnings: [...rowWarnings],
          reviewed: false,
          enabled: access !== "W" && access !== "Trigger",
        });
      }
    }
  const seen = new Map<string, CandidateSignal>();
  for (const row of signals) {
    const key = `${row.function}:${row.address}:${row.bit ?? "word"}`;
    const previous = seen.get(key);
    if (previous) {
      row.warnings.push(
        "Duplicate function/address/bit; review model applicability.",
      );
      previous.warnings.push(
        "Duplicate function/address/bit; review model applicability.",
      );
    } else seen.set(key, row);
  }
  if (signals.length === 0)
    warnings.push(
      "No addressed signals were extracted. A scanned PDF or unresolved formulas may require review.",
    );
  if (signals.length > 4096)
    throw new Error(
      "Extracted map exceeds 4096 signals. Restrict the PDF pages.",
    );
  return { signals, warnings };
}

// Selected datatype patterns from Signal normalization, extended beyond 16 bits.
export function inferDataType(text: string): CandidateSignal["dataType"] {
  if (/float\s*64|double|f64/i.test(text)) return "float64";
  if (/float|real|f32/i.test(text)) return "float32";
  for (const width of [64, 32, 16] as const) {
    if (
      new RegExp(`uint\\s*${width}|u${width}|unsigned\\s*${width}`, "i").test(
        text,
      )
    )
      return `uint${width}`;
    if (
      new RegExp(
        `(?:int|sint)\\s*${width}|s${width}|signed\\s*${width}`,
        "i",
      ).test(text)
    )
      return `int${width}`;
  }
  return /(?<!un)signed|2'?s?\s*complement|signed\s*\(c2\)/i.test(text)
    ? "int16"
    : "uint16";
}
