import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractIbmaps, parseCompleteBlob } from "@/core/project-format";
import { childByTag, decodeElements, type DecodedElement } from "@/core/xbl";
import { SYNTHETIC_ME_MBS_XML } from "../fixtures/synthetic-project";
import { generateMeMbsXbl } from "./generate";

/**
 * Structural tests over the synthetic fixture, plus a byte-exact gate against
 * the real 770 Air fixture (skip-if-absent; verified via scripts/verify-xbl.ts
 * — see docs/knx-mbm-mvp.md, Pas 2.4).
 *
 * The synthetic fixture's spec table references conversions/LUTs the shared
 * fixture's IBOX does not declare (operations "0,1" → ARITH, "17,0" →
 * LUT_REMAP, mirroring the real 770 Air project). The XBL tests enrich the
 * XML in-memory with those tables so the conversion machinery is exercised;
 * the enrichment mirrors the real fixture's conversion block.
 */

const NOW = new Date(2026, 0, 1, 12, 0, 0); // local time, like C# DateTime.Now

const CONVERSIONS = [
  '      <Conversion Id="0" Description="" Type="2" Param1="1" Param2="1" Param3="0" Param4="0" />',
  '      <Conversion Id="1" Description="" Type="2" Param1="-2" Param2="1" Param3="0" Param4="0" />',
  ...Array.from(
    { length: 16 },
    (_, i) =>
      `      <Conversion Id="${i + 2}" Description="" Type="4" Param1="${i}" Param2="0" Param3="0" Param4="0" />`,
  ),
].join("\r\n");

const REMAP_LUTS = [
  '    <RemapLUTs>',
  '      <RemapLUT Id="0" NumOfElements="1" Default="0" InvDefault="0">',
  '        <Element InValue="7" OutValue="42" />',
  "      </RemapLUT>",
  '      <RemapLUT Id="15" NumOfElements="3" Default="0" InvDefault="0">',
  '        <Element InValue="0" OutValue="0" />',
  '        <Element InValue="1" OutValue="1" />',
  '        <Element InValue="2" OutValue="2" />',
  "      </RemapLUT>",
  "    </RemapLUTs>",
].join("\r\n");

const ENRICHED_XML = SYNTHETIC_ME_MBS_XML.replace(
  /      <Conversion Id="0"[^\r\n]*/,
  CONVERSIONS,
).replace("    </Conversions>", `    </Conversions>\r\n${REMAP_LUTS}`);

function generate(xml: string = ENRICHED_XML, now: Date = NOW): Uint8Array {
  return generateMeMbsXbl(xml, { now });
}

function content(xbl: Uint8Array, el: DecodedElement): number[] {
  return Array.from(xbl.subarray(el.contentOffset, el.contentOffset + el.contentLength));
}

function itemContent(xbl: Uint8Array, item: DecodedElement[], tag: number): number[] | null {
  const el = item.find((c) => c.tag === tag);
  return el ? content(xbl, el) : null;
}

describe("generateMeMbsXbl", () => {
  it("is deterministic for a fixed timestamp", () => {
    expect(generate()).toEqual(generate());
  });

  it("only differs in the 6 volatile timestamp bytes when `now` changes", () => {
    const a = generate(ENRICHED_XML, new Date(2026, 0, 1, 12, 0, 0));
    const b = generate(ENRICHED_XML, new Date(2030, 11, 31, 23, 59, 58));
    expect(a.length).toBe(b.length);
    const ts = childByTag(decodeElements(a)[0], 4);
    const diffs: number[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs.push(i);
    expect(diffs).toEqual(Array.from({ length: 6 }, (_, i) => ts.contentOffset + i));
  });

  it("emits header, IBOX, MBS and ME top-level containers in that order", () => {
    const xbl = generate();
    expect(decodeElements(xbl).map((el) => el.tag)).toEqual([1, 2, 9, 8]);
  });

  describe("header (tag 1)", () => {
    it("carries description, versions, timestamp, endianess and AppId 64", () => {
      const xbl = generate();
      const header = decodeElements(xbl)[0];
      expect(header.kind).toBe("container");
      expect(content(xbl, childByTag(header, 1))).toEqual([
        ...Array.from(new TextEncoder().encode("Synthetic ME-MBS test project")),
        0,
      ]);
      expect(content(xbl, childByTag(header, 2))).toEqual([1, 2, 31, 0]);
      // CompatibilityVersion="0.0.0.0" (the XML CompatibilityID=8 is NOT used).
      expect(content(xbl, childByTag(header, 3))).toEqual([0, 0, 0, 0]);
      // day, month, year % 100, h, min, s.
      expect(content(xbl, childByTag(header, 4))).toEqual([1, 1, 26, 12, 0, 0]);
      expect(content(xbl, childByTag(header, 5))).toEqual([0]);
      // AppId ME_AC_XXX = 64 (connected 770 Air unit), not the project's 8.
      expect(content(xbl, childByTag(header, 6))).toEqual([64]);
    });

    it("honours the swVersion and appId options", () => {
      const xbl = generateMeMbsXbl(ENRICHED_XML, { now: NOW, swVersion: [5, 0, 9, 1], appId: 8 });
      const header = decodeElements(xbl)[0];
      expect(content(xbl, childByTag(header, 2))).toEqual([5, 0, 9, 1]);
      expect(content(xbl, childByTag(header, 6))).toEqual([8]);
    });
  });

  describe("IBOX (tag 2)", () => {
    it("carries network settings, conversions, ALL remap LUTs and no USB nodes", () => {
      const xbl = generate();
      const ibox = decodeElements(xbl)[1];
      expect(content(xbl, childByTag(ibox, 1))).toEqual([192, 168, 1, 60]);
      expect(content(xbl, childByTag(ibox, 2))).toEqual([255, 255, 255, 0]);
      expect(content(xbl, childByTag(ibox, 3))).toEqual([192, 168, 1, 1]);
      expect(content(xbl, childByTag(ibox, 4))).toEqual([0]); // DHCP false
      expect(content(xbl, childByTag(ibox, 5))).toEqual([0]); // empty password + NUL
      expect(content(xbl, childByTag(ibox, 6))).toEqual([
        ...Array.from(new TextEncoder().encode("SYNTH-ME-MBS")),
        0,
      ]);
      // Two active conversions, both last-of-chain: LUT_REMAP (4|0x80, P1=15
      // as u32 LE) from the fan signal, then the inverted ARITH (2|0x80,
      // params 1.0/1.0/0.0 float LE, P4=1 as u32 LE) from the setpoint signal.
      expect(content(xbl, childByTag(ibox, 7))).toEqual([
        0x84, 0x0f, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0x82, 0, 0, 0x80, 0x3f, 0, 0, 0x80, 0x3f, 0, 0, 0, 0, 1, 0, 0, 0,
      ]);
      // No link tables (tag 8); remapping (tag 9) carries ALL project LUTs:
      // [count=1, default 0, 0, invDefault 0, 0, in=7, 0, out=42, 0] then the
      // 3-element identity LUT — 11-byte header + 10 bytes per element.
      expect(ibox.children?.some((c) => c.tag === 8)).toBe(false);
      expect(content(xbl, childByTag(ibox, 9))).toEqual([
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 42, 0,
        3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0,
      ]);
      // RT_AIR has no USB host: tags 10/11 are absent.
      expect(ibox.children?.some((c) => c.tag === 10 || c.tag === 11)).toBe(false);
      const tz = childByTag(ibox, 12);
      expect(tz.children?.map((c) => c.contentLength)).toEqual([16, 256, 44]);
      const ntp = childByTag(ibox, 13);
      expect(ntp.children?.map((c) => c.contentLength)).toEqual([4, 256]);
      expect(content(xbl, childByTag(ibox, 14))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    });
  });

  describe("MBS internal (tag 9)", () => {
    it("emits children in positional order 1,2,3,7,4,5,6 (tags are NOT sorted)", () => {
      const mbs = decodeElements(generate())[2];
      expect(mbs.children?.map((c) => c.tag)).toEqual([1, 2, 3, 7, 4, 5, 6]);
    });

    it("carries media config, CommErrorTout×1000 u32 BE and RTU/TCP configs", () => {
      const xbl = generate();
      const mbs = decodeElements(xbl)[2];
      expect(content(xbl, childByTag(mbs, 1))).toEqual([2]); // media Both
      expect(content(xbl, childByTag(mbs, 2))).toEqual([0]); // byteOrder BE
      expect(content(xbl, childByTag(mbs, 3))).toEqual([1]); // updateCOV
      expect(content(xbl, childByTag(mbs, 7))).toEqual([0, 0x02, 0xbf, 0x20]); // 180 s → 180000 ms
      const rtu = childByTag(mbs, 4);
      expect(content(xbl, childByTag(rtu, 1))).toEqual([0, 0, 0x25, 0x80]); // 9600 BE
      expect(content(xbl, childByTag(rtu, 2))).toEqual([8]);
      expect(content(xbl, childByTag(rtu, 3))).toEqual([0]);
      expect(content(xbl, childByTag(rtu, 4))).toEqual([1]);
      expect(content(xbl, childByTag(rtu, 5))).toEqual([3]); // slave number
      expect(content(xbl, childByTag(rtu, 6))).toEqual([1]); // connection type
      const tcp = childByTag(mbs, 5);
      expect(content(xbl, childByTag(tcp, 1))).toEqual([0x01, 0xf6]); // 502 BE
      expect(content(xbl, childByTag(tcp, 2))).toEqual([0, 10]);
      // SINGLE slave mode: no slaves node (tag 8).
      expect(mbs.children?.some((c) => c.tag === 8)).toBe(false);
    });

    it("emits signals sorted by address with relinked ME external IDs", () => {
      const xbl = generate();
      const signals = childByTag(childByTag(decodeElements(xbl)[2], 6), 1).items ?? [];
      expect(signals).toHaveLength(9);
      // Common shape: tags 1 LenBits=16, 2 Format, 3 Bit=255, 4 Address,
      // 5 ReadWrite+1, 6 ExternalID, 7 ConfigID (+8 ConversionID when ≠255).
      for (const item of signals) {
        expect(itemContent(xbl, item, 1)).toEqual([16]);
        expect(itemContent(xbl, item, 3)).toEqual([0xff]);
      }
      // Sorted by address: 0, 2, 100, 101, 102, 104, 105, 111, 132.
      expect(signals.map((item) => itemContent(xbl, item, 4))).toEqual([
        [0], [2], [0x64], [0x65], [0x66], [0x68], [0x69], [0x6f], [0x84],
      ]);
      // ReadWrite+1: READ→1 (comm error, ambient, humidity), TRIGGER→2
      // (On-all, error reset), READWRITE→3 (On/Off, Mode, Fan, Setpoint).
      expect(signals.map((item) => itemContent(xbl, item, 5))).toEqual([
        [1], [2], [3], [3], [3], [3], [1], [2], [1],
      ]);
      // Virtual external IDs: status signals carry signalIndex, commands carry
      // 0x80|signalIndex (On-all trigger sig 0 → 0x80, error reset sig 11 → 0x8b).
      expect(signals.map((item) => itemContent(xbl, item, 6))).toEqual([
        [9], [0x80], [0], [1], [2], [4], [5], [0x8b], [0x20],
      ]);
      // ConfigID = original XML signal id, in sorted order.
      expect(signals.map((item) => itemContent(xbl, item, 7))).toEqual([
        [0], [1], [2], [3], [4], [5], [6], [7], [8],
      ]);
      // Only fan (conversion 0) and setpoint (conversion 1) carry tag 8.
      expect(signals.map((item) => itemContent(xbl, item, 8))).toEqual([
        null, null, null, null, [0], [1], null, null, null,
      ]);
    });

    it("subtracts 1 from addresses when RegisterBase=1", () => {
      const xml = ENRICHED_XML.replace("<RegisterBase>0</RegisterBase>", "<RegisterBase>1</RegisterBase>");
      const xbl = generate(xml);
      const signals = childByTag(childByTag(decodeElements(xbl)[2], 6), 1).items ?? [];
      expect(itemContent(xbl, signals[2], 4)).toEqual([0x63]); // 100 → 99
    });
  });

  describe("ME external (tag 8)", () => {
    it("carries poll/timeout config and one G50 item per controller with enabled groups", () => {
      const xbl = generate();
      const me = decodeElements(xbl)[3];
      expect(me.children?.map((c) => c.tag)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(content(xbl, childByTag(me, 1))).toEqual([0, 100]); // PollPeriod u16 BE
      expect(content(xbl, childByTag(me, 2))).toEqual([30]);
      expect(content(xbl, childByTag(me, 3))).toEqual([30]);
      expect(content(xbl, childByTag(me, 4))).toEqual([1]);
      expect(content(xbl, childByTag(me, 5))).toEqual([5]);
      // No Fahrenheit node (tag 7) in Celsius mode.
      expect(me.children?.some((c) => c.tag === 7)).toBe(false);

      const g50s = childByTag(childByTag(me, 6), 1).items ?? [];
      expect(g50s).toHaveLength(1); // controller 0 only, despite Enabled=False
      expect(itemContent(xbl, g50s[0], 1)).toEqual([192, 168, 1, 129]);
      expect(itemContent(xbl, g50s[0], 2)).toEqual([0, 80]);
      expect(itemContent(xbl, g50s[0], 3)).toEqual([0]); // type
      expect(itemContent(xbl, g50s[0], 4)).toEqual([2]); // model AE_200
      expect(itemContent(xbl, g50s[0], 5)).toEqual([1]); // !Compatibility
      // Comm-error external id = sorted position of the general ERRORSIGN signal.
      expect(itemContent(xbl, g50s[0], 6)).toEqual([0]);
      expect(itemContent(xbl, g50s[0], 7)).toEqual([1]); // Setpoint05Support
    });

    it("emits the enabled group with indexed external-id and conversion containers", () => {
      const xbl = generate();
      const g50s = childByTag(childByTag(decodeElements(xbl)[3], 6), 1).items ?? [];
      const groups = childByTag(g50s[0].find((c) => c.tag === 8)!, 1).items ?? [];
      expect(groups).toHaveLength(1); // group 1 disabled
      const group = groups[0];
      expect(itemContent(xbl, group, 1)).toEqual([1]); // group idx + 1
      expect(itemContent(xbl, group, 2)).toEqual([0]); // type IC
      expect(itemContent(xbl, group, 3)).toEqual([4]); // NumOfFanSpeeds
      expect(itemContent(xbl, group, 4)).toEqual([0]); // DualSetPoint
      expect(itemContent(xbl, group, 5)).toEqual([1]); // URC
      // t6: status signals only, keyed by signalIndex+1, deduped, content =
      // the relinked external id (sorted MBS position). Error reset (not a
      // status signal) is absent; node 4 (SETTEMP+1=5) holds 5, humidity
      // (signalIndex 32) lands on node 33.
      const ids = group.find((c) => c.tag === 6)!;
      expect(ids.children?.map((c) => c.tag)).toEqual([1, 2, 3, 5, 6, 33]);
      expect(ids.children?.map((c) => content(xbl, c))).toEqual([
        [2], [3], [4], [5], [6], [8],
      ]);
      // t7: same keys for signals with a conversion (fan node 3 → 0, setpoint
      // node 5 → 1).
      const conversions = group.find((c) => c.tag === 7)!;
      expect(conversions.children?.map((c) => c.tag)).toEqual([3, 5]);
      expect(conversions.children?.map((c) => content(xbl, c))).toEqual([[0], [1]]);
    });
  });

  describe("error cases", () => {
    it("rejects non-ME–MBS projects", () => {
      const xml = ENRICHED_XML.replace('InternalProtocol="Modbus Slave"', 'InternalProtocol="KNX"');
      expect(() => generate(xml)).toThrow(/Not a Mitsubishi Electric/);
    });

    it("rejects mismatched MBS/ME signal counts", () => {
      const xml = ENRICHED_XML.replace(/<Signal ID="1">[\s\S]*?<\/Signal>/, "");
      expect(() => generate(xml)).toThrow(/count mismatch/);
    });

    it("refuses projects with the consumption function enabled", () => {
      const xml = ENRICHED_XML.replace(
        '<ConsumptionFunction Enabled="False"',
        '<ConsumptionFunction Enabled="True"',
      );
      expect(() => generate(xml)).toThrow(/consumption function/);
    });
  });
});

/**
 * Byte-exact gate against the real 770 Air fixture (gitignored under
 * .local-data/ — it contains credentials). Skipped when absent (CI). The
 * timestamp is masked structurally (header tag 1 → child tag 4, 6 bytes).
 */
const REAL_BLOB = ".local-data/fixtures/770air-me-mbs-2026-08-18.bin";
const hasRealFixture = existsSync(REAL_BLOB);

describe.skipIf(!hasRealFixture)("real 770 Air fixture (present only in the local checkout)", () => {
  function timestampOffset(xbl: Uint8Array): number {
    const header = decodeElements(xbl).find((el) => el.tag === 1 && el.kind === "container");
    const ts = header?.children?.find((c) => c.tag === 4);
    if (!ts || ts.contentLength !== 6) throw new Error("no 6-byte timestamp node");
    return ts.contentOffset;
  }

  it("reproduces the official XBL byte for byte (timestamp masked)", () => {
    const blob = parseCompleteBlob(new Uint8Array(readFileSync(REAL_BLOB)));
    const xml = extractIbmaps(blob.zip).xml;
    const generated = generateMeMbsXbl(xml, { now: new Date() });
    const reference = blob.xbl;
    expect(generated.length).toBe(reference.length);
    const gen = new Uint8Array(generated);
    const ref = new Uint8Array(reference);
    gen.fill(0, timestampOffset(gen), timestampOffset(gen) + 6);
    ref.fill(0, timestampOffset(ref), timestampOffset(ref) + 6);
    expect(gen).toEqual(ref);
  });
});
