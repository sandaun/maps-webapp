import { describe, expect, it } from "vitest";
import { buildProjectZip, extractIbmaps } from "./zip";

const xml = "\uFEFF<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n<Project />\r\n";

describe("project ZIP", () => {
  it("round-trips build → extract", () => {
    const zip = buildProjectZip("Demo", xml);
    const out = extractIbmaps(zip);
    expect(out.name).toBe("Demo.ibmaps");
    expect(out.xml).toBe(xml);
  });

  it("is deterministic (identical bytes for identical input)", () => {
    const a = buildProjectZip("Demo", xml);
    const b = buildProjectZip("Demo", xml);
    expect([...a]).toEqual([...b]);
  });

  it("rejects a ZIP without a .ibmaps entry", () => {
    expect(() => extractIbmaps(new Uint8Array([1, 2, 3]))).toThrow(/Invalid project ZIP/);
  });
});
