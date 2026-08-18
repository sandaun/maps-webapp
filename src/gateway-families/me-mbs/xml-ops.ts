import {
  element,
  getAttr,
  setAttr,
  setText,
  text,
  XmlDocument,
  type XmlElement,
} from "@/core/project-format";
import type { MeControllerInfo, MeGroupInfo } from "@/protocols/me";
import type { MbsConfig } from "@/protocols/modbus/slave";
import type { GatewayInfo, MeMbsSignal } from "./model";

/**
 * Patch operations on the preserved .ibmaps XmlDocument. Every edit keeps
 * unknown content, node order and formatting intact. Both protocol sides are
 * row-aligned (internal Signal ID == external Signal ID), so signal
 * operations touch both.
 */

const INDENT_UNIT = "  ";

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

export function updateMbsConfig(
  doc: XmlDocument,
  patch: Partial<Pick<MbsConfig, "media" | "byteOrder" | "updateCOV" | "commErrorTout" | "registerBase">>,
): void {
  const internal = mustFind(doc, ["InternalProtocol"]);
  if (patch.media !== undefined) setText(childEl(internal, "Media"), String(patch.media));
  if (patch.byteOrder !== undefined) setText(childEl(internal, "ByteOrder"), String(patch.byteOrder));
  if (patch.updateCOV !== undefined) setText(childEl(internal, "UpdateCOV"), boolText(patch.updateCOV));
  if (patch.commErrorTout !== undefined) setText(childEl(internal, "CommErrorTout"), String(patch.commErrorTout));
  if (patch.registerBase !== undefined) setText(childEl(internal, "RegisterBase"), String(patch.registerBase));
}

export function updateRtuConfig(doc: XmlDocument, patch: Partial<MbsConfig["rtu"]>): void {
  const rtu = mustFind(doc, ["InternalProtocol", "RTUConfig"]);
  const map: Record<string, keyof MbsConfig["rtu"]> = {
    ConnectionType: "connectionType",
    Baudrate: "baudrate",
    DataBits: "dataBits",
    Parity: "parity",
    StopBits: "stopBits",
    SlaveNumber: "slaveNumber",
  };
  for (const [attr, key] of Object.entries(map)) {
    const value = patch[key];
    if (value !== undefined) setAttr(rtu, attr, String(value));
  }
}

export function updateTcpConfig(doc: XmlDocument, patch: Partial<MbsConfig["tcp"]>): void {
  const tcp = mustFind(doc, ["InternalProtocol", "TCPConfig"]);
  if (patch.port !== undefined) setAttr(tcp, "Port", String(patch.port));
  if (patch.keepAlive !== undefined) setAttr(tcp, "KeepAlive", String(patch.keepAlive));
}

// --- ME config (controllers / groups) ------------------------------------------

export function updateMeScalars(
  doc: XmlDocument,
  patch: Partial<Pick<import("@/protocols/me").MeConfig, "pollPeriod" | "ansTimeout" | "controllerTout" | "writeMaxBurst">>,
): void {
  const external = mustFind(doc, ["ExternalProtocol"]);
  if (patch.pollPeriod !== undefined) setText(childEl(external, "PollPeriod"), String(patch.pollPeriod));
  if (patch.ansTimeout !== undefined) setText(childEl(external, "AnsTimeout"), String(patch.ansTimeout));
  if (patch.controllerTout !== undefined) setText(childEl(external, "ControllerTout"), String(patch.controllerTout));
  if (patch.writeMaxBurst !== undefined) setText(childEl(external, "WriteMaxBurst"), String(patch.writeMaxBurst));
}

export function updateController(
  doc: XmlDocument,
  controllerIndex: number,
  patch: Partial<Pick<MeControllerInfo, "description" | "enabled" | "ip" | "port" | "model" | "compatibility" | "addErrorSignals">>,
): void {
  const el = controllerAt(doc, controllerIndex);
  if (patch.description !== undefined) setText(childEl(el, "Description"), patch.description);
  if (patch.enabled !== undefined) setText(childEl(el, "Enabled"), boolText(patch.enabled));
  if (patch.ip !== undefined) setText(childEl(el, "IP"), patch.ip);
  if (patch.port !== undefined) setText(childEl(el, "Port"), String(patch.port));
  if (patch.model !== undefined) setText(childEl(el, "Model"), String(patch.model));
  if (patch.compatibility !== undefined) setText(childEl(el, "Compatibility"), String(patch.compatibility));
  if (patch.addErrorSignals !== undefined) setText(childEl(el, "AddErrorSignals"), boolText(patch.addErrorSignals));
  // Never touches AuthUserId / AuthPassword.
}

export function updateGroup(
  doc: XmlDocument,
  controllerIndex: number,
  groupIndex: number,
  patch: Partial<Pick<MeGroupInfo, "enabled" | "description" | "type" | "fanSpeeds" | "dualSetPoint" | "urc" | "capacity">>,
): void {
  const el = groupAt(doc, controllerIndex, groupIndex);
  if (patch.enabled !== undefined) setAttr(el, "Enabled", boolText(patch.enabled));
  if (patch.description !== undefined) setAttr(el, "Description", patch.description);
  if (patch.type !== undefined) setAttr(el, "Type", String(patch.type));
  if (patch.fanSpeeds !== undefined) setAttr(el, "NumOfFanSpeeds", String(patch.fanSpeeds));
  if (patch.dualSetPoint !== undefined) setAttr(el, "DualSetPoint", boolText(patch.dualSetPoint));
  if (patch.urc !== undefined) setAttr(el, "URC", boolText(patch.urc));
  if (patch.capacity !== undefined) setAttr(el, "Capacity", String(patch.capacity));
}

// --- signals -----------------------------------------------------------------

/** Next free signal id (max existing + 1, 0 when empty). */
export function nextSignalId(doc: XmlDocument): number {
  const ids = [
    ...doc.findAll(["InternalProtocol", "Signals", "Signal"]),
    ...doc.findAll(["ExternalProtocol", "Signals", "Signal"]),
  ].map((el) => Number(getAttr(el, "ID") ?? -1));
  return ids.length === 0 ? 0 : Math.max(...ids) + 1;
}

/** Append a new signal (internal + external) with desktop-tool defaults. */
export function addSignal(doc: XmlDocument): number {
  const id = nextSignalId(doc);
  const internalSignals = mustFind(doc, ["InternalProtocol", "Signals"]);
  const externalSignals = mustFind(doc, ["ExternalProtocol", "Signals"]);
  appendChildIndented(internalSignals, buildMbsSignal(id), 3);
  appendChildIndented(externalSignals, buildMeSignal(id), 3);
  return id;
}

/** Remove a signal from both protocol sides. */
export function removeSignal(doc: XmlDocument, id: number): boolean {
  const mbs = doc.find(["InternalProtocol", "Signals", { tag: "Signal", attr: "ID", value: String(id) }]);
  const me = doc.find(["ExternalProtocol", "Signals", { tag: "Signal", attr: "ID", value: String(id) }]);
  let removed = false;
  for (const el of [mbs, me]) {
    if (el) removed = removeElement(el) || removed;
  }
  return removed;
}

export interface SignalPatch {
  active?: boolean;
  description?: string;
  me?: Partial<MeMbsSignal["me"]>;
  modbus?: Partial<MeMbsSignal["modbus"]>;
  idxOperations?: string;
  idxFilters?: string;
}

/** Apply a partial edit to a signal, patching both protocol nodes. */
export function updateSignal(doc: XmlDocument, id: number, patch: SignalPatch): void {
  const mbs = mustFind(doc, [
    "InternalProtocol",
    "Signals",
    { tag: "Signal", attr: "ID", value: String(id) },
  ]);
  const me = mustFind(doc, [
    "ExternalProtocol",
    "Signals",
    { tag: "Signal", attr: "ID", value: String(id) },
  ]);

  if (patch.active !== undefined) setText(childEl(mbs, "isEnabled"), boolText(patch.active));
  if (patch.description !== undefined) setText(childEl(mbs, "Description"), patch.description);
  if (patch.idxOperations !== undefined) {
    setText(childEl(mbs, "IdxOperations"), patch.idxOperations);
    setText(childEl(me, "IdxOperations"), patch.idxOperations);
  }
  if (patch.idxFilters !== undefined) {
    setText(childEl(mbs, "IdxFilters"), patch.idxFilters);
    setText(childEl(me, "IdxFilters"), patch.idxFilters);
  }

  const e = patch.me;
  if (e) {
    setNumberText(me, "G50Index", e.g50Index);
    setNumberText(me, "GroupIndex", e.groupIndex);
    setNumberText(me, "UnitId", e.unitId);
    if (e.isIndoor !== undefined) setText(childEl(me, "IsIndoorSignal"), boolText(e.isIndoor));
    if (e.isStatus !== undefined) setText(childEl(me, "IsStatus"), boolText(e.isStatus));
    setNumberText(me, "SignalIndex", e.signalIndex);
    setNumberText(me, "SignalSpecIndex", e.signalSpecIndex);
  }

  const m = patch.modbus;
  if (m) {
    setNumberText(mbs, "Address", m.address);
    setNumberText(mbs, "Bit", m.bit);
    setNumberText(mbs, "LenBits", m.lenBits);
    setNumberText(mbs, "Format", m.format);
    setNumberText(mbs, "ReadWrite", m.readWrite);
    setNumberText(mbs, "StringLength", m.stringLength);
    setNumberText(mbs, "SlaveIndex", m.slaveIndex);
  }
}

// --- XML builders (desktop-tool default shapes) ------------------------------

function buildMbsSignal(id: number): XmlElement {
  return element("Signal", [["ID", String(id)]], [
    element("isEnabled", [], [text("True")]),
    element("idxConfig", [], [text(String(id))]),
    element("idxExternal", [], [text(String(id))]),
    pairElement("IdxOperations"),
    pairElement("IdxFilters"),
    element("Description", [], [text("")]),
    element("LenBits", [], [text("16")]),
    element("Format", [], [text("0")]),
    element("Bit", [], [text("255")]),
    element("Address", [], [text("0")]),
    element("ReadWrite", [], [text("2")]),
    element("StringLength", [], [text("-1")]),
    element("SlaveIndex", [], [text("-1")]),
    element("GatewayIndex", [], [text("-1")]),
    element("Virtual", [
      ["Status", "False"],
      ["Fixed", "False"],
      ["General", "False"],
    ]),
    element("ProtocolIndex", [], [text("-1")]),
  ]);
}

function buildMeSignal(id: number): XmlElement {
  return element("Signal", [["ID", String(id)]], [
    element("idxConfig", [], [text(String(id))]),
    element("idxExternal", [], [text(String(id))]),
    pairElement("IdxOperations"),
    pairElement("IdxFilters"),
    element("UnitId", [], [text("-1")]),
    element("IsIndoorSignal", [], [text("False")]),
    element("GroupIndex", [], [text("-1")]),
    element("G50Index", [], [text("0")]),
    element("Virtual", [
      ["Status", "False"],
      ["Fixed", "False"],
    ]),
    element("IsStatus", [], [text("False")]),
    element("SignalIndex", [], [text("-1")]),
    element("SignalSpecIndex", [], [text("-1")]),
  ]);
}

// --- internal helpers ----------------------------------------------------------

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

function setNumberText(parent: XmlElement, tag: string, value: number | undefined): void {
  if (value !== undefined) setText(childEl(parent, tag), String(value));
}

function controllerAt(doc: XmlDocument, controllerIndex: number): XmlElement {
  const el = doc.findAll(["ExternalProtocol", "G50List", "G50Controller"])[controllerIndex];
  if (!el) throw new Error(`G50 controller ${controllerIndex} not found`);
  return el;
}

function groupAt(doc: XmlDocument, controllerIndex: number, groupIndex: number): XmlElement {
  const controller = controllerAt(doc, controllerIndex);
  const groupList = childEl(controller, "GroupList");
  const el = groupList.children.find(
    (c): c is XmlElement =>
      c.kind === "element" && c.tag === "Group" && getAttr(c, "Index") === String(groupIndex),
  );
  if (!el) throw new Error(`Group ${groupIndex} of controller ${controllerIndex} not found`);
  return el;
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
