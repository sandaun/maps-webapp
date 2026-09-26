import { describe, expect, it } from "vitest";
import { refsFromSelection, type ConversionRwMode, type SignalConversionRefs } from "@/core/signals/conversion-refs";
import {
  flowSteps,
  libraryLists,
  refsRoundTrip,
  selectionFromSlots,
  simulateFlow,
  slotsFromRefs,
  type ConversionSlots,
} from "./assignment";

const ref = (index: number, inverted = false) => ({ index, inverted });
const MODES: ConversionRwMode[] = ["read", "write", "readwrite"];

function allSlots(): ConversionSlots[] {
  const out: ConversionSlots[] = [];
  const values = [null, 0, 1];
  for (const internalFilter of values)
    for (const op1 of values)
      for (const op2 of values)
        for (const externalFilter of values)
          for (const master of ["internal", "external"] as const)
            out.push({ internalFilter, op1, op2, externalFilter, master });
  return out;
}

/** The chain of one half as `CreateConversionList` builds it: own filters, operations, inverted filters. */
function halfChain(half: SignalConversionRefs["internal"]) {
  return [
    ...half.filters.filter((f) => !f.inverted).map((f) => ({ list: "filters", index: f.index, inverted: false })),
    ...half.operations.map((o) => ({ list: "operations", index: o.index, inverted: o.inverted })),
    ...half.filters.filter((f) => f.inverted).map((f) => ({ list: "filters", index: f.index, inverted: false })),
  ];
}

describe("slotsFromRefs (frmSelectConversion.SelectValues)", () => {
  it("reads back every selection MAPS saves", () => {
    for (const mode of MODES)
      for (const slots of allSlots()) {
        const refs = refsFromSelection(selectionFromSlots(slots), mode);
        expect(refsRoundTrip(refs, mode)).toBe(true);
      }
  });

  it("puts a single operation of the external half in the combo next to it", () => {
    const refs = { internal: { filters: [], operations: [] }, external: { filters: [], operations: [ref(3)] } };
    expect(slotsFromRefs(refs, "read")).toMatchObject({ op1: null, op2: 3 });
  });

  it("takes the external flow as defined when its first operation is not inverted", () => {
    const refs = {
      internal: { filters: [ref(0)], operations: [ref(1, true)] },
      external: { filters: [ref(0, true)], operations: [ref(1)] },
    };
    expect(slotsFromRefs(refs, "readwrite")).toEqual({
      internalFilter: 0,
      op1: 1,
      op2: null,
      externalFilter: null,
      master: "external",
    });
  });

  it("flags refs MAPS would not write, such as the same operations on both halves", () => {
    const refs = { internal: { filters: [], operations: [ref(0)] }, external: { filters: [], operations: [ref(0)] } };
    expect(refsRoundTrip(refs, "readwrite")).toBe(false);
    expect(refsRoundTrip(refs, "read")).toBe(false);
  });
});

describe("flowSteps", () => {
  it("follows exactly the chain the gateway builds from the refs of each half", () => {
    for (const mode of MODES)
      for (const slots of allSlots()) {
        const refs = refsFromSelection(selectionFromSlots(slots), mode);
        const steps = (flow: "write" | "read") =>
          flowSteps(flow, mode, slots).map(({ list, index, inverted }) => ({ list, index, inverted }));
        if (mode !== "read") expect(steps("write")).toEqual(halfChain(refs.internal));
        if (mode !== "write") expect(steps("read")).toEqual(halfChain(refs.external));
      }
  });
});

describe("simulateFlow", () => {
  const library = libraryLists([
    { type: 0, description: "Valid", params: ["1", "4", "-50", "150"] as const },
    { type: 1, description: "Fan %", params: ["0", "1000", "0", "100"] as const },
    { type: 2, description: "x0.1", params: ["-1", "1", "0", "0"] as const },
    { type: 4, description: "LUT", params: ["0", "0", "0", "0"] as const },
  ]);
  const slots: ConversionSlots = { internalFilter: null, op1: 0, op2: null, externalFilter: 0, master: "internal" };

  it("runs the defined flow as written and the other one inverted", () => {
    // Write is the defined flow: 0…1000 → 0…100 as written, then the Modbus-side filter.
    expect(simulateFlow("write", "readwrite", slots, library, 40).map((s) => s.outcome)).toEqual([
      { kind: "value", value: 4 },
      { kind: "value", value: 4 },
    ]);
    expect(simulateFlow("write", "readwrite", slots, library, 2000).map((s) => s.outcome)).toEqual([
      { kind: "value", value: 100 },
      { kind: "value", value: 100 },
    ]);
    expect(simulateFlow("read", "readwrite", slots, library, 750).map((s) => s.outcome)).toEqual([
      { kind: "discarded" },
    ]);
    expect(simulateFlow("read", "readwrite", slots, library, 100).map((s) => s.outcome)).toEqual([
      { kind: "value", value: 100 },
      { kind: "value", value: 1000 },
    ]);
  });

  it("stops at LUT and logical operations and at missing entries", () => {
    expect(simulateFlow("read", "read", { ...slots, externalFilter: null, op1: 2 }, library, 1)[0].outcome).toEqual({
      kind: "not-simulated",
    });
    expect(simulateFlow("read", "read", { ...slots, externalFilter: 5 }, library, 1)[0].outcome).toEqual({
      kind: "missing",
    });
  });
});
