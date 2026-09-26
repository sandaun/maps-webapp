import {
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
  DEFAULT_DPT,
  formatGroupAddress,
  type KnxFlags,
} from "@/protocols/knx";
import {
  defaultDevice,
  defaultRtuNode,
  defaultTcpNode,
  type MbmDevice,
  type MbmRtuNode,
  type MbmTcpNode,
} from "@/protocols/modbus/master";
import {
  CONVERSION_TYPE,
  conversionErrors,
  conversionListOf,
  defaultConversion,
  formatConversionNumber,
  isEditableConversionType,
  type ConversionField,
  type ConversionList,
} from "@/core/conversions/rules";
import { formatConversionIds, type SignalConversionRefs } from "@/core/signals/conversion-refs";
import { parseConversionIds } from "@/core/xbl/conversions";
import { parseBool } from "./from-xml";
import type { Conversion, GatewayInfo, KnxMbmSignal } from "./model";

/**
 * Patch operations on the preserved .ibmaps XmlDocument. Every edit keeps
 * unknown content, node order and formatting intact. Both protocol sides are
 * row-aligned (KNXObject ID == Signal ID), so signal operations touch both.
 */

const INDENT_UNIT = "  ";

// --- general / gateway / KNX config ---------------------------------------

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

export function setKnxPhysicalAddress(doc: XmlDocument, address: number): void {
  setText(mustFind(doc, ["InternalProtocol", "IndAddress"]), String(address));
}

export function setKnxExtendedAddresses(doc: XmlDocument, enabled: boolean): void {
  setText(mustFind(doc, ["InternalProtocol", "UseExtendedAddresses"]), boolText(enabled));
}

/** Global Modbus Master settings: media, deadband and poll records. */
export interface MbmConfigPatch {
  media?: number;
  deadband?: number;
  pollRecords?: { enabled?: boolean; useMissingReg?: boolean; maxRegisters?: number };
}

export function updateMbmConfig(doc: XmlDocument, patch: MbmConfigPatch): void {
  const external = mustFind(doc, ["ExternalProtocol"]);
  if (patch.media !== undefined) setText(childEl(external, "Media"), String(patch.media));
  if (patch.deadband !== undefined) setText(childEl(external, "Deadband"), String(patch.deadband));
  const pr = patch.pollRecords;
  if (pr) {
    const pollRecords = external.children.find(
      (c): c is XmlElement => c.kind === "element" && c.tag === "PollRecords",
    );
    if (pollRecords) {
      if (pr.enabled !== undefined) setAttr(pollRecords, "Enabled", boolText(pr.enabled));
      if (pr.useMissingReg !== undefined) setAttr(pollRecords, "UseMissingReg", boolText(pr.useMissingReg));
      if (pr.maxRegisters !== undefined) setAttr(pollRecords, "MaxRegisters", String(pr.maxRegisters));
    }
  }
}

// --- signals ---------------------------------------------------------------

/** Next free signal id (max existing + 1, 0 when empty). */
export function nextSignalId(doc: XmlDocument): number {
  const ids = [
    ...doc.findAll(["InternalProtocol", "KNXObject"]),
    ...doc.findAll(["ExternalProtocol", "Signals", "Signal"]),
  ].map((el) => Number(getAttr(el, "ID") ?? -1));
  return ids.length === 0 ? 0 : Math.max(...ids) + 1;
}

/** Append a new signal (KNXObject + Signal) with desktop-tool defaults. */
export function addSignal(doc: XmlDocument): number {
  const id = nextSignalId(doc);
  const internal = mustFind(doc, ["InternalProtocol"]);
  const signals = mustFind(doc, ["ExternalProtocol", "Signals"]);
  appendChildIndented(internal, buildKnxObject(id), 2);
  appendChildIndented(signals, buildMbmSignal(id), 3);
  return id;
}

/** Remove a signal from both protocol sides. IDs are renumbered per batch (`reorderSignalIds`). */
export function removeSignal(doc: XmlDocument, id: number): boolean {
  const knx = doc.find(["InternalProtocol", { tag: "KNXObject", attr: "ID", value: String(id) }]);
  const mbm = doc.find([
    "ExternalProtocol",
    "Signals",
    { tag: "Signal", attr: "ID", value: String(id) },
  ]);
  let removed = false;
  for (const el of [knx, mbm]) {
    if (el) removed = removeElement(el) || removed;
  }
  return removed;
}

/**
 * MAPS `ReorderIdxConfigs` (InternalKnx + ExternalMbm), run after deleting
 * signals: the i-th signal of each side gets ID = IdxConfig = IdxExternal = i.
 * Both sides are renumbered by position because MAPS and the XBL generator
 * pair them by position. Run it once after a batch of removals, so every ID
 * in the batch keeps referring to the signal it named before the batch.
 */
export function reorderSignalIds(doc: XmlDocument): void {
  doc.findAll(["InternalProtocol", "KNXObject"]).forEach((el, i) => {
    setAttr(el, "ID", String(i));
    setChildTextIfPresent(el, "IdxExternal", String(i));
    setChildTextIfPresent(el, "IdxConfig", String(i));
  });
  doc.findAll(["ExternalProtocol", "Signals", "Signal"]).forEach((el, i) => {
    setAttr(el, "ID", String(i));
    setChildTextIfPresent(el, "idxConfig", String(i));
    setChildTextIfPresent(el, "idxExternal", String(i));
  });
}

export interface SignalPatch {
  active?: boolean;
  description?: string;
  knx?: Partial<KnxMbmSignal["knx"]>;
  modbus?: Partial<KnxMbmSignal["modbus"]>;
  /** Refs of each half (KNX object = internal, Modbus signal = external), written as given. */
  conversionRefs?: SignalConversionRefs;
}

/** Apply a partial edit to a signal, patching both protocol nodes. */
export function updateSignal(doc: XmlDocument, id: number, patch: SignalPatch): void {
  const knx = mustFind(doc, [
    "InternalProtocol",
    { tag: "KNXObject", attr: "ID", value: String(id) },
  ]);
  const mbm = mustFind(doc, [
    "ExternalProtocol",
    "Signals",
    { tag: "Signal", attr: "ID", value: String(id) },
  ]);

  if (patch.active !== undefined) setText(childEl(knx, "Active"), boolText(patch.active));
  if (patch.description !== undefined) setText(childEl(knx, "Description"), patch.description);
  if (patch.conversionRefs !== undefined) {
    const { internal, external } = patch.conversionRefs;
    setText(childEl(knx, "IdxOperations"), formatConversionIds(internal.operations));
    setText(childEl(knx, "IdxFilters"), formatConversionIds(internal.filters));
    setText(childEl(mbm, "IdxOperations"), formatConversionIds(external.operations));
    setText(childEl(mbm, "IdxFilters"), formatConversionIds(external.filters));
  }

  const k = patch.knx;
  if (k) {
    if (k.dpt !== undefined) setAttr(childEl(knx, "DPT"), "Value", String(k.dpt ?? DEFAULT_DPT));
    if (k.groupAddress !== undefined) {
      const sending = childEl(knx, "SendingAddress");
      setAttr(sending, "Value", String(k.groupAddress));
      setAttr(sending, "String", formatGroupAddress(k.groupAddress));
    }
    if (k.additionalAddresses !== undefined) {
      const listening = childEl(knx, "ListeningAddresses");
      listening.children = [];
      for (const address of k.additionalAddresses) {
        listening.children.push(
          element("Address", [
            ["Value", String(address)],
            ["String", formatGroupAddress(address)],
          ]),
        );
      }
    }
    if (k.flags !== undefined) {
      const flags = childEl(knx, "Flags");
      setAttr(flags, "U", boolText(k.flags.u));
      setAttr(flags, "T", boolText(k.flags.t));
      setAttr(flags, "Ri", boolText(k.flags.ri));
      setAttr(flags, "W", boolText(k.flags.w));
      setAttr(flags, "R", boolText(k.flags.r));
    }
    if (k.priority !== undefined) setText(childEl(knx, "Priority"), String(k.priority));
  }

  const m = patch.modbus;
  if (m) {
    setNumberText(mbm, "Port", m.port === undefined ? undefined : m.port < 0 ? 255 : m.port);
    setNumberText(mbm, "DeviceIndex", m.deviceIndex);
    if (m.isBroadcast !== undefined) setText(childEl(mbm, "IsBroadcast"), boolText(m.isBroadcast));
    setNumberText(mbm, "ReadFunc", m.readFunc);
    setNumberText(mbm, "WriteFunc", m.writeFunc);
    setNumberText(mbm, "LenBits", m.lenBits);
    setNumberText(mbm, "Format", m.format);
    setNumberText(mbm, "ByteOrder", m.byteOrder);
    setNumberText(mbm, "Bit", m.bit);
    setNumberText(mbm, "NumOfBits", m.numOfBits);
    setNumberText(mbm, "Address", m.address);
  }
}

// --- conversions -----------------------------------------------------------

/**
 * Replace the project's conversion list like `IntesisXML.GetConversionsNode`:
 * all filters, then all operations, each as `<Conversion Id Description Type
 * Param1..4 />` (`CreateConversionXMLNode`, IntesisXML.cs:496-507).
 */
export function setConversions(doc: XmlDocument, conversions: Conversion[]): void {
  const ibox = mustFind(doc, ["IBOX"]);
  let container = doc.find(["IBOX", "Conversions"]);
  if (!container) {
    container = element("Conversions");
    appendChildIndented(ibox, container, 2);
  }
  container.children = [];
  container.emptyForm = "self";
  const ordered = [
    ...conversions.filter((conv) => conv.type === 0),
    ...conversions.filter((conv) => conv.type !== 0),
  ];
  for (const conv of ordered) appendChildIndented(container, conversionElement(conv), 3);
}

/** A conversion of the library, addressed as signal refs address it: list + position. */
export interface ConversionLocator {
  list: ConversionList;
  index: number;
}

/** Editable fields of a library entry; params are written as invariant-culture numbers. */
export interface ConversionPatch {
  description?: string;
  /** Operations only: switch between scale and arithmetic (`rb_scale` / `rb_arithmetic`). */
  type?: typeof CONVERSION_TYPE.SCALE | typeof CONVERSION_TYPE.ARITH;
  param1?: number;
  param2?: number;
  param3?: number;
  param4?: number;
}

export class ConversionEditError extends Error {
  constructor(
    readonly status: 409 | 422,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Append a filter, scale or arithmetic operation like the Conversions
 * Manager's add buttons: at the end of its list, numbered with the size of the
 * list the manager shows (`b_addFilter_Click` / `b_addConversion_Click`,
 * frmConversions.cs:531-625). `values` fills it (a duplicate); otherwise it
 * gets the MAPS defaults. Filters stay before the operations, as MAPS writes
 * them (`GetConversionsNode`, IntesisXML.cs:423-437). Returns the position.
 */
export function addConversion(
  doc: XmlDocument,
  type: typeof CONVERSION_TYPE.FILTER | typeof CONVERSION_TYPE.SCALE | typeof CONVERSION_TYPE.ARITH,
  values?: { description: string; params: [number, number, number, number] },
): number {
  const container = conversionsContainer(doc);
  const entries = conversionElements(container);
  const list = conversionListOf(type);
  const listed = entries.filter((el) => conversionListOf(conversionType(el)) === list);
  // The manager lists operations without the LUT remaps and logical ones (frmGateway.cs:579).
  const shown = listed.filter((el) => isEditableConversionType(conversionType(el))).length;
  const base = defaultConversion(type, shown);
  const conversion = values
    ? { ...base, description: values.description, params: values.params.map(formatConversionNumber) as Conversion["params"] }
    : base;
  if (values) {
    const errors = conversionErrors(conversion);
    const message = Object.values(errors)[0];
    if (message) throw new ConversionEditError(422, message);
  }
  const el = conversionElement(conversion);
  const lastFilter = entries.filter((entry) => conversionType(entry) === CONVERSION_TYPE.FILTER).at(-1);
  if (list === "filters" && entries.length > (lastFilter ? entries.indexOf(lastFilter) + 1 : 0)) {
    insertBeforeIndented(container, el, entries[lastFilter ? entries.indexOf(lastFilter) + 1 : 0]);
  } else {
    appendChildIndented(container, el, 3);
  }
  return listed.length;
}

/**
 * Edit a filter, scale or arithmetic operation like `SaveCurrentFilterSelection`
 * / `SaveCurrentOperationSelection` (frmConversions.cs:582-705): an arithmetic
 * operation always stores Param4 = 0. The edited fields must pass the
 * manager's rules (`conversionErrors`); LUT remaps and logical operations are
 * read-only.
 */
export function updateConversion(doc: XmlDocument, locator: ConversionLocator, patch: ConversionPatch): void {
  const el = conversionAt(doc, locator);
  const type = conversionType(el);
  if (!isEditableConversionType(type)) throw new ConversionEditError(409, SYSTEM_CONVERSION_MESSAGE);
  if (patch.type !== undefined && locator.list === "filters")
    throw new ConversionEditError(422, "A filter cannot become an operation.");

  const current = readConversionElement(el);
  const params = [...current.params] as Conversion["params"];
  const touched = new Set<ConversionField>();
  (["param1", "param2", "param3", "param4"] as const).forEach((key, i) => {
    const value = patch[key];
    if (value !== undefined) {
      params[i] = formatConversionNumber(value);
      touched.add(key);
    }
  });
  if (patch.description !== undefined) touched.add("description");
  if (patch.type !== undefined) touched.add("type");
  const next = {
    type: patch.type ?? type,
    description: patch.description ?? current.description,
    params,
  };
  const message = Object.values(conversionErrors(next, touched))[0];
  if (message) throw new ConversionEditError(422, message);
  if (next.type === CONVERSION_TYPE.ARITH) next.params[3] = "0";

  setAttr(el, "Description", next.description);
  setAttr(el, "Type", String(next.type));
  next.params.forEach((param, i) => setAttr(el, `Param${i + 1}`, param));
}

/**
 * Remove a filter, scale or arithmetic operation and keep every signal on the
 * conversions it had. DEVIATION: MAPS only drops the refs that fall out of
 * range (`UpdateConversionIndexes`, ExternalMbm.cs:1544-1564), so the signals
 * of the later entries silently move to the next one. Here the refs to the
 * removed entry go away and the later ones shift down, on both halves of
 * every signal. Returns the ids of the signals that used it.
 */
export function removeConversion(doc: XmlDocument, locator: ConversionLocator): number[] {
  const el = conversionAt(doc, locator);
  if (!isEditableConversionType(conversionType(el))) throw new ConversionEditError(409, SYSTEM_CONVERSION_MESSAGE);
  const container = el.parent!;
  removeElement(el);
  // An empty list is written as `<Conversions />`, as `setConversions` does.
  if (!conversionElements(container).length) {
    container.children = [];
    container.emptyForm = "self";
  }
  const affected = new Set<number>();
  const tag = locator.list === "filters" ? "IdxFilters" : "IdxOperations";
  for (const signal of [
    ...doc.findAll(["InternalProtocol", "KNXObject"]),
    ...doc.findAll(["ExternalProtocol", "Signals", "Signal"]),
  ]) {
    const refsEl = signal.children.find((c): c is XmlElement => c.kind === "element" && c.tag === tag);
    if (!refsEl) continue;
    const refs = parseConversionIds(getText(refsEl));
    if (!refs.some((ref) => ref.index >= locator.index)) continue;
    if (refs.some((ref) => ref.index === locator.index)) affected.add(Number(getAttr(signal, "ID")));
    const next = refs
      .filter((ref) => ref.index !== locator.index)
      .map((ref) => (ref.index > locator.index ? { ...ref, index: ref.index - 1 } : ref));
    setText(refsEl, formatConversionIds(next));
  }
  return [...affected].sort((a, b) => a - b);
}

const SYSTEM_CONVERSION_MESSAGE =
  "LUT remaps and logical operations are created by the template: they cannot be edited or removed.";

function conversionsContainer(doc: XmlDocument): XmlElement {
  const existing = doc.find(["IBOX", "Conversions"]);
  if (existing) return existing;
  const container = element("Conversions");
  container.emptyForm = "self";
  appendChildIndented(mustFind(doc, ["IBOX"]), container, 2);
  return container;
}

function conversionElements(container: XmlElement): XmlElement[] {
  return container.children.filter((c): c is XmlElement => c.kind === "element" && c.tag === "Conversion");
}

function conversionType(el: XmlElement): number {
  const type = Number(getAttr(el, "Type"));
  return Number.isFinite(type) ? type : CONVERSION_TYPE.FILTER;
}

function conversionAt(doc: XmlDocument, locator: ConversionLocator): XmlElement {
  const container = doc.find(["IBOX", "Conversions"]);
  const el = (container ? conversionElements(container) : []).filter(
    (entry) => conversionListOf(conversionType(entry)) === locator.list,
  )[locator.index];
  if (!el) throw new ConversionEditError(422, `There is no ${locator.list === "filters" ? "filter" : "operation"} ${locator.index}.`);
  return el;
}

function readConversionElement(el: XmlElement): { description: string; params: Conversion["params"] } {
  return {
    description: getAttr(el, "Description") ?? "",
    params: [getAttr(el, "Param1") ?? "", getAttr(el, "Param2") ?? "", getAttr(el, "Param3") ?? "", getAttr(el, "Param4") ?? ""],
  };
}

/** `CreateConversionXMLNode` (IntesisXML.cs:494-505). */
function conversionElement(conv: Conversion): XmlElement {
  return element("Conversion", [
    ["Id", String(conv.id)],
    ["Description", conv.description],
    ["Type", String(conv.type)],
    ["Param1", conv.params[0]],
    ["Param2", conv.params[1]],
    ["Param3", conv.params[2]],
    ["Param4", conv.params[3]],
  ]);
}

// --- devices / nodes -------------------------------------------------------

export type NodeLocator = { kind: "rtu" | "tcp"; nodeIndex: number };

export function addRtuNode(doc: XmlDocument): number {
  const container = mustFind(doc, ["ExternalProtocol", "RtuNodes"]);
  const index = doc.findAll(["ExternalProtocol", "RtuNodes", "RtuNode"]).length;
  appendChildIndented(container, rtuNodeToXml(defaultRtuNode()), 3);
  return index;
}

export function addTcpNode(doc: XmlDocument): number {
  const container = mustFind(doc, ["ExternalProtocol", "TCPNodes"]);
  const index = doc.findAll(["ExternalProtocol", "TCPNodes", "TCPNode"]).length;
  appendChildIndented(container, tcpNodeToXml(defaultTcpNode(index)), 3);
  return index;
}

/**
 * Remove a node as MAPS does (`DeleteTCPNode` + `UpdateTCPNodesAfterDelete`):
 * later TCP nodes are renumbered, the node's virtual signals are deleted, its
 * other signals are left without port/device, and signals on later ports
 * shift down one port.
 */
export function removeNode(doc: XmlDocument, locator: NodeLocator): boolean {
  const nodes = nodeElements(doc, locator.kind);
  const node = nodes[locator.nodeIndex];
  if (!node) return false;
  const port = globalPort(doc, locator);
  removeElement(node);
  if (locator.kind === "tcp") {
    for (const later of nodeElements(doc, "tcp")) {
      const index = Number(getAttr(later, "NodeIndex"));
      if (index > locator.nodeIndex) setAttr(later, "NodeIndex", String(index - 1));
    }
  }
  const deleted: number[] = [];
  for (const signal of mbmSignalRefs(doc)) {
    if (signal.port === port) {
      if (isVirtualSignal(doc, signal.id)) deleted.push(signal.id);
      else {
        setText(childEl(signal.el, "Port"), "255");
        setText(childEl(signal.el, "DeviceIndex"), "-1");
        setText(childEl(signal.el, "IsBroadcast"), "False");
      }
    } else if (signal.port > port) {
      setText(childEl(signal.el, "Port"), String(signal.port - 1));
    }
  }
  deleted.forEach((id) => removeSignal(doc, id));
  return true;
}

export function updateRtuNode(doc: XmlDocument, nodeIndex: number, patch: Partial<MbmRtuNode>): void {
  const node = doc.findAll(["ExternalProtocol", "RtuNodes", "RtuNode"])[nodeIndex];
  if (!node) throw new Error(`RTU node ${nodeIndex} not found`);
  const map: Record<string, keyof MbmRtuNode> = {
    Baudrate: "baudrate",
    DataBits: "dataBits",
    Parity: "parity",
    StopBits: "stopBits",
    TimeInterFrame: "timeInterFrame",
    PhysicalPort: "physicalPort",
  };
  for (const [attr, key] of Object.entries(map)) {
    const value = patch[key];
    if (value !== undefined) setAttr(node, attr, String(value));
  }
  if (patch.pollAfterWrite !== undefined) setAttr(node, "PollAfterWrite", boolText(patch.pollAfterWrite));
  if (patch.pollReadSignal !== undefined) setAttr(node, "PollReadSignal", boolText(patch.pollReadSignal));
}

export function updateTcpNode(doc: XmlDocument, nodeIndex: number, patch: Partial<MbmTcpNode>): void {
  const node = doc.findAll(["ExternalProtocol", "TCPNodes", "TCPNode"])[nodeIndex];
  if (!node) throw new Error(`TCP node ${nodeIndex} not found`);
  const map: Record<string, keyof MbmTcpNode> = {
    IP: "ip",
    Port: "port",
    Description: "description",
    TimeInterFrame: "timeInterFrame",
    RetryTimeout: "retryTimeout",
    ConnTimeout: "connTimeout",
    RxTimeout: "rxTimeout",
    TimeInterFrameNode: "timeInterFrameSlaveChange",
  };
  for (const [attr, key] of Object.entries(map)) {
    const value = patch[key];
    if (value !== undefined) setAttr(node, attr, String(value));
  }
}

export function addDevice(doc: XmlDocument, locator: NodeLocator): number {
  const node = nodeAt(doc, locator);
  const index = node.devices.length;
  const siblings = node.devices.map((el) => ({ slave: Number(getAttr(el, "SlaveNum")), name: getAttr(el, "Name") ?? "" }));
  appendChildIndented(node.el, deviceToXml(defaultDevice(index, siblings)), 4);
  return index;
}

export function updateDevice(
  doc: XmlDocument,
  locator: NodeLocator & { deviceIndex: number },
  patch: Partial<MbmDevice>,
): void {
  const { el } = deviceAt(doc, locator);
  const map: Record<string, keyof MbmDevice> = {
    Name: "name",
    Manufacturer: "manufacturer",
    SlaveNum: "slave",
    BaseRegister: "baseRegister",
    Timeout: "timeout",
  };
  for (const [attr, key] of Object.entries(map)) {
    const value = patch[key];
    if (value !== undefined) setAttr(el, attr, String(value));
  }
  if (patch.enabled !== undefined) setAttr(el, "Enabled", boolText(patch.enabled));
}

/** What happens to the signals of a removed device (MAPS `frmDeleteDevice`). */
export type RemovedDeviceSignals = "delete" | "unassign";

/**
 * Remove a device as MAPS does (`DeleteDevice` + project `RemoveDevice`).
 * `deviceIndex` is the device position, which is what signals reference.
 * Later devices are renumbered so `Index` keeps matching the position. The
 * device's signals are deleted, or — with "unassign" — only virtual ones are
 * deleted and the rest lose their port/device and are deactivated. Signals of
 * later devices on the same node shift down one position.
 */
export function removeDevice(
  doc: XmlDocument,
  locator: NodeLocator & { deviceIndex: number },
  signals: RemovedDeviceSignals,
): boolean {
  const { el } = deviceAt(doc, locator);
  const port = globalPort(doc, locator);
  const removedIndex = Number(getAttr(el, "Index"));
  removeElement(el);
  for (const device of nodeAt(doc, locator).devices) {
    const index = Number(getAttr(device, "Index"));
    if (index > removedIndex) setAttr(device, "Index", String(index - 1));
  }
  const deleted: number[] = [];
  for (const signal of mbmSignalRefs(doc)) {
    if (signal.port !== port) continue;
    if (signal.deviceIndex === locator.deviceIndex) {
      if (signals === "delete" || isVirtualSignal(doc, signal.id)) deleted.push(signal.id);
      else {
        setText(childEl(signal.el, "Port"), "255");
        setText(childEl(signal.el, "DeviceIndex"), "-1");
        const knx = doc.find(["InternalProtocol", { tag: "KNXObject", attr: "ID", value: String(signal.id) }]);
        if (knx) setText(childEl(knx, "Active"), boolText(false));
      }
    } else if (signal.deviceIndex > locator.deviceIndex) {
      setText(childEl(signal.el, "DeviceIndex"), String(signal.deviceIndex - 1));
    }
  }
  deleted.forEach((id) => removeSignal(doc, id));
  return true;
}

// --- XML builders (desktop-tool default shapes) ----------------------------

function buildKnxObject(id: number): XmlElement {
  const flags: KnxFlags = { u: true, t: false, ri: false, w: true, r: false };
  return element("KNXObject", [["ID", String(id)]], [
    element("Description", [], [text("")]),
    element("Active", [], [text("True")]),
    element("DPT", [["Value", String(DEFAULT_DPT)]]),
    element("SendingAddress", [
      ["Value", "0"],
      ["String", "0/0/0"],
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
  ]);
}

function buildMbmSignal(id: number): XmlElement {
  return element("Signal", [["ID", String(id)]], [
    element("idxConfig", [], [text(String(id))]),
    element("idxExternal", [], [text(String(id))]),
    pairElement("IdxOperations"),
    pairElement("IdxFilters"),
    element("Port", [], [text("255")]),
    element("DeviceIndex", [], [text("-1")]),
    element("IsBroadcast", [], [text("False")]),
    element("ReadFunc", [], [text("-1")]),
    element("WriteFunc", [], [text("-1")]),
    element("LenBits", [], [text("16")]),
    element("Format", [], [text("0")]),
    element("ByteOrder", [], [text("0")]),
    element("Bit", [], [text("-1")]),
    element("NumOfBits", [], [text("-1")]),
    element("Address", [], [text("0")]),
    element("Virtual", [
      ["Status", "False"],
      ["Fixed", "True"],
    ]),
  ]);
}

function deviceToXml(device: MbmDevice): XmlElement {
  return element("Device", [
    ["Index", String(device.index)],
    ["Name", device.name],
    ["Manufacturer", device.manufacturer],
    ["SlaveNum", String(device.slave)],
    ["BaseRegister", String(device.baseRegister)],
    ["Timeout", String(device.timeout)],
    ["Enabled", boolText(device.enabled)],
  ]);
}

function rtuNodeToXml(node: MbmRtuNode): XmlElement {
  return element("RtuNode", [
    ["Baudrate", String(node.baudrate)],
    ["DataBits", String(node.dataBits)],
    ["Parity", String(node.parity)],
    ["StopBits", String(node.stopBits)],
    ["TimeInterFrame", String(node.timeInterFrame)],
    ["PhysicalPort", String(node.physicalPort)],
    ["PollAfterWrite", boolText(node.pollAfterWrite)],
    ["PollReadSignal", boolText(node.pollReadSignal)],
  ]);
}

function tcpNodeToXml(node: MbmTcpNode): XmlElement {
  return element("TCPNode", [
    ["NodeIndex", String(node.nodeIndex)],
    ["IP", node.ip],
    ["Port", String(node.port)],
    ["Description", node.description],
    ["TimeInterFrame", String(node.timeInterFrame)],
    ["RetryTimeout", String(node.retryTimeout)],
    ["ConnTimeout", String(node.connTimeout)],
    ["RxTimeout", String(node.rxTimeout)],
    ["TimeInterFrameNode", String(node.timeInterFrameSlaveChange)],
  ]);
}

// --- internal helpers ------------------------------------------------------

/** `.NET` bool format. */
function boolText(value: boolean): string {
  return value ? "True" : "False";
}

/** Elements written with empty-pair form (`<IdxOperations></IdxOperations>`). */
function pairElement(tag: string): XmlElement {
  const el = element(tag, [], [text("")]);
  return el;
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

function setChildTextIfPresent(parent: XmlElement, tag: string, value: string): void {
  const child = parent.children.find((c): c is XmlElement => c.kind === "element" && c.tag === tag);
  if (child && getText(child) !== value) setText(child, value);
}

function setNumberText(parent: XmlElement, tag: string, value: number | undefined): void {
  if (value !== undefined) setText(childEl(parent, tag), String(value));
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

/** Insert `child` right before its sibling `ref`, with the same indentation as `ref`. */
function insertBeforeIndented(parent: XmlElement, child: XmlElement, ref: XmlElement): void {
  const index = parent.children.indexOf(ref);
  const before = parent.children[index - 1];
  const indent = before && before.kind === "text" && /^\s*$/.test(before.text) ? before.text : "";
  child.parent = parent;
  parent.children.splice(index, 0, child, text(indent));
}

/**
 * Append a child matching the surrounding indentation: inserts before the
 * closing-tag whitespace with one extra indent level.
 */
function appendChildIndented(parent: XmlElement, child: XmlElement, childLevel: number): void {
  // .ibmaps is always written with CRLF line endings.
  const lineEnding = "\r\n";
  const last = parent.children[parent.children.length - 1];
  child.parent = parent;
  if (last && last.kind === "text" && /^\s*$/.test(last.text)) {
    const indent = `${lineEnding}${INDENT_UNIT.repeat(childLevel)}`;
    parent.children.splice(parent.children.length - 1, 0, text(indent), child);
  } else {
    const base = `${lineEnding}${INDENT_UNIT.repeat(Math.max(0, childLevel - 1))}`;
    parent.children = [text(`${base}${INDENT_UNIT}`), child, text(base)];
    parent.emptyForm = undefined;
  }
}

function nodeElements(doc: XmlDocument, kind: NodeLocator["kind"]): XmlElement[] {
  return kind === "rtu"
    ? doc.findAll(["ExternalProtocol", "RtuNodes", "RtuNode"])
    : doc.findAll(["ExternalProtocol", "TCPNodes", "TCPNode"]);
}

/** Signal `Port`: RTU nodes first, then TCP nodes. */
function globalPort(doc: XmlDocument, locator: NodeLocator): number {
  return locator.kind === "rtu" ? locator.nodeIndex : nodeElements(doc, "rtu").length + locator.nodeIndex;
}

function mbmSignalRefs(doc: XmlDocument): { el: XmlElement; id: number; port: number; deviceIndex: number }[] {
  return doc.findAll(["ExternalProtocol", "Signals", "Signal"]).map((el) => {
    const port = Number(textOfChild(el, "Port") ?? 255);
    return {
      el,
      id: Number(getAttr(el, "ID") ?? -1),
      port: port === 255 ? -1 : port,
      deviceIndex: Number(textOfChild(el, "DeviceIndex") ?? -1),
    };
  });
}

/** Same source as the reader: the KNXObject `<Virtual Status>`. */
function isVirtualSignal(doc: XmlDocument, id: number): boolean {
  const knx = doc.find(["InternalProtocol", { tag: "KNXObject", attr: "ID", value: String(id) }]);
  const virtual = knx?.children.find((c): c is XmlElement => c.kind === "element" && c.tag === "Virtual");
  return parseBool(virtual ? getAttr(virtual, "Status") : undefined, false);
}

function textOfChild(parent: XmlElement, tag: string): string | undefined {
  const child = parent.children.find((c): c is XmlElement => c.kind === "element" && c.tag === tag);
  return child ? getText(child) : undefined;
}

function nodeAt(doc: XmlDocument, locator: NodeLocator): { el: XmlElement; devices: XmlElement[] } {
  const nodes = nodeElements(doc, locator.kind);
  const el = nodes[locator.nodeIndex];
  if (!el) throw new Error(`${locator.kind.toUpperCase()} node ${locator.nodeIndex} not found`);
  return { el, devices: el.children.filter((c): c is XmlElement => c.kind === "element" && c.tag === "Device") };
}

function deviceAt(
  doc: XmlDocument,
  locator: NodeLocator & { deviceIndex: number },
): { el: XmlElement } {
  const { devices } = nodeAt(doc, locator);
  const el = devices[locator.deviceIndex];
  if (!el) throw new Error(`Device ${locator.deviceIndex} not found`);
  return { el };
}
