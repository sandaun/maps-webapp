import { describe, expect, it } from "vitest";
import { formatSingle, parseMapsSingle } from "./single";

describe("parseMapsSingle (GetInnerTextWithDefault → float)", () => {
  it("reads invariant floats, with a comma accepted as the decimal point", () => {
    expect(parseMapsSingle("2.5")).toBe(2.5);
    expect(parseMapsSingle("2,5")).toBe(2.5);
    expect(parseMapsSingle(" 1E-05 ")).toBe(Math.fround(1e-5));
    expect(parseMapsSingle("0.1")).toBe(Math.fround(0.1));
  });

  it("falls back when the text is missing or not a number", () => {
    expect(parseMapsSingle(undefined)).toBe(0);
    expect(parseMapsSingle("")).toBe(0);
    expect(parseMapsSingle("abc", 7)).toBe(7);
  });
});

describe("formatSingle (float.ToString on .NET 10)", () => {
  it("writes the shortest text that reads back as the same float", () => {
    expect(formatSingle(0)).toBe("0");
    expect(formatSingle(2.5)).toBe("2.5");
    expect(formatSingle(0.1)).toBe("0.1");
    expect(formatSingle(Math.fround(0.1))).toBe("0.1");
    expect(formatSingle(12.345678)).toBe("12.345678");
    expect(formatSingle(100)).toBe("100");
    expect(formatSingle(0.0001)).toBe("0.0001");
  });

  it("switches to scientific notation below 1E-04", () => {
    expect(formatSingle(0.00001)).toBe("1E-05");
    expect(formatSingle(0.0000015)).toBe("1.5E-06");
  });
});
