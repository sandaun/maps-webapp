import { describe, expect, it } from "vitest";
import { conversionErrors, defaultConversion, parseConversionNumber, type ConversionValues } from "./rules";

const filter = (p1: string, p2: string, p3: string, p4: string, description = "F"): ConversionValues => ({
  type: 0,
  description,
  params: [p1, p2, p3, p4],
});
const op = (type: number, params: [string, string, string, string], description = "Op"): ConversionValues => ({
  type,
  description,
  params,
});

describe("parseConversionNumber", () => {
  it("reads '.' and ',' like GetFloatValue and rejects anything else", () => {
    expect(parseConversionNumber("0.1")).toBe(0.1);
    expect(parseConversionNumber("0,1")).toBe(0.1);
    expect(parseConversionNumber("−273.15")).toBe(-273.15);
    expect(parseConversionNumber("")).toBeUndefined();
    expect(parseConversionNumber("1e3")).toBeUndefined();
    expect(parseConversionNumber("abc")).toBeUndefined();
  });
});

describe("conversionErrors", () => {
  it("accepts Low = High on the range filters and rejects Low > High (ValidateFiltersValue)", () => {
    expect(conversionErrors(filter("1", "4", "5", "5"))).toEqual({});
    expect(conversionErrors(filter("1", "4", "6", "5"))).toEqual({ param4: "Low must not be greater than High." });
    expect(conversionErrors(filter("1", "5", "6", "5"), new Set(["param3"]))).toEqual({
      param3: "Low must not be greater than High.",
    });
  });

  it("checks only the values the comparison uses: Less than uses Param4", () => {
    expect(conversionErrors(filter("0", "2", "abc", "10"))).toEqual({});
    expect(conversionErrors(filter("0", "2", "0", "abc"))).toEqual({ param4: "Enter a number." });
    expect(conversionErrors(filter("0", "3", "abc", "0"))).toEqual({ param3: "Enter a number." });
  });

  it("limits filter values to ±100000 with 2 decimals", () => {
    expect(conversionErrors(filter("1", "3", "100000", "0"))).toEqual({});
    expect(conversionErrors(filter("1", "3", "100000.01", "0")).param3).toBe("Enter a value from −100000 to 100000.");
    expect(conversionErrors(filter("1", "3", "0.125", "0")).param3).toBe("Use at most 2 decimals.");
  });

  it("has no range limit on operations, only the 2 decimals", () => {
    expect(conversionErrors(op(2, ["0", "250000", "-1000000", "0"]))).toEqual({});
    expect(conversionErrors(op(2, ["-1", "0.001", "0", "0"])).param2).toBe("Use at most 2 decimals.");
  });

  it("rejects scale ranges with min > max and with equal ends", () => {
    expect(conversionErrors(op(1, ["0", "1000", "0", "100"]))).toEqual({});
    expect(conversionErrors(op(1, ["10", "0", "0", "100"])).param2).toBe("Input min must not be greater than input max.");
    expect(conversionErrors(op(1, ["0", "10", "5", "5"])).param4).toBe("Output min and max must be different.");
  });

  it("limits the operation description to 32 characters and the filter one to 255", () => {
    expect(conversionErrors(op(2, ["0", "1", "0", "0"], "x".repeat(32)))).toEqual({});
    expect(conversionErrors(op(2, ["0", "1", "0", "0"], "x".repeat(33))).description).toBe("Maximum 32 characters.");
    expect(conversionErrors(filter("1", "3", "0", "100", "x".repeat(200)))).toEqual({});
  });

  it("only checks what is being written, so imported values stay untouched", () => {
    const imported = op(2, ["-1", "0.001", "0", "0"]);
    expect(conversionErrors(imported, new Set(["description"]))).toEqual({});
    expect(conversionErrors(imported, new Set(["param2"])).param2).toBe("Use at most 2 decimals.");
  });

  it("checks the params a new comparison or operation type puts to use", () => {
    expect(conversionErrors(filter("1", "4", "150", "100"), new Set(["param2"]))).toEqual({
      param4: "Low must not be greater than High.",
    });
    expect(conversionErrors(op(1, ["0", "1", "0", "0"]), new Set(["type"])).param4).toBe(
      "Output min and max must be different.",
    );
  });

  it("refuses to edit system entries", () => {
    expect(conversionErrors(op(4, ["0", "0", "0", "0"])).type).toBe("System conversions cannot be edited.");
    expect(conversionErrors(op(3, ["1", "0", "0", "0"])).type).toBe("System conversions cannot be edited.");
  });
});

describe("defaultConversion", () => {
  it("creates the MAPS defaults (CreateDefaultFilter / CreateDefaultOperation)", () => {
    expect(defaultConversion(0, 2)).toEqual({ id: 2, description: "Filter_2", type: 0, params: ["0", "3", "0", "100"] });
    expect(defaultConversion(1, 0)).toEqual({ id: 0, description: "Operation_0", type: 1, params: ["0", "3", "0", "100"] });
    expect(defaultConversion(2, 1)).toEqual({ id: 1, description: "Operation_1", type: 2, params: ["0", "1", "0", "0"] });
  });
});
