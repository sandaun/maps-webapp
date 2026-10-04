// @vitest-environment node
import { describe, expect, it } from "vitest";
import data from "./fixtures/manufacturer-real-pdfs.json";
import { normalizeExtraction, rawExtractionSchema } from "./extraction";
import { normalizeRawModbusTables } from "./signal/normalize";
import { expandModbusTemplates } from "./signal/expand-templates";
import { RawModbusExtractionSchema } from "./signal/schema";

const functions: Record<string, number> = {
  Coil: 1,
  DiscreteInput: 2,
  HoldingRegister: 3,
  InputRegister: 4,
};
const stripProvenance = (value: unknown) =>
  JSON.parse(
    JSON.stringify(value, (key, child) =>
      key === "sourceRow" || key === "sourceTable" ? undefined : child,
    ),
  );

describe("manufacturer PDFs — four paid responses replayed without AI", () => {
  for (const fixture of data.fixtures) {
    const expected = fixture.signalExpected
      .map((row) =>
        JSON.stringify([
          functions[row.registerType],
          row.address,
          row.bit,
          row.dataType === "Boolean" ? "bit" : row.dataType.toLowerCase(),
          row.factor,
          row.units,
          row.mode,
        ]),
      )
      .sort();
    for (const [provider, response, coreExpected] of [
      ["Signal", fixture.signalRaw, fixture.signalExpected],
      ["MAPS", fixture.mapsRaw, fixture.mapsRawExpected],
    ] as const) {
      it(`${fixture.name}/${provider}: reproduces the unchanged Signal core`, () => {
        const normalized = normalizeRawModbusTables(
          RawModbusExtractionSchema.parse(response),
        );
        expect(
          stripProvenance(expandModbusTemplates(normalized.signals).signals),
        ).toEqual(coreExpected);
      });
      it(`${fixture.name}/${provider}: preserves every address, bit, type, scale, unit and access`, () => {
        const actual = normalizeExtraction(
          rawExtractionSchema.parse(response),
          fixture.pages,
        ).signals;
        expect(actual).toHaveLength(fixture.signalExpected.length);
        expect(
          actual
            .map((row) =>
              JSON.stringify([
                row.function,
                row.address,
                row.bit,
                row.dataType,
                row.scale,
                row.unit,
                row.access,
              ]),
            )
            .sort(),
        ).toEqual(expected);
      });
    }
  }

  const baxi = data.fixtures.find((fixture) => fixture.name === "Baxi")!;
  const gree = data.fixtures.find((fixture) => fixture.name === "Gree")!;

  it("Baxi: keeps 19 printed occurrences and flags the five repeated addresses", () => {
    const { signals } = normalizeExtraction(
      rawExtractionSchema.parse(baxi.mapsRaw),
      baxi.pages,
    );
    expect(signals).toHaveLength(19);
    expect(new Set(signals.map((row) => `${row.function}:${row.address}`)).size)
      .toBe(14);
    for (const [fn, address] of [[1, 61], [1, 60], [3, 61], [3, 1], [3, 201]]) {
      const repeated = signals.filter(
        (row) => row.function === fn && row.address === address,
      );
      expect(repeated).toHaveLength(2);
      expect(repeated.every((row) => row.warnings.some((warning) =>
        warning.startsWith("Duplicate function/address/bit"),
      ))).toBe(true);
    }
  });

  it("Baxi: treats scalar Bit 0 layout as whole registers without changing the raw evidence", () => {
    const raw = rawExtractionSchema.parse(baxi.mapsRaw);
    const before = JSON.stringify(raw);
    const { signals } = normalizeExtraction(raw, baxi.pages);
    const registers = signals.filter((row) => row.function === 3);
    expect(registers).toHaveLength(12);
    expect(registers.every((row) => row.dataType === "uint16" && row.bit === null))
      .toBe(true);
    expect(registers.every((row) => row.warnings.some((warning) =>
      warning.includes("Generic Bit 0"),
    ))).toBe(true);
    expect(JSON.stringify(raw)).toBe(before);
  });

  it("Baxi: proposes 495 for the wrapped address and requires confirmation", () => {
    const { signals } = normalizeExtraction(
      rawExtractionSchema.parse(baxi.mapsRaw),
      baxi.pages,
    );
    expect(signals.find((row) => row.address === 495)).toMatchObject({
      function: 3,
      addressNeedsConfirmation: true,
      enabled: false,
      sourceAddress: "49\n5",
      sourceQuote: "HR 49\n5 0 1 1 No UInt Request type",
    });
    expect(signals.find((row) => row.address === 495)!.warnings.join(" "))
      .toContain("Possible address: 495");
    expect(signals.some((row) => row.function === 3 && row.address === 5)).toBe(false);
    expect(signals.some((row) => row.address === 200)).toBe(false);
  });

  it("Gree: carries the coil table across pages and preserves W/R access", () => {
    const { signals } = normalizeExtraction(
      rawExtractionSchema.parse(gree.mapsRaw),
      gree.pages,
    );
    expect(signals).toHaveLength(50);
    expect(signals.filter((row) => row.function === 3)).toHaveLength(22);
    const coils = signals.filter((row) => row.function === 1);
    expect(coils).toHaveLength(28);
    expect(coils.every((row) => row.dataType === "bit" && row.bit === null))
      .toBe(true);
    expect(coils[0]).toMatchObject({ address: 18, sourcePages: [1], access: "R/W" });
    expect(coils[coils.length - 1]).toMatchObject({
      address: 160,
      sourcePages: [2],
      access: "R",
    });
    expect(signals.filter((row) => row.access === "R/W")).toHaveLength(23);
    expect(signals.filter((row) => row.access === "R")).toHaveLength(27);
    expect(signals.filter((row) => row.unit === "°C")).toHaveLength(13);
  });

  it("does not erase a genuine register bit or treat a quoted list as a wrapped address", () => {
    const raw = rawExtractionSchema.parse(baxi.mapsRaw);
    raw.tables = [{
      ...raw.tables[0],
      rows: [{
        ...raw.tables[0].rows[0],
        sourceAddress: "12",
        dataText: "BIT MASK; Size: 1; Factor: 1; Sign: No",
        descriptionText: "Bit 0 = Enable",
      }],
    }];
    expect(normalizeExtraction(raw, baxi.pages).signals[0]).toMatchObject({
      address: 12,
      bit: 0,
      dataType: "bit",
    });
    raw.tables[0].rows[0].sourceAddress = "49, 5";
    raw.tables[0].rows[0].sourceQuote = "HR 49, 5 Bit 0 = Enable";
    expect(normalizeExtraction(raw, baxi.pages).signals[0].warnings.join(" "))
      .not.toContain("Wrapped address");
  });

  it("inherits the register table hint when distinguishing a scalar layout from a named bit", () => {
    const raw = rawExtractionSchema.parse(baxi.mapsRaw);
    raw.tables = [{
      ...raw.tables[0],
      registerTypeHint: "HoldingRegister",
      rows: [{ ...raw.tables[0].rows[0], registerTypeHint: null }],
    }];
    expect(normalizeExtraction(raw, baxi.pages).signals[0]).toMatchObject({
      function: 3,
      address: 8,
      dataType: "uint16",
      bit: null,
    });
  });
});
