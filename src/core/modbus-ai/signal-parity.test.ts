// @vitest-environment node
import { describe, expect, it } from "vitest";
import fixtures from "./fixtures/signal-normalization.json";
import { normalizeRawModbusTables } from "./signal/normalize";
import { expandModbusTemplates } from "./signal/expand-templates";
import { RawModbusExtractionSchema } from "./signal/schema";
import { rawExtractionSchema, normalizeExtraction } from "./extraction";
import { candidateSchema } from "./model";

describe("same raw response as Signal ad9d60c", () => {
  for (const fixture of fixtures.fixtures)
    it(fixture.name, () => {
      const raw = RawModbusExtractionSchema.parse(fixture.raw);
      const normalized = normalizeRawModbusTables(raw);
      const strip = (value: unknown) =>
        JSON.parse(
          JSON.stringify(value, (key, child) =>
            key === "sourceRow" || key === "sourceTable" ? undefined : child,
          ),
        );
      expect(strip(normalized)).toEqual(fixture.expected);
      expect(strip(expandModbusTemplates(normalized.signals).signals)).toEqual(
        fixture.expanded,
      );
    });
  for (const fixture of fixtures.fixtures)
    it(`MAPS adapter preserves addressed rows: ${fixture.name}`, () => {
      const rows = normalizeExtraction(
        rawExtractionSchema.parse(fixture.raw),
        [],
      ).signals;
      expect(rows).toHaveLength(fixture.expanded.length);
      const functions: Record<string, number> = {
        Coil: 1,
        DiscreteInput: 2,
        HoldingRegister: 3,
        InputRegister: 4,
      };
      fixture.expanded.forEach((expected, index) => {
        const row = rows[index];
        const wholeBitfield = expected.bit === 0 && expected.bitCount === 16;
        expect(row).toMatchObject({
          function: functions[expected.registerType],
          address: expected.address,
          bit: wholeBitfield ? null : expected.bit,
          dataType: wholeBitfield
            ? "uint16"
            : expected.dataType === "Boolean"
              ? "bit"
              : expected.dataType.toLowerCase(),
          scale: expected.factor,
          unit: expected.units,
        });
        if (wholeBitfield)
          expect(row.warnings.join(" ")).toContain("raw UINT16 bitfield");
        if (row.access === "unknown")
          expect(row.warnings.join(" ")).toContain("Access is undocumented");
        else expect(row.access).toBe(expected.mode);
      });
    });
  it("keeps the extraction contract raw and ignores former interpreted AI fields", () => {
    const raw = rawExtractionSchema.parse({
      ...fixtures.fixtures[0].raw,
      tables: [],
    });
    expect(raw.tables).toEqual([]);
    expect(
      Object.keys(
        rawExtractionSchema.shape.tables.element.shape.rows.element.shape,
      ),
    ).not.toContain("scale");
    expect(
      Object.keys(
        rawExtractionSchema.shape.tables.element.shape.rows.element.shape,
      ),
    ).not.toContain("dataType");
  });
  it("retains addressed reserved rows for coverage, excluded by default", () => {
    const fixture = fixtures.fixtures.find((item) =>
      item.name.startsWith("keeps reserved/spare"),
    )!;
    const result = normalizeExtraction(
      rawExtractionSchema.parse(fixture.raw),
      [],
    );
    expect(result.signals.map((row) => row.address)).toEqual(
      fixture.expanded.map((row) => row.address),
    );
    result.signals.forEach((row) => candidateSchema.parse(row));
    expect(
      result.signals
        .filter((row) => /reserved/i.test(row.name))
        .every((row) => !row.enabled),
    ).toBe(true);
  });
});
