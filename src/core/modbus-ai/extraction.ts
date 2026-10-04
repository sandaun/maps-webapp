import { z } from "zod";
import type { CandidateSignal, EvidencePage } from "./model";
import { normalizeRawModbusTables } from "./signal/normalize";
import { expandModbusTemplates } from "./signal/expand-templates";
import { parseEnumStates } from "./signal/enum-states";
import type { AIModbusSignal } from "./signal/signal-types";

// Signal ad9d60c raw contract plus MAPS page/quote provenance. No interpreted fields.
export const rawRowSchema = z.object({
  sourceAddress: z.union([z.string(), z.number()]).nullable(),
  normalizedAddress: z.union([z.string(), z.number()]).nullable(),
  normalizedAddressSource: z
    .enum(["explicit", "inferred-1-based"])
    .nullable()
    .default(null),
  name: z.string(),
  groupText: z.string().nullable(),
  registerTypeHint: z
    .enum(["HoldingRegister", "InputRegister", "Coil", "DiscreteInput"])
    .nullable(),
  dataText: z.string().nullable(),
  sourceBit: z.union([z.string(), z.number()]).nullable(),
  descriptionText: z.string().nullable(),
  modeText: z.string().nullable(),
  applicableModels: z.array(z.string()).nullable(),
  isReserved: z.boolean().nullable(),
  sourcePages: z.array(z.number().int().positive()).default([]),
  sourceQuote: z.string().default(""),
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

/** Run the complete Signal normalizer first; adapt only MAPS capabilities afterward. */
export function normalizeExtraction(raw: RawExtraction, pages: EvidencePage[]) {
  const sourceRows = new Map<RawModbusRow, RawModbusRow>();
  const prepared = {
    ...raw,
    tables: raw.tables.map((table) => ({
      ...table,
      rows: table.rows.map((row) => {
        const preparedRow = {
          ...row,
          sourceBit: hasScalarLayoutBit(row, table.registerTypeHint)
            ? null
            : row.sourceBit,
        };
        sourceRows.set(preparedRow, row);
        return preparedRow;
      }),
    })),
  };
  const normalized = normalizeRawModbusTables(prepared);
  const warnings = [
    ...(raw.globalNotes ?? []),
    ...normalized.warnings,
    ...normalized.infos,
  ];
  const signals: CandidateSignal[] = [];
  for (const original of normalized.signals) {
    const normalizedRow = original.sourceRow as RawModbusRow;
    const row = sourceRows.get(normalizedRow) ?? normalizedRow;
    const table = original.sourceTable!;
    const text = [row.name, row.dataText, row.descriptionText]
      .filter(Boolean)
      .join(" ");
    const sourceAddress = String(row.sourceAddress ?? "");
    if (/[+*]|\b[MN]\b/.test(sourceAddress) && !original.addressTemplate) {
      warnings.push(
        `Unresolved source address/formula: ${row.name} (${sourceAddress}). No documented unit range was resolved.`,
      );
      continue;
    }
    const wholeRegisterBitfield =
      original.bit === 0 && original.bitCount === 16;
    const dataType = wholeRegisterBitfield
      ? "uint16"
      : original.registerType === "Coil" ||
          original.registerType === "DiscreteInput" ||
          original.bit !== null
        ? "bit"
        : /\b(?:float(?:32|64)?|double|f32|f64|u?int\s*(?:32|64)|[us](?:32|64))\b/i.test(
              text,
            )
          ? inferDataType(text)
          : (original.dataType.toLowerCase() as CandidateSignal["dataType"]);
    const width = /64/.test(dataType) ? 4 : /32/.test(dataType) ? 2 : 1;
    // Signal expands printed spans. A documented wide scalar occupies the words atomically.
    if (width > 1 && /\d\s*[-–]\s*\d/.test(sourceAddress)) {
      const range = sourceAddress.match(/(\d+)\s*[-–]\s*(\d+)/);
      if (range && Number(range[2]) - Number(range[1]) + 1 === width) {
        if (
          /\(\d+\)$/.test(original.signalName) &&
          !original.signalName.endsWith("(0)")
        )
          continue;
      } else {
        warnings.push(
          `Unresolved multi-register range: ${row.name} (${sourceAddress}). Review array layout.`,
        );
        continue;
      }
    }
    const fn = FUNCTIONS[original.registerType];
    const rowWarnings: string[] = [];
    if (hasScalarLayoutBit(row, table.registerTypeHint))
      rowWarnings.push(
        "Generic Bit 0 / Size / Factor / Sign columns describe this scalar's layout. Kept as a raw whole register; review the documented encoding.",
      );
    const joinedAddress = wrappedAddressSuggestion(row);
    if (joinedAddress)
      rowWarnings.push(
        `Possible address: ${joinedAddress}. Confirm the address cell in the source PDF before reading or importing this signal.`,
      );
    if (wholeRegisterBitfield)
      rowWarnings.push(
        "Documented bits 0–15 are kept as one raw UINT16 bitfield. Review individual flags before interpreting them.",
      );
    if (!row.registerTypeHint && !table.registerTypeHint)
      rowWarnings.push(
        "Read function is unspecified; FC03 is a candidate to review.",
      );
    const access = documentedAccess(row.modeText, table.title, original);
    if (access === "unknown")
      rowWarnings.push(
        "Access is undocumented. Reading cannot establish write or trigger support.",
      );
    const byteOrder = /\b(ABCD|BADC|CDAB|DCBA)\b/i
      .exec(text)?.[1]
      .toUpperCase() as CandidateSignal["byteOrder"] | undefined;
    if (width > 1 && !byteOrder)
      rowWarnings.push(
        "Multi-register byte/word order is undocumented; choose it before validation/import.",
      );
    const ambiguousHours = /(?:x|×|%)\s*100\s*hours?\b/i.test(text);
    const scale = ambiguousHours
      ? null
      : (original.factor ?? scaleInName(row.name));
    if (ambiguousHours)
      rowWarnings.push(
        "Duration-counter notation is ambiguous. Review the documented conversion; scale and unit are left unresolved.",
      );
    const ranges = numericRanges(text);
    const min = ranges.length ? Math.min(...ranges.map(([low]) => low)) : null;
    const max = ranges.length
      ? Math.max(...ranges.map(([, high]) => high))
      : null;
    if (ranges.length > 1)
      rowWarnings.push(
        "Multiple documented ranges: displayed limits cover their envelope; review operating-mode/model applicability.",
      );
    const sourcePages = row.sourcePages ?? [];
    const quote = (row.sourceQuote ?? "").trim();
    const comparable = (value: string) =>
      value.replace(/\s+/g, " ").trim().toLowerCase();
    if (
      !quote ||
      !pages.some(
        (page) =>
          sourcePages.includes(page.page) &&
          comparable(page.text).includes(comparable(quote)),
      )
    )
      rowWarnings.push(
        "Source quote was not matched in extracted page text; visually review the PDF.",
      );
    if (sourcePages.some((n) => !pages.some((page) => page.page === n)))
      rowWarnings.push("Source page is outside the supplied document.");
    let basis: CandidateSignal["addressBasis"] =
      row.normalizedAddressSource === "inferred-1-based"
        ? "one"
        : row.normalizedAddress !== null
          ? "explicit"
          : normalized.detectedAddressBase === "plc"
            ? "plc"
            : "unknown";
    if (basis === "unknown")
      rowWarnings.push(
        "Source address base is unknown. Review the candidate PDU address.",
      );
    if (
      original.bit !== null &&
      !wholeRegisterBitfield &&
      (original.bit > 15 || (original.bitCount ?? 1) > 1)
    ) {
      warnings.push(
        `Unsupported MAPS bit span for ${original.signalName}: bit ${original.bit}, count ${original.bitCount}. Kept in raw extraction for manual review.`,
      );
      continue;
    }
    for (const flat of expandModbusTemplates([original]).signals) {
      let address = joinedAddress ? Number(joinedAddress) : flat.address!;
      // Existing MAPS six-digit PLC support; Signal handles five-digit notation.
      const sixDigit = /^([34])0(\d{4})$/.exec(sourceAddress);
      if (sixDigit && row.normalizedAddress === null) {
        address = Number(sixDigit[2]) - 1;
        basis = "plc";
      }
      if (
        !Number.isInteger(address) ||
        address < 0 ||
        address + width > 65536
      ) {
        warnings.push(
          `Invalid PDU address/span for ${flat.signalName}: ${address}`,
        );
        continue;
      }
      const reserved =
        row.isReserved === true || /^<?\s*reserved\s*>?$/i.test(row.name);
      if (reserved)
        rowWarnings.push(
          "Reserved address retained for document coverage; excluded from live reads and import by default.",
        );
      signals.push({
        id: `signal-${signals.length + 1}`,
        name:
          width > 1
            ? flat.signalName.replace(/\s*\(0\)$/, "")
            : flat.signalName,
        description: flat.description ?? "",
        function: fn,
        address,
        ...(joinedAddress ? { addressNeedsConfirmation: true } : {}),
        sourceAddress,
        addressBasis: basis,
        dataType,
        byteOrder: byteOrder ?? null,
        bit: fn <= 2 || wholeRegisterBitfield ? null : flat.bit,
        scale,
        offset: null,
        unit: ambiguousHours ? null : flat.units,
        access,
        min,
        max,
        enumValues: parseEnumStates(
          [row.dataText, row.descriptionText].filter(Boolean).join(" "),
        ).map((state) => state.value),
        sentinels: documentedSentinels(text),
        sourcePages,
        sourceQuote: quote,
        applicableModels: flat.applicableModels ?? [],
        warnings: [...new Set(rowWarnings)],
        reviewed: false,
        enabled:
          !joinedAddress && !reserved && access !== "W" && access !== "Trigger",
      });
    }
  }
  const seen = new Map<string, CandidateSignal>();
  for (const row of signals) {
    const key = `${row.function}:${row.address}:${row.bit ?? "word"}`;
    const previous = seen.get(key);
    if (previous) {
      const warning =
        "Duplicate function/address/bit; review model applicability.";
      row.warnings.push(warning);
      previous.warnings.push(warning);
    } else seen.set(key, row);
  }
  if (!signals.length)
    warnings.push(
      "No addressed signals were extracted. Review the PDF and unresolved formulas.",
    );
  if (signals.length > 4096)
    throw new Error(
      "Extracted map exceeds 4096 signals. Restrict the PDF pages.",
    );
  return { signals, warnings: [...new Set(warnings)] };
}

/** Generic PLC layout columns are not a documented named flag/bit mask. */
function hasScalarLayoutBit(
  row: RawModbusRow,
  tableType: RawModbusRow["registerTypeHint"] = null,
): boolean {
  if (!/^0$/.test(String(row.sourceBit ?? "").trim())) return false;
  const type = row.registerTypeHint ?? tableType;
  if (
    type !== "HoldingRegister" &&
    type !== "InputRegister"
  )
    return false;
  const data = row.dataText ?? "";
  return (
    /\b(?:u?s?int(?:8|16|32|64)?|usint|bool|real|float|double)\b/i.test(data) &&
    /\bsize\s*:\s*1\b/i.test(data) &&
    /\bfactor\s*:/i.test(data) &&
    /\bsign\s*:/i.test(data) &&
    !/\bbit\s*(?:mask|field|coded)\b|\bB(?:IT)?\s*\d+\s*=/i.test(
      `${row.groupText ?? ""} ${data} ${row.descriptionText ?? ""}`,
    )
  );
}

/** A digit wrap is only a proposal; the quote cannot establish cell geometry. */
function wrappedAddressSuggestion(row: RawModbusRow): string | null {
  if (row.normalizedAddress !== null) return null;
  const source = String(row.sourceAddress ?? "").trim();
  if (!/^\d{2,5}[ \t]*\r?\n[ \t]*\d$/.test(source)) return null;
  if (!row.sourceQuote.includes(source)) return null;
  return source.replace(/\s+/g, "");
}

function documentedAccess(
  mode: string | null,
  title: string | null,
  signal: AIModbusSignal,
): CandidateSignal["access"] {
  const value = mode ?? "";
  if (/\btrigger\b|\bpulse\b/i.test(value)) return "Trigger";
  // MAPS exports numbered labels ("0: Read", "2: Read / Write").
  // Signal's raw normalizer understands R/W but defaults plain "Read" to R/W.
  const label = value.replace(/^\s*\d+\s*:\s*/, "").trim();
  if (/^read(?:\s*only)?$/i.test(label)) return "R";
  if (/^write(?:\s*only)?$/i.test(label)) return "W";
  if (
    /\bread\b|\bwrite\b|\b(?:R\s*\/\s*W|W\s*\/\s*R)\b|^\s*[RW]\s*$/i.test(
      value,
    ) ||
    /\bread\b|\bwrite\b|\blectura\b|\bescritura\b/i.test(title ?? "")
  )
    return signal.mode ?? "unknown";
  if (
    signal.registerType === "InputRegister" ||
    signal.registerType === "DiscreteInput"
  )
    return "R";
  return "unknown";
}
function scaleInName(name: string): number | null {
  const divisor = /\bx\s*(10|100|1000)\b/i.exec(name);
  return divisor ? 1 / Number(divisor[1]) : null;
}
function numericRanges(text: string): Array<[number, number]> {
  return [
    ...text.matchAll(
      /(-?\d+(?:[.,]\d+)?)\s*(?:\.\.|\bto\b)\s*(-?\d+(?:[.,]\d+)?)/gi,
    ),
  ]
    .map(
      (match) =>
        [
          Number(match[1].replace(",", ".")),
          Number(match[2].replace(",", ".")),
        ] as [number, number],
    )
    .filter(([low, high]) => Number.isFinite(low) && low <= high);
}
function documentedSentinels(text: string): number[] {
  return [
    ...new Set(
      [
        ...text.matchAll(
          /(?:invalid|unavailable|sentinel|not implemented)\s*[:=]?\s*(-?\d+)/gi,
        ),
      ].map((match) => Number(match[1])),
    ),
  ];
}
// Documented wider types remain outside the copied Signal normalization rules.
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
