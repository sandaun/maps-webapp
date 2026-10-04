// Source: Signal ad9d60c6619bfab7a9186e96938bd0b20a4403cc, src/lib/ai/structured-modbus/prompt.ts.
export const RAW_MODBUS_TABLE_PROMPT = `You extract RAW Modbus tables from technical manuals.

Return ONLY valid JSON with this exact shape:
{
  "manufacturer": "brand or null",
  "model": "model/reference or null",
  "globalNotes": ["document-wide notes relevant to addressing or unit count"],
  "tables": [
    {
      "title": "table title or section heading",
      "applicableModels": ["model names this whole table/section applies to, or null for common/all models"],
      "registerTypeHint": "HoldingRegister | InputRegister | Coil | DiscreteInput | null",
      "tableNotes": ["footnotes visually attached to this table"],
      "rows": [
        {
          "sourceAddress": "printed address/formula exactly as shown, or null",
          "normalizedAddress": "explicit 0-based/Signal/MAPS address from the same row, or null",
          "name": "row signal/register name in English",
          "groupText": "shared group/category label in English, or null",
          "registerTypeHint": "HoldingRegister | InputRegister | Coil | DiscreteInput | null",
          "dataText": "raw datatype/value/format text or null",
          "sourceBit": "printed bit position for BIT MASK / bit-coded rows, or null",
          "descriptionText": "raw description/examples/units/scaling text or null",
          "modeText": "raw access text such as R, W, R/W, Read only, or null",
          "applicableModels": ["model names this specific row applies to, or null to inherit table/common scope"],
          "isReserved": true/false/null
        }
      ]
    }
  ]
}

Rules:
- Extract Modbus register/coil tables only. Ignore prose that is not tied to register rows.
- Names must be in English even when the source manual is not. Translate technical signal names using normal building-automation terminology. Preserve original source wording in descriptionText when it helps traceability.
- Preserve printed source addresses exactly. Do NOT convert 30001/40001 notation to zero-based.
- If the source row has BOTH a printed/manual address and an explicit normalized/0-based/Signal address, preserve BOTH. Example rows like "Coil 5 4 Confirmar cambios Modbus" or "HR 61 60 On/Off pump" mean sourceAddress=5/61 and normalizedAddress=4/60. The second number is already 0-based; never subtract from it again.
- If a table has separate Hexadecimal and Decimal address columns for the same register, use the Decimal column as sourceAddress. If the decimal value is not legible, use the hexadecimal value with a 0x prefix (for example 0x001A) so downstream parsing preserves its base.
- Preserve multi-model scope. If a table/section heading identifies specific product models (for example "S1156", "S735", "S2125/F2120", "VVM S320 / S325"), set table.applicableModels to those model names split into individual values. If the table is labelled common/general or applies to all models, set table.applicableModels=null.
- If a row has a model-specific column/marker that differs from the table scope, set row.applicableModels for that row. Otherwise set row.applicableModels=null and inherit the table scope. Never put common/all-model rows in a model-specific list.
- Preserve row-level register type when present. FC03 or "Holding Register" means row.registerTypeHint="HoldingRegister"; FC04 or "Input Register" means row.registerTypeHint="InputRegister"; coils/discrete inputs likewise. If the row does not show its own type, set row.registerTypeHint=null and inherit the table hint.
- Do NOT infer final signals. Do NOT create addressTemplate. Do NOT expand per-unit formulas.
- A table footnote like "Plus 200*N for other units/slaves/devices" belongs in tableNotes. It is NOT a new row.
- If a column header references a footnote, for example "Address(*1)", and footnote (*1) contains an address formula such as "+ 200 * N", attach that footnote to the tableNotes for that table.
- If a note visually sits under one table, attach it to that table only. Do not copy it to later tables.
- Shared/merged cells are normal table layout. Repeat the shared data/description text on each affected addressed row, but keep the row's own printed address and name aligned.
- Preserve the source unit column for every addressed row. Put the unit text in descriptionText when there is no dedicated output field, including °C, bar, l/min, K, kWh, h, %, Hz, rpm, and A.
- Split rows only when the source has explicit addresses/formulas for each row.
- For BIT MASK / bit-field / bit-coded rows, create one row per documented meaningful bit. Treat labels such as "B0 = POWER-OFF", "B11 = SILENT MODE 2 ACTIVE", and "Bit 3 = alarm" as explicit bit rows. Keep the same sourceAddress, set sourceBit to the printed bit number, use the bit's own meaning as name, and put the shared visual group/category/description label in groupText. Example: if a BIT MASK block is grouped under "Ajustes máquina" and bit 0 means "Activación escritura estado máquina desde remoto", return name="Remote machine state write activation", groupText="Machine settings". Do not create an additional aggregate row for the BIT MASK heading.
- If a bit's own label is ambiguous without its group (for example "Enable", "Status", "High", "Low", "Bit 0"), keep the bit meaning in name and the parent/group context in groupText so the final signal can be self-describing.
- For INT/enum registers, create one row for the register. Keep enumerated values such as "0=Stand by, 1=Cool" in descriptionText. Do NOT create one row per enum value.
- If a visual table repeats the same register address for enum values, collapse those visual entries into one row for that register. The enum values belong in descriptionText, not rows.
- Do not turn visual group labels or merged category headings such as "Alarms", "Temperatures", or "Setpoints" into extra rows unless they are the actual addressed signal name with no more specific row text.
- Include reserved rows when they have printed addresses and mark isReserved=true.
- Capture global notes only when they affect interpretation, e.g. "maximum 16 units", "address number 0..15", or protocol-wide base notation.
- If the table title says "input registers", set registerTypeHint="InputRegister"; "holding registers" -> "HoldingRegister"; "coils" -> "Coil"; "discrete inputs" -> "DiscreteInput".
- Return complete JSON, no markdown, no comments.`;
