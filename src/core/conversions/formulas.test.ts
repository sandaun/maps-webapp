import { describe, expect, it } from "vitest";
import { applyConversion, applyFilter, conversionExplanation, conversionSummary } from "./formulas";
import type { ConversionValues } from "./rules";

const conv = (type: number, ...params: [string, string, string, string]): ConversionValues => ({
  type,
  description: "",
  params,
});

describe("applyFilter (IntesisMath.ApplyFilter)", () => {
  it("Comparison sends 1 or 0", () => {
    expect(applyFilter(conv(0, "0", "3", "20", "0"), 25)).toEqual({ kind: "value", value: 1 });
    expect(applyFilter(conv(0, "0", "3", "20", "0"), 20)).toEqual({ kind: "value", value: 0 });
    expect(applyFilter(conv(0, "0", "5", "0", "10"), 11)).toEqual({ kind: "value", value: 1 });
  });

  it("No-limit forwards the value or discards it", () => {
    expect(applyFilter(conv(0, "1", "4", "-50", "150"), 20)).toEqual({ kind: "value", value: 20 });
    expect(applyFilter(conv(0, "1", "4", "-50", "150"), 200)).toEqual({ kind: "discarded" });
    // Less than compares against Param4.
    expect(applyFilter(conv(0, "1", "2", "999", "10"), 5)).toEqual({ kind: "value", value: 5 });
  });

  it("Limited replaces the failing value by the limit", () => {
    expect(applyFilter(conv(0, "2", "4", "-50", "150"), 200)).toEqual({ kind: "value", value: 150 });
    expect(applyFilter(conv(0, "2", "4", "-50", "150"), -80)).toEqual({ kind: "value", value: -50 });
    expect(applyFilter(conv(0, "2", "2", "0", "10"), 12)).toEqual({ kind: "value", value: 10 });
    expect(applyFilter(conv(0, "2", "3", "5", "0"), 2)).toEqual({ kind: "value", value: 5 });
    // Out of range: values inside the range become Low.
    expect(applyFilter(conv(0, "2", "5", "5", "15"), 10)).toEqual({ kind: "value", value: 5 });
    expect(applyFilter(conv(0, "2", "5", "5", "15"), 20)).toEqual({ kind: "value", value: 20 });
    // Equal: every value becomes the limit.
    expect(applyFilter(conv(0, "2", "0", "7", "0"), 3)).toEqual({ kind: "value", value: 7 });
  });
});

describe("applyConversion", () => {
  it("scale limits the input and maps it, and the inverse swaps the ranges", () => {
    const scale = conv(1, "0", "1000", "0", "100");
    expect(applyConversion(scale, 750)).toEqual({ kind: "value", value: 75 });
    expect(applyConversion(scale, 2000)).toEqual({ kind: "value", value: 100 });
    expect(applyConversion(scale, 40, true)).toEqual({ kind: "value", value: 400 });
  });

  it("arithmetic is x · 10^A · B + C and its inverse (x − C) / (B · 10^A)", () => {
    const tenths = conv(2, "-1", "1", "0", "0");
    expect(applyConversion(tenths, 215)).toEqual({ kind: "value", value: 21.5 });
    expect(applyConversion(tenths, 21.5, true)).toEqual({ kind: "value", value: 215 });
    const kelvin = conv(2, "0", "1", "-273.15", "0");
    expect(applyConversion(kelvin, 300, true)).toEqual({ kind: "value", value: 573.15 });
    expect(applyConversion(conv(2, "0", "0", "5", "0"), 1, true)).toEqual({ kind: "undefined" });
  });
});

describe("conversionSummary", () => {
  it("prints filters like GetFilterFormula (Less than uses Param4)", () => {
    expect(conversionSummary(conv(0, "1", "3", "0", "100"))).toBe("> 0");
    expect(conversionSummary(conv(0, "1", "2", "0", "100"))).toBe("< 100");
    expect(conversionSummary(conv(0, "1", "4", "-50", "150"))).toBe("−50 ≤ x ≤ 150");
    expect(conversionSummary(conv(0, "1", "5", "5", "15"))).toBe("x < 5 or x > 15");
  });

  it("simplifies arithmetic and writes its inverse", () => {
    expect(conversionSummary(conv(2, "-1", "1", "0", "0"))).toBe("y = x · 0.1");
    expect(conversionSummary(conv(2, "-1", "1", "0", "0"), true)).toBe("y = x / 0.1");
    expect(conversionSummary(conv(2, "0", "1", "-273.15", "0"))).toBe("y = x − 273.15");
    expect(conversionSummary(conv(2, "0", "1", "-273.15", "0"), true)).toBe("y = x + 273.15");
    expect(conversionSummary(conv(2, "0", "2", "5", "0"))).toBe("y = x · 2 + 5");
    expect(conversionSummary(conv(2, "0", "2", "5", "0"), true)).toBe("y = (x − 5) / 2");
    expect(conversionSummary(conv(2, "3", "0", "7", "0"))).toBe("y = 7");
  });

  it("prints scales and logical masks", () => {
    expect(conversionSummary(conv(1, "0", "1000", "0", "100"))).toBe("0…1000 → 0…100");
    expect(conversionSummary(conv(1, "0", "1000", "0", "100"), true)).toBe("0…100 → 0…1000");
    expect(conversionSummary(conv(3, "8", "0", "1", "0"))).toBe("OR 1000 · XOR 1");
  });
});

describe("conversionExplanation", () => {
  it("explains each filter type as ApplyFilter behaves", () => {
    expect(conversionExplanation(conv(0, "1", "4", "-50", "150"))).toBe(
      "Forwards the value when the value is from −50 to 150. Any other value is not forwarded.",
    );
    expect(conversionExplanation(conv(0, "2", "4", "-50", "150"))).toBe(
      "Values below −50 become −50 and values above 150 become 150.",
    );
    expect(conversionExplanation(conv(0, "0", "3", "0", "0"))).toBe("Sends 1 when the value is greater than 0, and 0 otherwise.");
  });
});
