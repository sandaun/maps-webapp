import { describe, expect, it } from "vitest";
import { SYNTHETIC_KNX_MBM_XML } from "../fixtures/synthetic-project";
import { childByTag, decodeElements, type DecodedElement } from "@/core/xbl";
import { generateKnxMbmXbl } from "./generate";

/**
 * Structural tests over the synthetic fixture. Every byte sequence asserted
 * here was derived from the decompiled C# writers (see provenance notes in
 * each module) and cross-checked against the decoded output; none of it is
 * verified against a real KNX–MBM gateway yet (docs/knx-mbm-mvp.md, Iteració 8).
 */

const NOW = new Date(2026, 0, 1, 12, 0, 0); // local time, like C# DateTime.Now

function generate(xml: string = SYNTHETIC_KNX_MBM_XML, now: Date = NOW): Uint8Array {
  return generateKnxMbmXbl(xml, { now });
}

function content(xbl: Uint8Array, el: DecodedElement): number[] {
  return Array.from(xbl.subarray(el.contentOffset, el.contentOffset + el.contentLength));
}

function itemContent(xbl: Uint8Array, item: DecodedElement[], tag: number): number[] | null {
  const el = item.find((c) => c.tag === tag);
  return el ? content(xbl, el) : null;
}

describe("generateKnxMbmXbl", () => {
  it("is deterministic for a fixed timestamp", () => {
    expect(generate()).toEqual(generate());
  });

  it("only differs in the 6 volatile timestamp bytes when `now` changes", () => {
    const a = generate(SYNTHETIC_KNX_MBM_XML, new Date(2026, 0, 1, 12, 0, 0));
    const b = generate(SYNTHETIC_KNX_MBM_XML, new Date(2030, 11, 31, 23, 59, 58));
    expect(a.length).toBe(b.length);
    const ts = childByTag(decodeElements(a)[0], 4);
    const diffs: number[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs.push(i);
    expect(diffs).toEqual(
      Array.from({ length: 6 }, (_, i) => ts.contentOffset + i),
    );
  });

  it("emits header, IBOX, KNX and MBM top-level containers", () => {
    const xbl = generate();
    expect(decodeElements(xbl).map((el) => el.tag)).toEqual([1, 2, 4, 6]);
  });

  describe("header (tag 1)", () => {
    it("carries description, versions, timestamp, endianess and AppId", () => {
      const xbl = generate();
      const header = decodeElements(xbl)[0];
      expect(header.kind).toBe("container");
      expect(content(xbl, childByTag(header, 1))).toEqual([
        ...Array.from(new TextEncoder().encode("Synthetic KNX-MBM test project")),
        0,
      ]);
      // Default MAPS SW version quad (not the XML ToolVersion).
      expect(content(xbl, childByTag(header, 2))).toEqual([1, 2, 31, 0]);
      // CompatibilityVersion="1.0.0.0".
      expect(content(xbl, childByTag(header, 3))).toEqual([1, 0, 0, 0]);
      // day, month, year % 100, h, min, s.
      expect(content(xbl, childByTag(header, 4))).toEqual([1, 1, 26, 12, 0, 0]);
      expect(content(xbl, childByTag(header, 5))).toEqual([0]);
      expect(content(xbl, childByTag(header, 6))).toEqual([4]);
    });

    it("honours the swVersion option", () => {
      const xbl = generateKnxMbmXbl(SYNTHETIC_KNX_MBM_XML, { now: NOW, swVersion: [5, 0, 9, 1] });
      expect(content(xbl, childByTag(decodeElements(xbl)[0], 2))).toEqual([5, 0, 9, 1]);
    });
  });

  describe("IBOX (tag 2)", () => {
    it("carries network settings, conversions and USB/timezone/NTP/DNS nodes", () => {
      const xbl = generate();
      const ibox = decodeElements(xbl)[1];
      expect(content(xbl, childByTag(ibox, 1))).toEqual([192, 168, 1, 50]);
      expect(content(xbl, childByTag(ibox, 2))).toEqual([255, 255, 255, 0]);
      expect(content(xbl, childByTag(ibox, 3))).toEqual([192, 168, 1, 1]);
      expect(content(xbl, childByTag(ibox, 4))).toEqual([0]); // DHCP false
      expect(content(xbl, childByTag(ibox, 5))).toEqual([0]); // empty password + NUL
      expect(content(xbl, childByTag(ibox, 6))).toEqual([
        ...Array.from(new TextEncoder().encode("SYNTH-KNX-MBM")),
        0,
      ]);
      // One active SCALE conversion, last of its chain: type 1|0x80, params
      // float-LE 0.0, 1000.0, 0.0, 100.0.
      expect(content(xbl, childByTag(ibox, 7))).toEqual([
        0x81, 0, 0, 0, 0, 0, 0, 0x7a, 0x44, 0, 0, 0, 0, 0, 0, 0xc8, 0x42,
      ]);
      // No link tables (tag 8) or remapping (tag 9) for KNX–MBM.
      expect(ibox.children?.some((c) => c.tag === 8 || c.tag === 9)).toBe(false);
      expect(content(xbl, childByTag(ibox, 10))).toEqual([0x0f]); // all USB flags
      expect(content(xbl, childByTag(ibox, 11))).toEqual([3, 1, 1]);
      const tz = childByTag(ibox, 12);
      expect(tz.children?.map((c) => c.contentLength)).toEqual([16, 256, 44]);
      const ntp = childByTag(ibox, 13);
      expect(ntp.children?.map((c) => c.contentLength)).toEqual([4, 256]);
      expect(content(xbl, childByTag(ibox, 14))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
      // No security/custom-port nodes with the default settings.
      expect(ibox.children?.some((c) => c.tag === 15 || c.tag === 17 || c.tag === 18)).toBe(false);
    });
  });

  describe("KNX internal (tag 4)", () => {
    it("emits children in positional order 6,7,8,9,11,10,12", () => {
      const knx = decodeElements(generate())[2];
      expect(knx.children?.map((c) => c.tag)).toEqual([6, 7, 8, 9, 11, 10, 12]);
    });

    it("carries physical address, keys and interface objects", () => {
      const xbl = generate();
      const knx = decodeElements(xbl)[2];
      expect(content(xbl, childByTag(knx, 6))).toEqual([0xff, 0xff]); // 65535
      expect(content(xbl, childByTag(knx, 7))).toEqual([
        0x30, 0x30, 0x30, 0x31, 0x30, 0x30, 0x30, 0x32, 0x30, 0x30, 0x30, 0x33,
      ]);
      const iface = childByTag(knx, 8);
      expect(iface.children?.map((c) => c.contentLength)).toEqual([2, 10, 5, 5]);
      expect(content(xbl, childByTag(iface, 1))).toEqual([0, 119]); // manufacturer
    });

    it("emits sorted deduped group addresses, com objects and associations", () => {
      const xbl = generate();
      const knx = decodeElements(xbl)[2];
      // count 3; addresses 2051, 2052, 2053.
      expect(content(xbl, childByTag(knx, 9))).toEqual([0, 3, 8, 3, 8, 4, 8, 5]);
      // 2 objects: [U|W|Enabled|prio3, dpt 1.001 → 0] and [T|R|Enabled|prio3, dpt 9.001 → 8].
      expect(content(xbl, childByTag(knx, 11))).toEqual([0, 2, 0x97, 0x00, 0x4f, 0x08]);
      // [addrIdx+1, objIdx+1] pairs, sending then listening per object.
      expect(content(xbl, childByTag(knx, 10))).toEqual([
        0, 3, 0, 1, 0, 1, 0, 2, 0, 1, 0, 3, 0, 2,
      ]);
    });

    it("emits per-object config with relinked external IDs and conversion IDs", () => {
      const xbl = generate();
      const cfg = childByTag(decodeElements(xbl)[2], 12);
      expect(cfg.kind).toBe("container");
      const items = childByTag(cfg, 1).items ?? [];
      expect(items).toHaveLength(2);
      // Sorted MBM order puts the read signal first: knx obj 0 → extId 1,
      // knx obj 1 → extId 0 and conversion 0 (obj 0 has none → 255).
      expect(itemContent(xbl, items[0], 1)).toEqual([1, 1]); // DPT 257
      expect(itemContent(xbl, items[0], 2)).toEqual([0, 0]); // UpdateGA
      expect(itemContent(xbl, items[0], 3)).toEqual([1]);
      expect(itemContent(xbl, items[0], 4)).toEqual([0xff]);
      expect(itemContent(xbl, items[1], 1)).toEqual([9, 1]); // DPT 2305
      expect(itemContent(xbl, items[1], 3)).toEqual([0]);
      expect(itemContent(xbl, items[1], 4)).toEqual([0]);
    });
  });

  describe("MBM external (tag 6)", () => {
    it("emits the single-RTU-node form with config + devices containers", () => {
      const xbl = generate();
      const mbm = decodeElements(xbl)[3];
      expect(mbm.children?.map((c) => c.tag)).toEqual([1, 2, 3, 4, 6, 11]);
      expect(content(xbl, childByTag(mbm, 1))).toEqual([0]); // media
      const rtu = childByTag(mbm, 2);
      // baudrate 9600 BE, dataBits 8, parity 0, stopBits 1, interframe 60 BE, pollAfterWrite 0.
      expect(content(xbl, childByTag(rtu, 1))).toEqual([0, 0, 0x25, 0x80]);
      expect(content(xbl, childByTag(rtu, 2))).toEqual([8]);
      expect(content(xbl, childByTag(rtu, 3))).toEqual([0]);
      expect(content(xbl, childByTag(rtu, 4))).toEqual([1]);
      expect(content(xbl, childByTag(rtu, 5))).toEqual([0, 0, 0, 60]);
      expect(content(xbl, childByTag(rtu, 6))).toEqual([0]);
      const devices = childByTag(childByTag(mbm, 3), 1).items ?? [];
      expect(devices).toHaveLength(1);
      // slave 1, timeout 1000, first/last index 0/0.
      expect(itemContent(xbl, devices[0], 1)).toEqual([1]);
      expect(itemContent(xbl, devices[0], 2)).toEqual([0x03, 0xe8]);
      expect(itemContent(xbl, devices[0], 3)).toEqual([0, 0, 0, 0]);
      expect(content(xbl, childByTag(mbm, 4))).toEqual([0]); // poll records disabled
      expect(content(xbl, childByTag(mbm, 11))).toEqual([0, 1]); // device count
    });

    it("emits signals sorted read-first with shrunk addresses and IDs", () => {
      const xbl = generate();
      const signals = childByTag(childByTag(decodeElements(xbl)[3], 6), 1).items ?? [];
      expect(signals).toHaveLength(2);
      // Read signal first: port 0, device 0, readFunc 3, lenBits 32, format 3,
      // byteOrder 0, address 20, externalId 1, configId 1, conversionId 0.
      expect(signals[0].map((el) => el.tag)).toEqual([1, 2, 3, 5, 6, 7, 9, 10, 11, 12]);
      expect(itemContent(xbl, signals[0], 5)).toEqual([32]);
      expect(itemContent(xbl, signals[0], 9)).toEqual([20]);
      expect(itemContent(xbl, signals[0], 10)).toEqual([1]);
      expect(itemContent(xbl, signals[0], 12)).toEqual([0]);
      // Write-only signal: writeFunc 6, no conversion node (readFunc = -1).
      expect(signals[1].map((el) => el.tag)).toEqual([1, 2, 4, 5, 6, 7, 9, 10, 11]);
      expect(itemContent(xbl, signals[1], 4)).toEqual([6]);
      expect(itemContent(xbl, signals[1], 9)).toEqual([10]);
    });

    it("emits derived poll records when enabled", () => {
      const xml = SYNTHETIC_KNX_MBM_XML.replace(
        '<PollRecords Enabled="False"',
        '<PollRecords Enabled="True"',
      );
      const xbl = generate(xml);
      const mbm = decodeElements(xbl)[3];
      expect(content(xbl, childByTag(mbm, 4))).toEqual([1]);
      const records = childByTag(childByTag(mbm, 7), 1).items ?? [];
      expect(records).toHaveLength(1);
      // Signal indices (sorted array) first/last 0/0 covering the 32-bit read
      // at address 20 → 2 registers.
      expect(itemContent(xbl, records[0], 1)).toEqual([0, 0, 0, 0]);
      expect(itemContent(xbl, records[0], 2)).toEqual([0, 2]);
    });
  });

  describe("error cases", () => {
    it("rejects non-KNX–MBM projects", () => {
      const xml = SYNTHETIC_KNX_MBM_XML.replace('InternalProtocol="KNX"', 'InternalProtocol="BACnet"');
      expect(() => generate(xml)).toThrow(/Not a KNX/);
    });

    it("rejects mismatched KNX/MBM signal counts", () => {
      const xml = SYNTHETIC_KNX_MBM_XML.replace(/<Signal ID="1">[\s\S]*?<\/Signal>/, "");
      expect(() => generate(xml)).toThrow();
    });
  });
});
