import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { XmlDocument } from "./document";
import { parseCompleteBlob } from "../complete-blob";
import { extractIbmaps } from "../zip";

/**
 * Gate test against the real reference material (gitignored under temp/).
 * It is BACnet↔MBM, not KNX–MBM, but the envelope/ZIP/complete mechanics are
 * generic. Skipped when the reference repo is not present (e.g. CI).
 */
const REFERENCE_IBMAPS =
  "temp/maps-cloud/xbl-spec/referencia/IN-BAC-MBM-ATW.ibmaps";
const REFERENCE_COMPLETE =
  "temp/maps-cloud/xbl-spec/referencia/projecte_192_168_2_34.bin";

describe("reference fixtures (present only in the local research checkout)", () => {
  it("round-trips the real .ibmaps byte-identical", () => {
    if (!existsSync(REFERENCE_IBMAPS)) return; // skip silently outside the research checkout
    const original = readFileSync(REFERENCE_IBMAPS, "utf8");
    const doc = XmlDocument.parse(original);
    expect(doc.serialize()).toBe(original);
  });

  it("parses the real complete blob and extracts a valid .ibmaps", () => {
    if (!existsSync(REFERENCE_COMPLETE)) return;
    const raw = new Uint8Array(readFileSync(REFERENCE_COMPLETE));
    const blob = parseCompleteBlob(raw);
    expect(blob.xbl.length).toBe(14619);
    const ibmaps = extractIbmaps(blob.zip);
    expect(ibmaps.name).toMatch(/\.ibmaps$/);
    expect(ibmaps.xml).toContain("<Project ");
    // The XML inside the reference ZIP must also round-trip byte-identical.
    expect(XmlDocument.parse(ibmaps.xml).serialize()).toBe(ibmaps.xml);
  });
});
