// @vitest-environment node
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/controller1-real-pdf.json";
import { normalizeExtraction, rawExtractionSchema } from "./extraction";
import { RawModbusExtractionSchema } from "./signal/schema";
import { normalizeRawModbusTables } from "./signal/normalize";
import { expandModbusTemplates } from "./signal/expand-templates";
import { validationTargets } from "./validation";

describe("real Controller 1 PDF — two paid responses, replayed without AI", () => {
  const expectedAddresses = [
    ...Array.from({ length: 30 }, (_, i) => i),
    ...Array.from({ length: 17 }, (_, i) => 100 + i),
    121,
    122,
    123,
    124,
    125,
    126,
    136,
    137,
  ];
  for (const [name, response] of Object.entries({
    Signal: fixture.signalRaw,
    MAPS: fixture.mapsRaw,
  })) {
    it(`${name}: preserves all 55 printed addresses and signed formats`, () => {
      const result = normalizeExtraction(
        rawExtractionSchema.parse(response),
        fixture.pages,
      );
      expect(result.signals).toHaveLength(55);
      expect(
        result.signals.map((row) => row.address).sort((a, b) => a - b),
      ).toEqual(expectedAddresses);
      expect(
        result.signals
          .filter((row) => row.dataType === "int16")
          .map((row) => row.address),
      ).toEqual([104, 105, 110, 121, 122, 123, 124, 125, 126]);
      expect(
        result.signals.every((row) => row.function === 3 && row.bit === null),
      ).toBe(true);
    });
    it(`${name}: respects numbered Read labels and never probes the 31 Triggers`, () => {
      const { signals } = normalizeExtraction(
        rawExtractionSchema.parse(response),
        fixture.pages,
      );
      expect(
        signals.filter((row) => row.access === "R").map((row) => row.address),
      ).toEqual([0, 105, 107, 108, 109, 110, 112, 136]);
      expect(signals.filter((row) => row.access === "Trigger")).toHaveLength(
        31,
      );
      expect(signals.filter((row) => row.access === "R/W")).toHaveLength(16);
      expect(validationTargets(signals)).toHaveLength(24);
    });
    it(`${name}: keeps documented temperature scaling but leaves compound duration counters unresolved`, () => {
      const { signals } = normalizeExtraction(
        rawExtractionSchema.parse(response),
        fixture.pages,
      );
      expect(signals.filter((row) => row.unit === "°C")).toHaveLength(9);
      expect(
        signals
          .filter((row) => row.unit === "°C")
          .every((row) => row.scale === 0.1),
      ).toBe(true);
      for (const address of [107, 108]) {
        const row = signals.find((row) => row.address === address)!;
        expect(row.scale).toBeNull();
        expect(row.unit).toBeNull();
        expect(row.warnings.join(" ")).toContain("Duration-counter notation");
      }
      expect(signals.find((row) => row.address === 104)).toMatchObject({
        min: 17,
        max: 30,
      });
    });
  }
  it("reproduces the actual unchanged Signal normalizer on its paid response", () => {
    const normalized = normalizeRawModbusTables(
      RawModbusExtractionSchema.parse(fixture.signalRaw),
    );
    const expanded = expandModbusTemplates(normalized.signals).signals;
    const strip = (value: unknown) =>
      JSON.parse(
        JSON.stringify(value, (key, child) =>
          key === "sourceRow" || key === "sourceTable" ? undefined : child,
        ),
      );
    expect(strip(expanded)).toEqual(fixture.signalExpected);
  });
});
