/**
 * XBL writer for the KNX internal protocol node (tag 4).
 *
 * Provenance: `InternalKnx.CreateInternalXBLNode` and its helpers
 * (temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS.Protocols.KNX.Internal/InternalKnx.cs:838-872,
 * 917-1042) plus `IntesisKnx.CreateComObjectsNode` / `ConvertKNXFlagsToByte` /
 * `GetTypeFromDPT` (IntesisBoxMAPS.Protocols.KNX/IntesisKnx.cs:322-421).
 */

import type { EnabledKnxObject, XblPipelineResult } from "./pipeline";
import {
  array,
  container,
  externalIdBytes,
  node,
  u16be,
  utf8,
  type XblElementSpec,
} from "@/core/xbl";

/**
 * DPT main number → KNX type byte (IntesisKnx.GetTypeFromDPT switch,
 * IntesisKnx.cs:322-354). The index comes from GetDPTIndexFromDPTValue /
 * ConvertDPTValueToString: main 0 → "" → 0; sub 0 (except DPT 14.000) → ""
 * → 0; sub 255 ("x") → main. Unknown → -1 (MAPS then fails the generation —
 * ConvertKNXFlagsToByte returns null and the writer crashes; we throw).
 */
export function getTypeFromDpt(dptValue: number): number {
  const main = Math.floor(dptValue / 256);
  const sub = dptValue % 256;
  const index = main === 0 || (sub === 0 && main !== 14) ? 0 : main;
  const table: Record<number, number> = {
    1: 0, 2: 1, 3: 3, 4: 7, 5: 7, 6: 7, 7: 8, 8: 8, 9: 8, 10: 9, 11: 9,
    12: 10, 13: 10, 14: 10, 15: 10, 16: 14, 17: 7, 18: 7, 19: 12, 20: 7,
    21: 7, 23: 1, 26: 7, 27: 8, 29: 12, 232: 9,
  };
  return table[index] ?? -1;
}

/** Port of IntesisKnx.ConvertKNXFlagsToByte (IntesisKnx.cs:373-421). */
function flagsWord(obj: EnabledKnxObject): number {
  if (obj.priority < 0) throw new Error("KNX object with negative priority");
  let b0 = 0;
  if (obj.flags.u) b0 |= 0x80;
  if (obj.flags.t) b0 |= 0x40;
  if (obj.flags.ri) b0 |= 0x20;
  if (obj.flags.w) b0 |= 0x10;
  if (obj.flags.r) b0 |= 0x08;
  if (obj.active) b0 |= 0x04;
  b0 |= obj.priority & 0x03;
  const type = getTypeFromDpt(obj.dpt);
  if (type < 0) {
    throw new Error(`Unsupported DPT value ${obj.dpt} for XBL com objects node`);
  }
  return (b0 << 8) | type;
}

/**
 * Interface objects node (tag 8): ManufacturerID 119, OrderInfo 10B,
 * ApplicationVersion 5B, InterfaceVersion 5B — all MAPS constants/defaults,
 * never read from the XML (InternalKnx.cs:1029-1042, defaults at :104-110).
 */
function buildInterfaceObjectsNode(): XblElementSpec {
  return container(8, [
    node(1, u16be(119)),
    node(2, new Uint8Array(10)),
    node(3, new Uint8Array(5)),
    node(4, new Uint8Array(5)),
  ]);
}

/**
 * Group addresses node (tag 9): 2B count + 2B per address, deduplicated and
 * sorted ascending (InternalKnx.MountGroupAddressesObject +
 * CreateGroupAddressesNode, :997-1027).
 */
function buildGroupAddressesNode(objects: EnabledKnxObject[]): {
  element: XblElementSpec;
  addresses: number[];
} {
  const seen = new Set<number>();
  for (const obj of objects) {
    seen.add(obj.sendingGA);
    for (const ga of obj.listeningGAs) seen.add(ga);
  }
  const addresses = [...seen].sort((a, b) => a - b);
  const out = new Uint8Array(2 + addresses.length * 2);
  out.set(u16be(addresses.length), 0);
  addresses.forEach((ga, i) => out.set(u16be(ga), 2 + i * 2));
  return { element: node(9, out), addresses };
}

/**
 * Associations node (tag 10): 2B count + per association [AddressIndex 2B]
 * [GroupObjectIndex 2B], both 1-based (InternalKnx.MountAssociationsObject /
 * CreateAssociation / CreateKNXAssocsNode, :958-995). Pairs are deduplicated.
 */
function buildAssociationsNode(
  objects: EnabledKnxObject[],
  addresses: number[],
): XblElementSpec {
  const pairs: Array<[number, number]> = [];
  const addPair = (objectIndex: number, address: number): void => {
    const pair: [number, number] = [addresses.indexOf(address) + 1, objectIndex + 1];
    if (!pairs.some(([a, g]) => a === pair[0] && g === pair[1])) pairs.push(pair);
  };
  objects.forEach((obj, i) => {
    addPair(i, obj.sendingGA);
    for (const ga of obj.listeningGAs) addPair(i, ga);
  });
  const out = new Uint8Array(2 + pairs.length * 4);
  out.set(u16be(pairs.length), 0);
  pairs.forEach(([addressIndex, groupObjectIndex], i) => {
    out.set(u16be(addressIndex), 2 + i * 4);
    out.set(u16be(groupObjectIndex), 4 + i * 4);
  });
  return node(10, out);
}

/**
 * Com objects node (tag 11): 2B count + 2B flags/type per enabled object
 * (IntesisKnx.CreateComObjectsNode, :356-371).
 */
function buildComObjectsNode(objects: EnabledKnxObject[]): XblElementSpec {
  const out = new Uint8Array(2 + objects.length * 2);
  out.set(u16be(objects.length), 0);
  objects.forEach((obj, i) => out.set(u16be(flagsWord(obj)), 2 + i * 2));
  return node(11, out);
}

/**
 * Per-object KNX config node (tag 12): array with DPT, UpdateGA, ExternalID
 * (link-table form never used here) and ConversionID (InternalKnx.cs:917-942).
 */
function buildKnxConfigNode(objects: EnabledKnxObject[]): XblElementSpec {
  return container(12, [
    array(
      objects.map((obj) => [
        node(1, u16be(obj.dpt)),
        node(2, u16be(obj.updateGA)),
        node(3, externalIdBytes(obj.externalId)),
        node(4, new Uint8Array([obj.conversionId & 0xff])),
      ]),
    ),
  ]);
}

/**
 * Port of InternalKnx.CreateInternalXBLNode (:838-872). NOTE the child order
 * is positional and NOT tag-ordered: 6, 7, 8, 9, 11, 10, 12.
 */
export function buildKnxNode(knx: XblPipelineResult["knx"]): XblElementSpec {
  const keys = new Uint8Array(12);
  // Keys: 4 UTF-8 bytes each into a zero-padded 12B buffer (InternalKnx.cs:844-848).
  knx.keys.forEach((key, i) => {
    const bytes = utf8(key);
    // C# Buffer.BlockCopy copies exactly 4 bytes: it throws when the key is
    // shorter and silently truncates when longer.
    if (bytes.length < 4) {
      throw new Error(`KNX key ${i + 1} shorter than 4 bytes`);
    }
    keys.set(bytes.subarray(0, 4), i * 4);
  });
  const { element: groupAddresses, addresses } = buildGroupAddressesNode(knx.objects);
  return container(4, [
    node(6, u16be(knx.physicalAddress)),
    node(7, keys),
    buildInterfaceObjectsNode(),
    groupAddresses,
    buildComObjectsNode(knx.objects),
    buildAssociationsNode(knx.objects, addresses),
    buildKnxConfigNode(knx.objects),
  ]);
}
