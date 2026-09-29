import { describe, expect, it } from "vitest";
import { setAttr, XmlDocument } from "@/core/project-format";
import { refsFromSelection, type ConversionSelection } from "@/core/signals/conversion-refs";
import { refsRoundTrip } from "@/core/conversions/assignment";
import { mbsConversionRwMode } from "@/protocols/modbus/slave";
import { SYNTHETIC_MBS_KNX_XML } from "./fixtures/synthetic-project";
import { mbsKnxRestoredRefs, mbsKnxSelectionRefs } from "./conversions";
import { projectFromXml } from "./from-xml";
import { addConversion, removeConversion, updateConversion, updateSignal } from "./xml-ops";

function parseFixture() {
  return XmlDocument.parse(SYNTHETIC_MBS_KNX_XML);
}

const SELECTION: ConversionSelection = { internalFilter: null, externalFilter: null, operations: [0], master: "internal" };

describe("synthetic fixture", () => {
  it("stores its conversions the way MAPS does (a new project shows no non-standard refs)", () => {
    for (const signal of projectFromXml(parseFixture()).signals) {
      expect(refsRoundTrip(signal.conversions, mbsConversionRwMode(signal.modbus.readWrite))).toBe(true);
    }
  });
});

describe("mbsKnxSelectionRefs", () => {
  it("takes the direction from the Modbus read/write mode (ConversionObject(MbsObject))", () => {
    const doc = parseFixture();
    const refsOf = (id: number) => {
      const result = mbsKnxSelectionRefs(doc, id, SELECTION);
      if ("error" in result) throw new Error(result.error);
      return result.refs;
    };
    expect(refsOf(0)).toEqual(refsFromSelection(SELECTION, "readwrite")); // Read/Write
    expect(refsOf(1)).toEqual(refsFromSelection(SELECTION, "read")); // Read
    expect(refsOf(3)).toEqual(refsFromSelection(SELECTION, "write")); // Trigger
    expect(refsOf(1)).not.toEqual(refsOf(3));
  });

  it("uses the read/write mode the same edit sets", () => {
    const doc = parseFixture();
    // Signal 1 is Read; the edit turns it into a Trigger.
    expect(mbsKnxSelectionRefs(doc, 1, SELECTION, 1)).toEqual({ refs: refsFromSelection(SELECTION, "write") });
  });

  it("refuses virtual rows, unknown signals and positions outside the lists", () => {
    const doc = parseFixture();
    const virt = doc.findAll(["InternalProtocol", "Signals", "Signal"])[0].children.find(
      (c) => c.kind === "element" && c.tag === "Virtual",
    );
    if (virt && virt.kind === "element") setAttr(virt, "Status", "True");
    expect(mbsKnxSelectionRefs(doc, 0, SELECTION)).toEqual({
      error: "Signal 1 is virtual; virtual signals cannot have conversions.",
    });
    expect(mbsKnxSelectionRefs(doc, 42, SELECTION)).toEqual({ error: "Signal 42 does not exist." });
    // The fixture has no filters and a single operation.
    expect(mbsKnxSelectionRefs(doc, 1, { ...SELECTION, internalFilter: 0 })).toEqual({
      error: "Signal 2 uses a conversion that is not in the project.",
    });
    expect(mbsKnxSelectionRefs(doc, 1, { ...SELECTION, operations: [1] })).toEqual({
      error: "Signal 2 uses a conversion that is not in the project.",
    });
  });
});

describe("mbsKnxRestoredRefs", () => {
  it("restores refs exactly as given, within the lists", () => {
    const doc = parseFixture();
    const refs = {
      internal: { filters: [], operations: [{ index: 0, inverted: true }] },
      external: { filters: [], operations: [{ index: 0, inverted: true }] },
    };
    expect(mbsKnxRestoredRefs(doc, 1, refs)).toEqual({ refs });
    expect(
      mbsKnxRestoredRefs(doc, 1, { ...refs, external: { filters: [{ index: 0, inverted: false }], operations: [] } }),
    ).toEqual({ error: "Signal 2 uses a conversion that is not in the project." });
  });
});

describe("conversion library on an MBS–KNX project", () => {
  it("adds and edits entries of the shared library", () => {
    const doc = parseFixture();
    expect(addConversion(doc, 0)).toBe(0);
    expect(addConversion(doc, 1)).toBe(1);
    updateConversion(doc, { list: "operations", index: 1 }, { description: "Scale 2" });
    expect(projectFromXml(doc).conversions.map((c) => [c.type, c.description])).toEqual([
      [0, "Filter_0"],
      [2, "x 10"],
      [1, "Scale 2"],
    ]);
  });

  it("removing an entry fixes the refs of both halves of every row, disabled ones included", () => {
    const doc = parseFixture();
    addConversion(doc, 0); // filter 0
    addConversion(doc, 2); // operation 1
    const refs = {
      internal: { filters: [{ index: 0, inverted: false }], operations: [{ index: 0, inverted: false }, { index: 1, inverted: false }] },
      external: { filters: [], operations: [{ index: 1, inverted: true }] },
    };
    updateSignal(doc, 1, { conversionRefs: refs });
    updateSignal(doc, 4, { conversionRefs: refs }); // disabled row
    expect(removeConversion(doc, { list: "operations", index: 0 })).toEqual([0, 1, 4]);
    const signals = projectFromXml(doc).signals;
    for (const id of [1, 4]) {
      expect(signals[id].conversions).toEqual({
        internal: { filters: [{ index: 0, inverted: false }], operations: [{ index: 0, inverted: false }] },
        external: { filters: [], operations: [{ index: 0, inverted: true }] },
      });
    }
    // Signal 0 only used the removed operation.
    expect(signals[0].conversions.internal.operations).toEqual([]);
    // The filters list is separate: removing filter 0 does not touch the operation refs.
    expect(removeConversion(doc, { list: "filters", index: 0 })).toEqual([1, 4]);
    expect(projectFromXml(doc).signals[1].conversions.internal).toEqual({
      filters: [],
      operations: [{ index: 0, inverted: false }],
    });
  });
});
