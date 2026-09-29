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
import type { MeControllerInfo, MeGroupInfo } from "@/protocols/me";
import type { MbsConfig } from "@/protocols/modbus/slave";
import {
  buildMbsSignal,
  patchMbsConfig,
  patchMbsEndpoint,
  patchMbsRtuConfig,
  patchMbsTcpConfig,
  type MbsConfigPatch,
} from "@/protocols/modbus/slave/xml";
import type { GatewayInfo, MeMbsSignal } from "./model";

/**
 * Patch operations on the preserved .ibmaps XmlDocument. Every edit keeps
 * unknown content, node order and formatting intact. Both protocol sides are
 * row-aligned (internal Signal ID == external Signal ID), so signal
 * operations touch both.
 */

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

export function updateMbsConfig(doc: XmlDocument, patch: MbsConfigPatch): void {
  patchMbsConfig(mustFind(doc, ["InternalProtocol"]), patch);
}

export function updateRtuConfig(doc: XmlDocument, patch: Partial<MbsConfig["rtu"]>): void {
  patchMbsRtuConfig(mustFind(doc, ["InternalProtocol"]), patch);
}

export function updateTcpConfig(doc: XmlDocument, patch: Partial<MbsConfig["tcp"]>): void {
  patchMbsTcpConfig(mustFind(doc, ["InternalProtocol"]), patch);
}

// --- ME config (controllers / groups) ------------------------------------------

export function updateMeScalars(
  doc: XmlDocument,
  patch: Partial<
    Pick<
      import("@/protocols/me").MeConfig,
      "pollPeriod" | "ansTimeout" | "controllerTout" | "writeMaxBurst" | "temperatureMode" | "consumptionEnabled"
    >
  >,
): void {
  const external = mustFind(doc, ["ExternalProtocol"]);
  if (patch.pollPeriod !== undefined) setText(childEl(external, "PollPeriod"), String(patch.pollPeriod));
  if (patch.ansTimeout !== undefined) setText(childEl(external, "AnsTimeout"), String(patch.ansTimeout));
  if (patch.controllerTout !== undefined) setText(childEl(external, "ControllerTout"), String(patch.controllerTout));
  if (patch.writeMaxBurst !== undefined) setText(childEl(external, "WriteMaxBurst"), String(patch.writeMaxBurst));
  if (patch.temperatureMode !== undefined) {
    setText(childEl(external, "TemperatureMode"), String(patch.temperatureMode));
  }
  if (patch.consumptionEnabled !== undefined) {
    const consumption = external.children.find(
      (c): c is XmlElement => c.kind === "element" && c.tag === "ConsumptionFunction",
    );
    if (consumption) setAttr(consumption, "Enabled", boolText(patch.consumptionEnabled));
  }
}

export function updateController(
  doc: XmlDocument,
  controllerIndex: number,
  patch: Partial<Pick<MeControllerInfo, "description" | "enabled" | "ip" | "port" | "type" | "model" | "compatibility" | "addErrorSignals">>,
): void {
  const el = controllerAt(doc, controllerIndex);
  if (patch.description !== undefined) setText(childEl(el, "Description"), patch.description);
  if (patch.enabled !== undefined) setText(childEl(el, "Enabled"), boolText(patch.enabled));
  if (patch.ip !== undefined) setText(childEl(el, "IP"), patch.ip);
  if (patch.port !== undefined) setText(childEl(el, "Port"), String(patch.port));
  if (patch.type !== undefined) setText(childEl(el, "Type"), String(patch.type));
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
  appendChildIndented(internalSignals, buildMbsSignal(id, { enabled: true }), 3);
  appendChildIndented(externalSignals, buildMeSignal(id), 3);
  return id;
}

/**
 * MAPS `DeleteObject` with `isLastObject` (IntesisProjectMbsMe_RT +
 * ExternalME.ReorderIdxConfigs), run after deleting signals: the i-th signal
 * of each side gets ID = idxConfig = idxExternal = i. Both sides are
 * renumbered by position because MAPS and the XBL generator pair them by
 * position. Run it once after a batch of removals, so every ID in the batch
 * keeps referring to the signal it named before the batch.
 */
export function reorderSignalIds(doc: XmlDocument): void {
  for (const side of ["InternalProtocol", "ExternalProtocol"] as const) {
    doc.findAll([side, "Signals", "Signal"]).forEach((el, i) => {
      setAttr(el, "ID", String(i));
      for (const tag of ["idxConfig", "idxExternal"]) {
        const child = el.children.find((c): c is XmlElement => c.kind === "element" && c.tag === tag);
        if (child && getText(child) !== String(i)) setText(child, String(i));
      }
    });
  }
}

/** Remove a signal from both protocol sides. IDs are renumbered per batch (`reorderSignalIds`). */
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

  if (patch.modbus) patchMbsEndpoint(mbs, patch.modbus);
}

// --- XML builders (desktop-tool default shapes) ------------------------------

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
