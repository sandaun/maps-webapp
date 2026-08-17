import { describe, expect, it } from "vitest";
import { checkMbmSignal, type MbmSignalShape } from "./rules";

const BASE: MbmSignalShape = {
  isBroadcast: false,
  readFunc: 3,
  writeFunc: -1,
  lenBits: 16,
  format: 0,
  byteOrder: 0,
  bit: -1,
  numOfBits: -1,
  address: 10,
  deviceBase: 0,
};

describe("checkMbmSignal", () => {
  it("accepts a valid holding-register read", () => {
    expect(checkMbmSignal(BASE)).toEqual([]);
  });

  it("rejects both functions unset", () => {
    expect(checkMbmSignal({ ...BASE, readFunc: -1 })).toContain("MB-FUNC-PAIR");
  });

  it("rejects coil read + register write pairing", () => {
    expect(checkMbmSignal({ ...BASE, readFunc: 1, writeFunc: 6, lenBits: 16 })).toContain("MB-FUNC-PAIR");
  });

  it("rejects LenBits=1 with register functions", () => {
    expect(checkMbmSignal({ ...BASE, readFunc: 3, lenBits: 1, format: 0, byteOrder: 0 })).toContain("MB-LEN-FORMAT");
  });

  it("rejects LenBits=48 with Float", () => {
    expect(checkMbmSignal({ ...BASE, lenBits: 48, format: 3 })).toContain("MB-LEN-FORMAT");
  });

  it("rejects LenBits=16 with word-inverted byte orders", () => {
    expect(checkMbmSignal({ ...BASE, lenBits: 16, byteOrder: 2 })).toContain("MB-LEN-FORMAT");
  });

  it("rejects FC6 with LenBits other than 16", () => {
    expect(checkMbmSignal({ ...BASE, readFunc: -1, writeFunc: 6, lenBits: 32 })).toContain("MB-LEN-FORMAT");
  });

  it("checks bitfield ranges", () => {
    expect(checkMbmSignal({ ...BASE, lenBits: 32, format: 4, bit: 0, numOfBits: 4 })).toContain("MB-BIT-RANGE");
    expect(checkMbmSignal({ ...BASE, lenBits: 16, format: 4, bit: 15, numOfBits: 2 })).toContain("MB-BIT-RANGE");
    expect(checkMbmSignal({ ...BASE, lenBits: 16, format: 4, bit: 0, numOfBits: 16 })).toEqual([]);
  });

  it("rejects address 0 on 1-based devices", () => {
    expect(checkMbmSignal({ ...BASE, address: 0, deviceBase: 1 })).toContain("MB-ADDRESS-BASE");
  });

  it("rejects broadcast signals with read function", () => {
    expect(checkMbmSignal({ ...BASE, isBroadcast: true })).toContain("MB-BROADCAST");
  });
});
