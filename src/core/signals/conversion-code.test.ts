import { describe, expect, it } from "vitest";
import { conversionCode as fromRefs } from "./conversion-code";
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
