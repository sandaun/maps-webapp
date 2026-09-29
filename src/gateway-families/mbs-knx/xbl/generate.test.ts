import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { childByTag, decodeElements } from "@/core/xbl";
import { SYNTHETIC_MBS_KNX_XML } from "../fixtures/synthetic-project";
import { generateMbsKnxXbl } from "./generate";
import { runMbsKnxXblPipeline } from "./pipeline";

const NOW = new Date("2026-01-01T00:00:00Z");

describe("generateMbsKnxXbl (synthetic)", () => {
  it("emits header, IBOX, the Modbus Slave node and the KNX node in the MAPS order", () => {
    const xbl = generateMbsKnxXbl(SYNTHETIC_MBS_KNX_XML, { now: NOW });
    expect(decodeElements(xbl).map((el) => el.tag)).toEqual([1, 2, 9, 4]);
  });

  it("is deterministic for a given timestamp", () => {
    expect(generateMbsKnxXbl(SYNTHETIC_MBS_KNX_XML, { now: NOW })).toEqual(generateMbsKnxXbl(SYNTHETIC_MBS_KNX_XML, { now: NOW }));
  });

  it("keeps only the enabled Modbus rows, sorted by address and bit, and relinks the KNX objects", () => {
    const pipeline = runMbsKnxXblPipeline(XmlDocument.parse(SYNTHETIC_MBS_KNX_XML));
    // Row 4 is disabled.
    expect(pipeline.mbs.signals.map((s) => [s.address, s.configId])).toEqual([
      [0, 0],
      [1, 1],
      [10, 2],
      [11, 3],
    ]);
    // Each KNX object points at the sorted position of its Modbus signal.
    expect(pipeline.knx.objects.map((o) => o.externalId)).toEqual([0, 1, 2, 3]);
  });

  it("refuses projects of another family", () => {
    expect(() => generateMbsKnxXbl(SYNTHETIC_MBS_KNX_XML.replace('ExternalProtocol="KNX"', 'ExternalProtocol="BACnet"'))).toThrow();
  });
});

/**
 * Projects saved by MAPS (base, variat) and variants of them, each with the
 * XBL the MAPS CLI generated (`IntesisMAPS.exe -i -o -compID 7`, unframed).
 * The `-pwd` copies carry the dummy password the CLI requires. Local only
 * (.local-data/ is gitignored); see docs/reference/mbs-knx-analisi.md §9.
 */
const REF_DIR = ".local-data/fixtures/mbs-knx-ref";
const references = existsSync(REF_DIR)
  ? readdirSync(REF_DIR)
      .filter((name) => name.endsWith(".maps.xbl"))
      .map((name) => name.replace(/\.maps\.xbl$/, ""))
  : [];

describe.skipIf(references.length === 0)("MAPS XBL references (present only in the local checkout)", () => {
  it.each(references)("reproduces %s byte for byte (timestamp masked)", (name) => {
    const reference = new Uint8Array(readFileSync(`${REF_DIR}/${name}.maps.xbl`));
    const version = childByTag(decodeElements(reference)[0], 2);
    const swVersion = [...reference.slice(version.contentOffset, version.contentOffset + version.contentLength)] as [
      number,
      number,
      number,
      number,
    ];
    const generated = generateMbsKnxXbl(readFileSync(`${REF_DIR}/${name}-pwd.ibmaps`, "utf8"), { now: NOW, swVersion });
    const stamp = (xbl: Uint8Array) => {
      const ts = childByTag(decodeElements(xbl)[0], 4);
      xbl.fill(0, ts.contentOffset, ts.contentOffset + ts.contentLength);
      return xbl;
    };
    expect(stamp(new Uint8Array(generated))).toEqual(stamp(reference));
  });
});
