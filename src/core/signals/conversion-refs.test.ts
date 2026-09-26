import { describe, expect, it } from "vitest";
import { formatConversionIds, readHalfConversionRefs } from "./conversion-refs";

describe("conversion refs", () => {
  it("reads both lists of one half", () => {
    expect(readHalfConversionRefs("2,1", "0,0;1,0")).toEqual({
      filters: [{ index: 2, inverted: true }],
      operations: [
        { index: 0, inverted: false },
        { index: 1, inverted: false },
      ],
    });
    expect(readHalfConversionRefs(undefined, "")).toEqual({ filters: [], operations: [] });
  });

  it("formats refs like IntesisXML.GetConversionIDsXMLString, without a trailing separator", () => {
    expect(formatConversionIds([])).toBe("");
    expect(formatConversionIds(readHalfConversionRefs(undefined, "1,1;0,1;").operations)).toBe("1,1;0,1");
  });
});
