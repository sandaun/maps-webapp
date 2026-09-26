import { describe, expect, it } from "vitest";
import { formatConversionIds, readHalfConversionRefs, refsFromSelection } from "./conversion-refs";

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

describe("refsFromSelection (frmSelectConversion.SaveObjectsConfiguration)", () => {
  const ref = (index: number, inverted = false) => ({ index, inverted });
  // KNX-side filter 4, operations A=0 (next to KNX) then B=1, Modbus-side filter 2.
  const selection = { internalFilter: 4, operations: [0, 1], externalFilter: 2, master: "internal" as const };

  it("defines the internal flow and inverts the external one for read + write signals", () => {
    expect(refsFromSelection(selection, "readwrite")).toEqual({
      internal: { filters: [ref(4), ref(2, true)], operations: [ref(0), ref(1)] },
      external: { filters: [ref(2), ref(4, true)], operations: [ref(1, true), ref(0, true)] },
    });
  });

  it("inverts the internal flow instead when the external one is the master", () => {
    expect(refsFromSelection({ ...selection, master: "external" }, "readwrite")).toEqual({
      internal: { filters: [ref(4), ref(2, true)], operations: [ref(0, true), ref(1, true)] },
      external: { filters: [ref(2), ref(4, true)], operations: [ref(1), ref(0)] },
    });
  });

  it("only fills the external half of a read signal, not inverted", () => {
    expect(refsFromSelection({ ...selection, master: "external" }, "read")).toEqual({
      internal: { filters: [], operations: [] },
      external: { filters: [ref(2), ref(4, true)], operations: [ref(1), ref(0)] },
    });
  });

  it("only fills the internal half of a write signal, not inverted", () => {
    expect(refsFromSelection({ ...selection, master: "external" }, "write")).toEqual({
      internal: { filters: [ref(4), ref(2, true)], operations: [ref(0), ref(1)] },
      external: { filters: [], operations: [] },
    });
  });

  it("clears both halves for an empty selection", () => {
    const none = { internalFilter: null, operations: [], externalFilter: null, master: "internal" as const };
    const empty = { filters: [], operations: [] };
    expect(refsFromSelection(none, "readwrite")).toEqual({ internal: empty, external: empty });
  });
});
