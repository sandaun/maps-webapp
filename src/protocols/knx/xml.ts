import {
  element,
  getAttr,
  getText,
  setAttr,
  setText,
  type XmlElement,
} from "@/core/project-format";
import { formatGroupAddress } from "./address";
import { DEFAULT_DPT } from "./dpt";
import { DEFAULT_FLAGS, type KnxFlags } from "./flags";
import type { KnxConfig, KnxEndpoint } from "./model";

/**
 * Reading and patching of the KNX protocol element and its `<KNXObject>`
 * rows. MAPS serializes both KNX roles the same way (`KnxComObject.ToXML`,
 * IntesisBoxMAPS.Protocols.KNX/KnxComObject.cs:134-209), so these work on
 * `InternalProtocol` (KNX–MBM) and `ExternalProtocol` (MBS–KNX) alike: the
 * family passes the element.
 */

/** Physical address, extended addresses and keys of the KNX protocol element. */
export function readKnxConfig(protocol: XmlElement | undefined): KnxConfig {
  const keys = protocol ? childElOpt(protocol, "Keys") : undefined;
  return {
    physicalAddress: parseIntText(protocol, "IndAddress", 65535),
    extendedAddresses: parseBool(textOf(protocol, "UseExtendedAddresses"), false),
    keys: [
      keys ? (getAttr(keys, "Key1") ?? "0001") : "0001",
      keys ? (getAttr(keys, "Key2") ?? "0002") : "0002",
      keys ? (getAttr(keys, "Key3") ?? "0003") : "0003",
    ],
  };
}

/** KNX side of one `<KNXObject>`. */
export function readKnxEndpoint(el: XmlElement): KnxEndpoint {
  const flagsEl = el.children.find(
    (c): c is XmlElement => c.kind === "element" && c.tag === "Flags",
  );
  const flags: KnxFlags = flagsEl
    ? {
        u: parseBool(getAttr(flagsEl, "U"), false),
        t: parseBool(getAttr(flagsEl, "T"), false),
        ri: parseBool(getAttr(flagsEl, "Ri"), false),
        w: parseBool(getAttr(flagsEl, "W"), false),
        r: parseBool(getAttr(flagsEl, "R"), false),
      }
    : { ...DEFAULT_FLAGS };

  const dptEl = el.children.find((c): c is XmlElement => c.kind === "element" && c.tag === "DPT");
  const sending = el.children.find(
    (c): c is XmlElement => c.kind === "element" && c.tag === "SendingAddress",
  );
  const listening = el.children.find(
    (c): c is XmlElement => c.kind === "element" && c.tag === "ListeningAddresses",
  );

  return {
    dpt: dptEl ? parseNumber(getAttr(dptEl, "Value"), 0) : 0,
    groupAddress: sending ? parseNumber(getAttr(sending, "Value"), 0) : 0,
    additionalAddresses: listening
      ? childrenOf(listening, "Address").map((a) => parseNumber(getAttr(a, "Value"), 0))
      : [],
    flags,
    priority: parseNumber(textOf(el, "Priority"), 3),
  };
}

export function setKnxPhysicalAddress(protocol: XmlElement, address: number): void {
  setText(childEl(protocol, "IndAddress"), String(address));
}

export function setKnxExtendedAddresses(protocol: XmlElement, enabled: boolean): void {
  setText(childEl(protocol, "UseExtendedAddresses"), boolText(enabled));
}

/** Apply a partial edit to the KNX side of one `<KNXObject>`. */
export function patchKnxEndpoint(knx: XmlElement, patch: Partial<KnxEndpoint>): void {
  if (patch.dpt !== undefined) setAttr(childEl(knx, "DPT"), "Value", String(patch.dpt ?? DEFAULT_DPT));
  if (patch.groupAddress !== undefined) {
    const sending = childEl(knx, "SendingAddress");
    setAttr(sending, "Value", String(patch.groupAddress));
    setAttr(sending, "String", formatGroupAddress(patch.groupAddress));
  }
  if (patch.additionalAddresses !== undefined) {
    const listening = childEl(knx, "ListeningAddresses");
    listening.children = [];
    for (const address of patch.additionalAddresses) {
      listening.children.push(
        element("Address", [
          ["Value", String(address)],
          ["String", formatGroupAddress(address)],
        ]),
      );
    }
  }
  if (patch.flags !== undefined) {
    const flags = childEl(knx, "Flags");
    setAttr(flags, "U", boolText(patch.flags.u));
    setAttr(flags, "T", boolText(patch.flags.t));
    setAttr(flags, "Ri", boolText(patch.flags.ri));
    setAttr(flags, "W", boolText(patch.flags.w));
    setAttr(flags, "R", boolText(patch.flags.r));
  }
  if (patch.priority !== undefined) setText(childEl(knx, "Priority"), String(patch.priority));
}

// --- helpers ---------------------------------------------------------------

function childrenOf(el: XmlElement, tag: string): XmlElement[] {
  return el.children.filter((c): c is XmlElement => c.kind === "element" && c.tag === tag);
}

function childElOpt(el: XmlElement, tag: string): XmlElement | undefined {
  return el.children.find((c): c is XmlElement => c.kind === "element" && c.tag === tag);
}

function childEl(parent: XmlElement, tag: string): XmlElement {
  const child = childElOpt(parent, tag);
  if (!child) throw new Error(`<${parent.tag}> has no <${tag}> child`);
  return child;
}

function textOf(el: XmlElement | undefined, tag: string): string | undefined {
  if (!el) return undefined;
  const child = childElOpt(el, tag);
  return child ? getText(child) : undefined;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() === "true";
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseIntText(el: XmlElement | undefined, tag: string, fallback: number): number {
  return parseNumber(el ? textOf(el, tag) : undefined, fallback);
}

function boolText(value: boolean): string {
  return value ? "True" : "False";
}
