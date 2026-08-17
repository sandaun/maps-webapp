import { describe, expect, it } from "vitest";
import {
  applyFlagChange,
  DEFAULT_FLAGS,
  DEFAULT_PHYSICAL_ADDRESS,
  formatDpt,
  formatGroupAddress,
  formatPhysicalAddress,
  isValidDpt,
  isValidGroupAddress,
  parseDpt,
  parseGroupAddress,
  parsePhysicalAddress,
} from "./index";

describe("DPT", () => {
  it("encodes/decodes main*256+sub", () => {
    expect(parseDpt("1.001")).toBe(257);
    expect(parseDpt("9.001")).toBe(2305);
    expect(formatDpt(2305)).toBe("9.001");
    expect(formatDpt(parseDpt("1.x")!)).toBe("1.x");
  });

  it("validates against the COMMON selection only", () => {
    expect(isValidDpt(257)).toBe(true); // 1.001
    expect(isValidDpt(2305)).toBe(true); // 9.001
    expect(isValidDpt(parseDpt("10.001")!)).toBe(false); // family 10 not offered
    expect(isValidDpt(parseDpt("14.000")!)).toBe(true); // sub 0 allowed for 14
    expect(isValidDpt(parseDpt("2.x")!)).toBe(true); // wildcard
    expect(isValidDpt(parseDpt("2.001")!)).toBe(false); // no explicit subtypes for family 2
  });
});

describe("group addresses", () => {
  it("parses 3-level, 2-level and plain forms", () => {
    expect(parseGroupAddress("1/0/3")).toBe(2051);
    expect(parseGroupAddress("1/2")).toBe((1 << 11) + 2);
    expect(parseGroupAddress("2051")).toBe(2051);
    expect(parseGroupAddress("0/0/0")).toBe(0);
    expect(parseGroupAddress("32/0/0")).toBeUndefined();
    expect(parseGroupAddress("abc")).toBeUndefined();
    expect(parseGroupAddress("")).toBeUndefined();
  });

  it("formats 3-level", () => {
    expect(formatGroupAddress(2051)).toBe("1/0/3");
    expect(formatGroupAddress(65535)).toBe("31/7/255");
  });

  it("enforces the extended-addresses limit", () => {
    expect(isValidGroupAddress(32767, { extended: false })).toBe(true);
    expect(isValidGroupAddress(32768, { extended: false })).toBe(false);
    expect(isValidGroupAddress(32768, { extended: true })).toBe(true);
    expect(isValidGroupAddress(0, { extended: true })).toBe(false);
  });
});

describe("physical address", () => {
  it("parses and formats", () => {
    expect(parsePhysicalAddress(DEFAULT_PHYSICAL_ADDRESS)).toBe(65535);
    expect(formatPhysicalAddress(65535)).toBe("15.15.255");
    expect(parsePhysicalAddress("1.1.200")).toBe((1 << 12) + (1 << 8) + 200);
    expect(parsePhysicalAddress("0.0.0")).toBeUndefined();
    expect(parsePhysicalAddress("16.0.1")).toBeUndefined();
  });
});

describe("flags", () => {
  it("Ri forces U and clears R", () => {
    const next = applyFlagChange({ ...DEFAULT_FLAGS, ri: true, r: true, u: false }, "ri");
    expect(next).toMatchObject({ ri: true, u: true, r: false });
  });
  it("R clears Ri", () => {
    const next = applyFlagChange({ ...DEFAULT_FLAGS, ri: true, r: true }, "r");
    expect(next).toMatchObject({ r: true, ri: false });
  });
  it("clearing U clears Ri", () => {
    const next = applyFlagChange({ ...DEFAULT_FLAGS, ri: true, u: false }, "u");
    expect(next).toMatchObject({ u: false, ri: false });
  });
});
