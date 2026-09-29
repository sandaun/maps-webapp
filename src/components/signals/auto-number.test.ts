import { describe, expect, it } from "vitest";
import { planAutoNumber, type AutoNumberRow } from "./auto-number";

const rows: AutoNumberRow[] = [
  { id: 0, description: "First", address: 8, groupAddress: 2049, virtual: false },
  { id: 1, description: "Virtual", address: 9, groupAddress: 2050, virtual: true },
  { id: 2, description: "Last", address: 10, groupAddress: 2051, virtual: false },
];

describe("auto-number plan", () => {
  it("uses table order, including noncontiguous selection, and does not advance for skipped virtual rows", () => {
    const plan = planAutoNumber({
      rows,
      selected: new Set([2, 1, 0]),
      field: "modbus",
      start: "100",
      increment: "2",
      min: 0,
      max: 65535,
      level: 3,
      skipVirtual: true,
    });
    expect(plan.error).toBeUndefined();
    expect(plan.entries.map((entry) => entry.value)).toEqual([100, undefined, 102]);
  });

  it("validates the final KNX value with the actual increment and extended-address limit", () => {
    const input = {
      rows,
      selected: new Set([0, 2]),
      field: "knx" as const,
      start: "15/7/254",
      increment: "2",
      min: 1,
      level: 3 as const,
      skipVirtual: false,
    };
    expect(planAutoNumber({ ...input, max: 32767 }).error).toMatch(/exceeds/);
    expect(planAutoNumber({ ...input, max: 65535 }).entries.map((entry) => entry.value)).toEqual([32766, 32768]);
  });

  it("renders KNX at the chosen level without changing its numeric value", () => {
    const plan = planAutoNumber({
      rows,
      selected: new Set([0, 2]),
      field: "knx",
      start: "1/1/3",
      increment: "1",
      min: 1,
      max: 32767,
      level: 2,
      skipVirtual: false,
    });
    expect(plan.entries.map((entry) => [entry.value, entry.after])).toEqual([[2307, "1/259"], [2308, "1/260"]]);
  });
});
