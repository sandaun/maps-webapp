/**
 * KNX protocol side of the XBL pipeline: parses the `<KNXObject>` list and
 * the protocol settings into the structures the KNX writer (`./nodes.ts`)
 * consumes. The same XML and writer serve both KNX roles in MAPS —
 * `InternalKnx` (KNX–MBM) and `ExternalKnx` (MBS–KNX) serialize objects with
 * `KnxComObject.ToXML` and build an identical tag-4 node.
 *
 * Provenance: `KnxComObject(XmlNode)`
 * (temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS.Protocols.KNX/KnxComObject.cs:96-132),
 * `InternalKnx.ParseProtocolXML` / `ExternalKnx.ParseProtocolXML`
 * (IntesisBoxMAPS.Protocols.KNX.External/ExternalKnx.cs:595-611).
 *
 * Which objects are enabled, and their external/conversion ids, is decided
 * by each family's `PreXBLActions` port — not here.
 */

import { getAttr, getText, type XmlElement } from "@/core/project-format";
import { parseConversionIds, type ConversionIdRef } from "@/core/xbl";
import { parseGroupAddress } from "../address";

export interface KnxObjectParsed {
  active: boolean;
  dpt: number;
  sendingGA: number;
  listeningGAs: number[];
  flags: { u: boolean; t: boolean; ri: boolean; w: boolean; r: boolean };
  priority: number;
  updateGA: number;
  isVirtual: boolean;
  filterIds: ConversionIdRef[];
  operationIds: ConversionIdRef[];
}

export interface EnabledKnxObject extends KnxObjectParsed {
  externalId: number;
  conversionId: number;
}

/** Input of the KNX writer (`buildKnxNode`). */
export interface KnxXblNode {
  physicalAddress: number;
  keys: [string, string, string];
  objects: EnabledKnxObject[];
}

/** `<KNXObject>` children of the KNX protocol element, in XML order. */
export function parseKnxObjects(protocol: XmlElement): KnxObjectParsed[] {
  return childrenOf(protocol, "KNXObject").map((el) => {
    const flagsEl = child(el, "Flags");
    const virtEl = child(el, "Virtual");
    const listeningEl = child(el, "ListeningAddresses");
    return {
      active: parseBoolText(textOf(el, "Active"), true),
      dpt: parseNumberAttr(child(el, "DPT"), "Value", 0),
      sendingGA: parseGaAttr(child(el, "SendingAddress")),
      listeningGAs: listeningEl ? childrenOf(listeningEl, "Address").map(parseGaAttr) : [],
      flags: {
        u: parseBoolAttr(flagsEl, "U", false),
        t: parseBoolAttr(flagsEl, "T", false),
        ri: parseBoolAttr(flagsEl, "Ri", false),
        w: parseBoolAttr(flagsEl, "W", false),
        r: parseBoolAttr(flagsEl, "R", false),
      },
      priority: parseIntText(el, "Priority", 3),
      updateGA: parseIntText(el, "UpdateGA", 0),
      isVirtual: parseBoolAttr(virtEl, "Status", false),
      filterIds: parseConversionIds(textOf(el, "IdxFilters")),
      operationIds: parseConversionIds(textOf(el, "IdxOperations")),
    };
  });
}

/** Physical address and keys of the KNX protocol element. */
export function parseKnxXblSettings(
  protocol: XmlElement,
): Pick<KnxXblNode, "physicalAddress" | "keys"> {
  return {
    physicalAddress: parseIntText(protocol, "IndAddress", 65535),
    keys: parseKeys(protocol),
  };
}

function parseKeys(protocol: XmlElement): [string, string, string] {
  const keys = child(protocol, "Keys");
  return [
    parseStringAttr(keys, "Key1", "0001"),
    parseStringAttr(keys, "Key2", "0002"),
    parseStringAttr(keys, "Key3", "0003"),
  ];
}

// --- XML helpers --------------------------------------------------------------

function childrenOf(el: XmlElement, tag: string): XmlElement[] {
  return el.children.filter((c): c is XmlElement => c.kind === "element" && c.tag === tag);
}

function child(el: XmlElement, tag: string): XmlElement | undefined {
  return el.children.find((c): c is XmlElement => c.kind === "element" && c.tag === tag);
}

function textOf(el: XmlElement | undefined, tag: string): string | undefined {
  if (!el) return undefined;
  const c = child(el, tag);
  return c ? getText(c) : undefined;
}

function parseIntText(el: XmlElement, tag: string, fallback: number): number {
  const v = textOf(el, tag);
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function parseBoolText(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() === "true";
}

function parseBoolAttr(el: XmlElement | undefined, name: string, fallback: boolean): boolean {
  return parseBoolText(el ? getAttr(el, name) : undefined, fallback);
}

function parseNumberAttr(el: XmlElement | undefined, name: string, fallback: number): number {
  const v = el ? getAttr(el, name) : undefined;
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseStringAttr(el: XmlElement | undefined, name: string, fallback: string): string {
  const v = el ? getAttr(el, name) : undefined;
  return v ?? fallback;
}

/** GroupAddress(XmlNode): invalid/empty values decode to address 0. */
function parseGaAttr(el: XmlElement | undefined): number {
  const v = el ? getAttr(el, "Value") : undefined;
  if (v === undefined) return 0;
  return parseGroupAddress(v) ?? 0;
}
