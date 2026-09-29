import {
  appendChildIndented,
  element,
  getAttr,
  getText,
  setAttr,
  setText,
  text,
  XmlDocument,
  type XmlElement,
} from "@/core/project-format";
import {
  removeConversion as removeLibraryConversion,
  type ConversionLocator,
} from "@/core/conversions/library-xml";
import { formatConversionIds, type SignalConversionRefs } from "@/core/signals/conversion-refs";
import {
  applyFlagEdit,
  encodeDpt,
  DPT_WILDCARD_SUBTYPE,
  flagsForRwMode,
  formatGroupAddress,
  MAX_GROUP_ADDRESS_STANDARD,
  type KnxEndpoint,
  type KnxFlags,
} from "@/protocols/knx";
import {
  patchKnxEndpoint,
  readKnxEndpoint,
  setKnxExtendedAddresses as setKnxExtendedAddressesOn,
  setKnxPhysicalAddress as setKnxPhysicalAddressOn,
} from "@/protocols/knx/xml";
import {
  fitMbsRowEdit,
  mbsObjectRwMode,
  type MbsConfig,
  type MbsEndpoint,
} from "@/protocols/modbus/slave";
import {
  buildMbsSignal,
  patchMbsConfig,
  patchMbsEndpoint,
  patchMbsRtuConfig,
  patchMbsTcpConfig,
  readMbsEndpoint,
} from "@/protocols/modbus/slave/xml";
import { readMbsKnxEndpoint } from "./from-xml";
import type { GatewayInfo } from "./model";

/**
 * Patch operations on the preserved .ibmaps XmlDocument. Every edit keeps
 * unknown content, node order and formatting intact. Both protocol sides are
 * row-aligned (Modbus `Signal` ID == `KNXObject` ID), so signal operations
 * touch both. MAPS behaviour: `IntesisProjectMBSKNX_RT` (see
 * docs/reference/mbs-knx-analisi.md).
 */

/** A signal edit MAPS would not allow (e.g. on a fixed row). */
export class SignalEditError extends Error {
  constructor(
    readonly status: 409 | 422,
    message: string,
  ) {
    super(message);
  }
}

// --- general / gateway -------------------------------------------------------

export function setGeneralInfo(
  doc: XmlDocument,
  patch: { name?: string; description?: string },
): void {
  if (patch.name !== undefined) setAttr(doc.root, "ProjectName", patch.name);
  if (patch.description !== undefined) setAttr(doc.root, "ProjectDescription", patch.description);
  const header = doc.find(["Header"]);
  if (header && patch.description !== undefined) setAttr(header, "Description", patch.description);
}

export function setGatewayInfo(doc: XmlDocument, patch: Partial<GatewayInfo>): void {
  const ibox = mustFind(doc, ["IBOX"]);
  if (patch.name !== undefined) setAttr(ibox, "Name", patch.name);
  if (patch.ip !== undefined) setAttr(ibox, "IP", patch.ip);
  if (patch.netmask !== undefined) setAttr(ibox, "NetMask", patch.netmask);
  if (patch.gateway !== undefined) setAttr(ibox, "Gateway", patch.gateway);
  if (patch.dhcp !== undefined) setAttr(ibox, "DHCP", boolText(patch.dhcp));
  // Never touches Pwd.
}

// --- Modbus Slave config -------------------------------------------------------

/**
 * The Modbus Slave settings MAPS shows for this family. The address mode,
 * the communication timeout and the slave addressing mode are hidden
 * (`frmInternalMBS` defaults + `SetSlaveAddressModeEnabled(false)`,
 * IntesisProjectMBSKNX_RT.cs:670-676), so they are not editable here.
 */
export type MbsKnxConfigPatch = Partial<Pick<MbsConfig, "media" | "byteOrder" | "updateCOV" | "registerBase">>;

export function updateMbsConfig(doc: XmlDocument, patch: MbsKnxConfigPatch): void {
  patchMbsConfig(mustFind(doc, ["InternalProtocol"]), patch);
}

export function updateRtuConfig(doc: XmlDocument, patch: Partial<MbsConfig["rtu"]>): void {
  patchMbsRtuConfig(mustFind(doc, ["InternalProtocol"]), patch);
}

export function updateTcpConfig(doc: XmlDocument, patch: Partial<MbsConfig["tcp"]>): void {
  patchMbsTcpConfig(mustFind(doc, ["InternalProtocol"]), patch);
}

// --- KNX config -------------------------------------------------------------

export function setKnxPhysicalAddress(doc: XmlDocument, address: number): void {
  setKnxPhysicalAddressOn(mustFind(doc, ["ExternalProtocol"]), address);
}

export function setKnxExtendedAddresses(doc: XmlDocument, enabled: boolean): void {
  setKnxExtendedAddressesOn(mustFind(doc, ["ExternalProtocol"]), enabled);
}

// --- signals -----------------------------------------------------------------

/** Next free signal id (max existing + 1, 0 when empty). */
export function nextSignalId(doc: XmlDocument): number {
  const ids = [...mbsSignals(doc), ...knxObjects(doc)].map((el) => Number(getAttr(el, "ID") ?? -1));
  return ids.length === 0 ? 0 : Math.max(...ids) + 1;
}

/**
 * Append a new signal like `CreateNewRow` (IntesisProjectMBSKNX_RT.cs:537-568):
 * a disabled 16-bit unsigned read/write register at address 0, and a KNX
 * object with DPT 7.x, flags U T W R, priority 3 and the next group address
 * (`IntesisKnx.GetNextGA`).
 */
export function addSignal(doc: XmlDocument): number {
  const id = nextSignalId(doc);
  const internalSignals = mustFind(doc, ["InternalProtocol", "Signals"]);
  const external = mustFind(doc, ["ExternalProtocol"]);
  const extended = (textOfChild(external, "UseExtendedAddresses") ?? "").toLowerCase() === "true";
  appendChildIndented(internalSignals, buildMbsSignal(id, { enabled: false }), 3);
  appendChildIndented(external, buildKnxObject(id, nextGroupAddress(doc), extended), 2);
  return id;
}

/**
 * Remove a signal from both protocol sides. IDs are renumbered per batch
 * (`reorderSignalIds`). Fixed rows cannot be removed (`IsRemovableRow`,
 * IntesisProjectMBSKNX_RT.cs:598-605).
 */
export function removeSignal(doc: XmlDocument, id: number): boolean {
  const mbs = findMbsSignal(doc, id);
  const knx = findKnxObject(doc, id);
  if (mbs && isFixed(mbs)) {
    throw new SignalEditError(409, `Signal ${id + 1} is fixed by the template: it cannot be removed.`);
  }
  let removed = false;
  for (const el of [mbs, knx]) {
    if (el) removed = removeElement(el) || removed;
  }
  return removed;
}

/**
 * MAPS `ReorderIdxConfigs` (InternalMbs + ExternalKnx), run after deleting
 * signals: the i-th signal of each side gets ID = idxConfig = idxExternal = i.
 * Run it once after a batch of removals, so every ID in the batch keeps
 * referring to the signal it named before the batch.
 */
export function reorderSignalIds(doc: XmlDocument): void {
  mbsSignals(doc).forEach((el, i) => {
    setAttr(el, "ID", String(i));
    setChildTextIfPresent(el, "idxConfig", String(i));
    setChildTextIfPresent(el, "idxExternal", String(i));
  });
  knxObjects(doc).forEach((el, i) => {
    setAttr(el, "ID", String(i));
    setChildTextIfPresent(el, "IdxExternal", String(i));
    setChildTextIfPresent(el, "IdxConfig", String(i));
  });
}

export interface SignalPatch {
  active?: boolean;
  description?: string;
  modbus?: Partial<MbsEndpoint>;
  knx?: Partial<KnxEndpoint>;
  /** Refs of each half (Modbus signal = internal, KNX object = external), written as given. */
  conversionRefs?: SignalConversionRefs;
}

/**
 * Apply a partial edit to a signal, patching both protocol nodes, then
 * re-check the row as every edit does in MAPS (`IntesisProject.CheckThisRow`):
 * - the Modbus row (`fitMbsRowEdit`): BitFields forces 16 bits and bit 0
 *   when there was none; other formats save the bit as -1;
 * - the edited KNX flags (`applyFlagEdit`, `ExternalKnx.CheckThisRow`);
 * - the KNX flags against the Modbus read/write mode (`CheckThisRowSpecific`,
 *   IntesisProjectMBSKNX_RT.cs:349-377); when the mode itself changes, the
 *   mode's flags are turned on as well, unless the same edit sets the flags.
 */
export function updateSignal(doc: XmlDocument, id: number, patch: SignalPatch): void {
  const mbs = findMbsSignal(doc, id);
  const knx = findKnxObject(doc, id);
  if (!mbs || !knx) throw new Error(`Signal ${id} does not exist`);
  if (isFixed(mbs)) assertFixedRowPatch(id, patch);

  const loaded = readMbsKnxEndpoint(mbs);
  const flagsBefore = readKnxEndpoint(knx).flags;
  if (patch.active !== undefined) setText(childEl(mbs, "isEnabled"), boolText(patch.active));
  if (patch.description !== undefined) setText(childEl(mbs, "Description"), patch.description);
  if (patch.conversionRefs !== undefined) {
    const { internal, external } = patch.conversionRefs;
    setText(childEl(mbs, "IdxOperations"), formatConversionIds(internal.operations));
    setText(childEl(mbs, "IdxFilters"), formatConversionIds(internal.filters));
    setText(childEl(knx, "IdxOperations"), formatConversionIds(external.operations));
    setText(childEl(knx, "IdxFilters"), formatConversionIds(external.filters));
  }
  if (patch.modbus) patchMbsEndpoint(mbs, patch.modbus);
  patchMbsEndpoint(mbs, fitMbsRowEdit(loaded, patch.modbus ?? {}));
  if (patch.knx) patchKnxEndpoint(knx, patch.knx);

  const readWrite = readMbsEndpoint(mbs).readWrite;
  const rwMode = mbsObjectRwMode(readWrite);
  const flags = readKnxEndpoint(knx).flags;
  const edited = patch.knx?.flags ? applyFlagEdit(flagsBefore, flags, rwMode) : flags;
  // MAPS turns the mode's flags on when the read/write cell changes; flags sent
  // in the same edit (an undo restoring both) are kept, only fitted to the mode.
  const forceModeFlags = readWrite !== loaded.readWrite && patch.knx?.flags === undefined;
  const fitted = flagsForRwMode(edited, rwMode, forceModeFlags);
  if (!sameFlags(flags, fitted)) patchKnxEndpoint(knx, { flags: fitted });
}

/**
 * Cells MAPS makes read-only on a fixed row (`CheckThisRowSpecific`,
 * IntesisProjectMBSKNX_RT.cs:357-374): description, length, format, bit,
 * read/write, DPT, additional addresses and the flags. Active, the address,
 * the group address, the priority and the conversions stay editable.
 */
function assertFixedRowPatch(id: number, patch: SignalPatch): void {
  const m = patch.modbus ?? {};
  const k = patch.knx ?? {};
  const locked =
    patch.description !== undefined ||
    m.lenBits !== undefined ||
    m.format !== undefined ||
    m.bit !== undefined ||
    m.readWrite !== undefined ||
    m.stringLength !== undefined ||
    k.dpt !== undefined ||
    k.additionalAddresses !== undefined ||
    k.flags !== undefined;
  if (locked) {
    throw new SignalEditError(409, `Signal ${id + 1} is fixed by the template: only its address, group address, priority, state and conversions can change.`);
  }
}

// --- conversions -----------------------------------------------------------

// The conversion library is shared by every family: `src/core/conversions/library-xml.ts`.
export {
  addConversion,
  ConversionEditError,
  setConversions,
  updateConversion,
  type ConversionLocator,
  type ConversionPatch,
} from "@/core/conversions/library-xml";

/**
 * `removeConversion` over both halves of every MBS–KNX row (Modbus signals +
 * KNX objects), enabled or not.
 */
export function removeConversion(doc: XmlDocument, locator: ConversionLocator): number[] {
  return removeLibraryConversion(doc, locator, [...mbsSignals(doc), ...knxObjects(doc)]);
}

// --- XML builders (desktop-tool default shapes) ------------------------------

/**
 * `IntesisKnx.GetNextGA` (IntesisKnx.cs:2280-2295): one past the highest
 * sending group address of the project (ushort arithmetic).
 */
function nextGroupAddress(doc: XmlDocument): number {
  let highest = 0;
  for (const el of knxObjects(doc)) {
    highest = Math.max(highest, readKnxEndpoint(el).groupAddress);
  }
  return (highest + 1) & 0xffff;
}

/**
 * `IntesisKnx.ConvertKNXAddressToString(address, 3, extended)`
 * (IntesisKnx.cs:100-138): empty for 0 and, without extended addresses, for
 * values past 15/7/255.
 */
function groupAddressString(address: number, extended: boolean): string {
  if (address === 0) return "";
  if (!extended && address > MAX_GROUP_ADDRESS_STANDARD) return "";
  return formatGroupAddress(address);
}

/**
 * A new `<KNXObject>` as `ExternalKnx.CreateKNXObject` builds it and
 * `KnxComObject.ToXML` writes it (KnxComObject.cs:134-209). Description and
 * AllowedValues are never set by MAPS, so they are written empty.
 */
function buildKnxObject(id: number, groupAddress: number, extended: boolean): XmlElement {
  const flags: KnxFlags = { u: true, t: true, ri: false, w: true, r: true };
  return element("KNXObject", [["ID", String(id)]], [
    element("Description", [], [text("")]),
    element("Active", [], [text("True")]),
    element("AllowedValues", [], [text("")]),
    element("DPT", [["Value", String(encodeDpt(7, DPT_WILDCARD_SUBTYPE))]]),
    element("SendingAddress", [
      ["Value", String(groupAddress)],
      ["String", groupAddressString(groupAddress, extended)],
    ]),
    element("ListeningAddresses"),
    element("Flags", [
      ["U", boolText(flags.u)],
      ["T", boolText(flags.t)],
      ["Ri", boolText(flags.ri)],
      ["W", boolText(flags.w)],
      ["R", boolText(flags.r)],
    ]),
    element("Priority", [], [text("3")]),
    element("UpdateGA", [], [text("0")]),
    element("IdxExternal", [], [text(String(id))]),
    element("IdxConfig", [], [text(String(id))]),
    pairElement("IdxOperations"),
    pairElement("IdxFilters"),
    element("Virtual", [
      ["Status", "False"],
      ["Fixed", "False"],
      ["General", "False"],
    ]),
    element("ProtocolIndex", [], [text("-1")]),
  ]);
}

// --- internal helpers ----------------------------------------------------------

function mbsSignals(doc: XmlDocument): XmlElement[] {
  return doc.findAll(["InternalProtocol", "Signals", "Signal"]);
}

function knxObjects(doc: XmlDocument): XmlElement[] {
  return doc.findAll(["ExternalProtocol", "KNXObject"]);
}

function findMbsSignal(doc: XmlDocument, id: number): XmlElement | undefined {
  return doc.find(["InternalProtocol", "Signals", { tag: "Signal", attr: "ID", value: String(id) }]);
}

function findKnxObject(doc: XmlDocument, id: number): XmlElement | undefined {
  return doc.find(["ExternalProtocol", { tag: "KNXObject", attr: "ID", value: String(id) }]);
}

function isFixed(signal: XmlElement): boolean {
  const virt = signal.children.find((c): c is XmlElement => c.kind === "element" && c.tag === "Virtual");
  return (virt ? (getAttr(virt, "Fixed") ?? "") : "").toLowerCase() === "true";
}

function sameFlags(a: KnxFlags, b: KnxFlags): boolean {
  return a.u === b.u && a.t === b.t && a.ri === b.ri && a.w === b.w && a.r === b.r;
}

/** `.NET` bool format. */
function boolText(value: boolean): string {
  return value ? "True" : "False";
}

/** Elements written with empty-pair form (`<IdxOperations></IdxOperations>`). */
function pairElement(tag: string): XmlElement {
  return element(tag, [], [text("")]);
}

function mustFind(doc: XmlDocument, path: Parameters<XmlDocument["find"]>[0]): XmlElement {
  const el = doc.find(path);
  if (!el) throw new Error(`Expected XML element missing at ${JSON.stringify(path)}`);
  return el;
}

function childEl(parent: XmlElement, tag: string): XmlElement {
  const child = parent.children.find((c): c is XmlElement => c.kind === "element" && c.tag === tag);
  if (!child) throw new Error(`<${parent.tag}> has no <${tag}> child`);
  return child;
}

function textOfChild(parent: XmlElement, tag: string): string | undefined {
  const child = parent.children.find((c): c is XmlElement => c.kind === "element" && c.tag === tag);
  return child ? getText(child) : undefined;
}

function setChildTextIfPresent(parent: XmlElement, tag: string, value: string): void {
  const child = parent.children.find((c): c is XmlElement => c.kind === "element" && c.tag === tag);
  if (child && getText(child) !== value) setText(child, value);
}

function removeElement(el: XmlElement): boolean {
  // Also drop the whitespace text node that precedes the element, so the
  // document stays cleanly indented.
  const parent = el.parent;
  if (!parent) return false;
  const index = parent.children.indexOf(el);
  if (index < 0) return false;
  const before = parent.children[index - 1];
  if (before && before.kind === "text" && /^\s*$/.test(before.text)) {
    parent.children.splice(index - 1, 2);
  } else {
    parent.children.splice(index, 1);
  }
  el.parent = undefined;
  return true;
}
