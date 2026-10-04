// Source: Signal ad9d60c6619bfab7a9186e96938bd0b20a4403cc, src/lib/ai/structured-modbus/schema.ts.
import { z } from 'zod';

const RawStringSchema = z.preprocess(
  (value) => (value === null || value === undefined ? '' : String(value)),
  z.string(),
);

const RawNullableStringSchema = z.preprocess(
  (value) => (value === null || value === undefined ? null : String(value)),
  z.string().nullable(),
);

/**
 * Required-but-nullable field that tolerates a missing key. OpenAI strict
 * structured output rejects schemas with optional properties (every key must
 * be in `required`), while Kimi/Anthropic may omit keys entirely — the
 * preprocess bridges both.
 */
function nullableField<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => value ?? null, schema.nullable());
}

const RawApplicableModelsSchema = nullableField(z.array(z.string())).describe(
  'Specific device model names/references this table or row applies to. Null/omitted means common to all models.',
);

export const RawModbusRowSchema = z.object({
  sourceAddress: z
    .union([z.number(), z.string()])
    .nullable()
    .describe(
      'Printed source address exactly as shown in the manual, e.g. 30001, 40001, 100*N+1. Do not convert to zero-based. If the table has separate hexadecimal and decimal address columns, prefer the decimal value; otherwise prefix hex-only values with 0x.',
    ),
  normalizedAddress: nullableField(z.union([z.number(), z.string()])).describe(
    '0-based Signal/MAPS address only when the source table explicitly provides a normalized/0-based address column. Otherwise null/omitted.',
  ),
  normalizedAddressSource: nullableField(
    z.enum(['explicit', 'inferred-1-based']),
  ).describe(
    'Internal provenance for normalizedAddress. explicit = source provided it; inferred-1-based = derived from typed HR/Coil N source rows.',
  ),
  name: RawStringSchema.describe('Signal/register name from the row.'),
  groupText: RawNullableStringSchema.describe(
    'Shared visual group/category label for this row, e.g. Machine settings, Setpoint, Alarms. Especially important for BIT MASK rows.',
  ),
  registerTypeHint: nullableField(
    z.enum(['HoldingRegister', 'InputRegister', 'Coil', 'DiscreteInput']),
  ).describe(
    'Row-level register type when the row itself shows FC03/FC04/coil/discrete-input or a Type of register column. Null/omitted to inherit the table hint.',
  ),
  dataText: RawNullableStringSchema
    .describe('Raw datatype/value/format text from the row, if present.'),
  sourceBit: nullableField(z.union([z.number(), z.string()])).describe(
    'Printed bit position exactly as shown for BIT MASK / bit-coded rows, e.g. 0, 7, 15. Null for whole-register rows.',
  ),
  descriptionText: RawNullableStringSchema
    .describe('Raw description, notes, examples, units, scaling text.'),
  modeText: RawNullableStringSchema
    .describe('Raw read/write/access text such as R, W, R/W, Read only.'),
  applicableModels: RawApplicableModelsSchema,
  isReserved: z
    .boolean()
    .nullable()
    .describe('True only when the row itself is a reserved/unused register.'),
});

export const RawModbusTableSchema = z.object({
  title: RawNullableStringSchema,
  applicableModels: RawApplicableModelsSchema,
  registerTypeHint: z
    .enum(['HoldingRegister', 'InputRegister', 'Coil', 'DiscreteInput'])
    .nullable(),
  rows: z.array(RawModbusRowSchema),
  tableNotes: z
    .array(z.string())
    .nullable()
    .describe(
      'Footnotes or notes that visually belong to this table. Keep address formulas here instead of turning them into rows.',
    ),
});

export const RawModbusExtractionSchema = z.object({
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  globalNotes: z.array(z.string()).nullable(),
  tables: z.array(RawModbusTableSchema),
});

export type RawModbusRow = z.infer<typeof RawModbusRowSchema>;
export type RawModbusTable = z.infer<typeof RawModbusTableSchema>;
export type RawModbusExtraction = z.infer<typeof RawModbusExtractionSchema>;
