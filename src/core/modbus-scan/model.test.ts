import { describe, expect, it } from "vitest";
import { scanInputSchema, scanPoints, estimateScan, emptyScanResult, interpretations } from "./model";
describe("scan limits and interpretation", () => {
  it("counts function/address pairs separately", () => { const input = scanInputSchema.parse({ projectId: "p", locator: { kind: "rtu", nodeIndex: 0 }, slave: 1, ranges: [1,2,3,4].map((functionCode) => ({ function: functionCode, start: 0, end: 255 })) }); expect(scanPoints(input)).toHaveLength(1024); expect(estimateScan(input).batches).toBe(4); });
  it("rejects ranges beyond the configured total without silently truncating", () => { const input = scanInputSchema.parse({ projectId: "p", locator: { kind: "rtu", nodeIndex: 0 }, slave: 1, maxPoints: 256, ranges: [{ function: 3, start: 0, end: 256 }] }); expect(() => scanPoints(input)).toThrow("limit"); });
  it("does not claim a type or meaning from raw FFFF", () => { const row = { ...emptyScanResult({ function: 3, address: 110 }), lastValue: 65535, values: [65535], samples: 2 }; expect(interpretations(row)).toEqual(["uint16 65535", "int16 -1", "Possible sentinel / bitmask; unconfirmed"]); });
});
