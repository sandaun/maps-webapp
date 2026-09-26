import { describe, expect, it } from "vitest";
import { conversionCode as fromRefs, parseConversionCode } from "./conversion-code";
import { readHalfConversionRefs, type HalfConversionRefs } from "./conversion-refs";

type RawHalf = { filters: string | undefined; operations: string | undefined };

const none: RawHalf = { filters: "", operations: "" };
const half = (raw: RawHalf): HalfConversionRefs => readHalfConversionRefs(raw.filters, raw.operations);
const conversionCode = (internal: RawHalf, external: RawHalf) =>
  fromRefs({ internal: half(internal), external: half(external) });

describe("conversionCode (IntesisConversion.CreateStringFromConversions)", () => {
  it("returns a dash when neither side has conversions", () => {
    expect(conversionCode(none, none)).toBe("-");
    expect(conversionCode({ filters: undefined, operations: undefined }, none)).toBe("-");
  });

  it("marks internal-only conversions as >", () => {
    expect(conversionCode({ filters: "", operations: "3,0" }, none)).toBe("DIRECTION[>]:INDEXES[-;3;-;-]");
  });

  it("marks external-only conversions as < and mirrors the slot order", () => {
    expect(conversionCode(none, { filters: "2,0", operations: "4,0;5,0" })).toBe(
      "DIRECTION[<]:INDEXES[-;5;4;2]",
    );
  });

  it("shows the internal side as >/< when both sides are set like SaveOperations", () => {
    expect(
      conversionCode({ filters: "", operations: "0,0;1,0" }, { filters: "", operations: "1,1;0,1" }),
    ).toBe("DIRECTION[>/<]:INDEXES[-;0;1;-]");
  });

  it("shows </> when every internal operation is inverted", () => {
    expect(conversionCode({ filters: "", operations: "0,1" }, { filters: "", operations: "0,0" })).toBe(
      "DIRECTION[</>]:INDEXES[-;0;-;-]",
    );
  });

  it("puts a lone inverted filter in the last slot", () => {
    expect(conversionCode({ filters: "7,1", operations: "" }, none)).toBe("DIRECTION[>]:INDEXES[-;-;-;7]");
    expect(conversionCode({ filters: "7,0;8,1", operations: "" }, none)).toBe("DIRECTION[>]:INDEXES[7;-;-;8]");
  });
});

describe("parseConversionCode (IntesisConversion.ConvertStringToConversion)", () => {
  const ref = (index: number, inverted = false) => ({ index, inverted });

  it("reads a dash or an empty cell as no conversions", () => {
    const empty = { internal: { filters: [], operations: [] }, external: { filters: [], operations: [] } };
    expect(parseConversionCode("-")).toEqual(empty);
    expect(parseConversionCode("")).toEqual(empty);
  });

  it("rejects text that fails the MAPS format check", () => {
    expect(parseConversionCode("DIRECTION[>]:INDEXES[1;2]")).toBeUndefined();
    expect(parseConversionCode("DIRECTION[x]:INDEXES[-;1;-;-]")).toBeUndefined();
    expect(parseConversionCode("0,0;1,0")).toBeUndefined();
    expect(parseConversionCode("DIRECTION[>]:INDEXES[-;40000;-;-]")).toBeUndefined();
  });

  it("fills only the internal half for >", () => {
    expect(parseConversionCode("DIRECTION[>]:INDEXES[2;3;4;5]")).toEqual({
      internal: { filters: [ref(2), ref(5, true)], operations: [ref(3), ref(4)] },
      external: { filters: [], operations: [] },
    });
  });

  it("fills only the external half for <, mirrored", () => {
    expect(parseConversionCode("DIRECTION[<]:INDEXES[-;5;4;2]")).toEqual({
      internal: { filters: [], operations: [] },
      external: { filters: [ref(2)], operations: [ref(4), ref(5)] },
    });
  });

  it("derives the inverted external half for >/< and the inverted internal half for </>", () => {
    expect(parseConversionCode("DIRECTION[>/<]:INDEXES[-;0;1;-]")).toEqual({
      internal: { filters: [], operations: [ref(0), ref(1)] },
      external: { filters: [], operations: [ref(1, true), ref(0, true)] },
    });
    expect(parseConversionCode("DIRECTION[</>]:INDEXES[-;0;-;-]")).toEqual({
      internal: { filters: [], operations: [ref(0, true)] },
      external: { filters: [], operations: [ref(0)] },
    });
  });

  it("skips a leading MAP index", () => {
    expect(parseConversionCode("DIRECTION[>]:INDEXES[9;-;3;-;-]")?.internal.operations).toEqual([ref(3)]);
  });

  it("round-trips the refs frmSelectConversion saves", () => {
    // Internal defined: F on the KNX side, ops A=0 then B=1 (SaveOperations / SaveFilters).
    const saved = {
      internal: { filters: [ref(4)], operations: [ref(0), ref(1)] },
      external: { filters: [ref(4, true)], operations: [ref(1, true), ref(0, true)] },
    };
    expect(parseConversionCode(fromRefs(saved))).toEqual(saved);
  });
});
