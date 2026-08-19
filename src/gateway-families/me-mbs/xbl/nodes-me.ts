/**
 * XBL writer for the ME external node (top-level tag 8).
 *
 * Provenance: `ExternalME.CreateExternalXBLNode` / `CreateG50sNode` /
 * `CreateGroupsNode` / `CreateExternalIDsNode` / `CreateConversionsNode` /
 * `CreateIUOUUnitNode` (temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/
 * IntesisBoxMAPS.Protocols.ME/ExternalME.cs:158-484) and
 * `IntesisMe.GetSignalNodeNumber` (IntesisMe.cs:132-141).
 *
 * Byte-exact against the real 770 Air fixture
 * (.local-data/fixtures/770air-me-mbs-2026-08-18.bin) — see
 * docs/knx-mbm-mvp.md, Pas 2.4.
 */

import {
  array,
  container,
  externalIdBytes,
  ipv4Bytes,
  node,
  nullTerminatedUtf8,
  shrunkU16be,
  u16be,
  type XblElementSpec,
} from "@/core/xbl";
import type {
  EnabledMeController,
  EnabledMeSignal,
  MeGroupParsed,
  MeMbsXblPipelineResult,
} from "./pipeline";

/** METemperatureMode.FAHRENHEIT = 1 (METemperatureMode.cs). */
const TEMP_FAHRENHEIT = 1;
/** MEGroupType.SYS_COMPONENT = 6 (MEGroupType.cs). */
const GROUP_TYPE_SYS_COMPONENT = 6;
/** ControllerModel.AE_C400E = 3 (ControllerModel.cs). */
const MODEL_AE_C400E = 3;
/** IntesisMe.SIGNAL_ERRORSIGN trigger node numbers are signalIndex + 1. */
function signalNodeNumber(signalIndex: number): number {
  return signalIndex + 1;
}

/** Signals of one group: IsStatus only, ordered by SignalIndex (stable, like LINQ OrderBy). */
function groupStatusSignals(
  enabledMe: EnabledMeSignal[],
  g50Index: number,
  groupIdx: number,
): EnabledMeSignal[] {
  return enabledMe
    .filter((x) => x.groupId === groupIdx && x.g50Id === g50Index && x.isStatus)
    .sort((a, b) => a.signalIndex - b.signalIndex);
}

/** Dedup by XBL tag: the first occurrence wins (C# scans node.Items). */
function pushDedup(items: XblElementSpec[], tag: number, content: Uint8Array): void {
  if (items.some((el) => el.kind === "node" && el.tag === tag)) return;
  items.push(node(tag, content));
}

/**
 * Port of ExternalME.CreateExternalIDsNode(controllerIdx, groupIdx, list)
 * (ExternalME.cs:406-446): container tag 6 with one node per distinct signal
 * node number (content = external-id bytes). Empty → fallback node tag 1 with
 * external id 65535.
 */
function buildGroupExternalIdsNode(signals: EnabledMeSignal[]): XblElementSpec {
  const items: XblElementSpec[] = [];
  for (const s of signals) {
    pushDedup(items, signalNodeNumber(s.signalIndex), externalIdBytes(s.externalId, false));
  }
  if (items.length === 0) {
    items.push(node(signalNodeNumber(0), externalIdBytes(65535, false)));
  }
  return container(6, items);
}

/**
 * Port of ExternalME.CreateConversionsNode(controllerIdx, groupIdx, list)
 * (ExternalME.cs:448-488): container tag 7 with one node per distinct signal
 * node number whose ConversionID ≠ 255. Empty → fallback node tag 1 = 255.
 */
function buildGroupConversionsNode(signals: EnabledMeSignal[]): XblElementSpec {
  const items: XblElementSpec[] = [];
  for (const s of signals) {
    if (s.conversionId === 255) continue;
    pushDedup(items, signalNodeNumber(s.signalIndex), new Uint8Array([s.conversionId & 0xff]));
  }
  if (items.length === 0) {
    items.push(node(signalNodeNumber(0), new Uint8Array([255])));
  }
  return container(7, items);
}

/**
 * Ports of the nullable (no-fallback) ExternalME.CreateExternalIDsNode /
 * CreateConversionsNode overloads used by the IUOU unit items
 * (ExternalME.cs:296-378). UNVERIFIED: only reachable with
 * AddErrorSignals=True; no sample project exercises them.
 */
function buildUnitExternalIdsNode(signals: EnabledMeSignal[]): XblElementSpec | null {
  const items: XblElementSpec[] = [];
  for (const s of signals) {
    pushDedup(items, signalNodeNumber(s.signalIndex), externalIdBytes(s.externalId, false));
  }
  return items.length === 0 ? null : container(2, items);
}

function buildUnitConversionsNode(signals: EnabledMeSignal[]): XblElementSpec | null {
  const items: XblElementSpec[] = [];
  for (const s of signals) {
    if (s.conversionId === 255) continue;
    pushDedup(items, signalNodeNumber(s.signalIndex), new Uint8Array([s.conversionId & 0xff]));
  }
  return items.length === 0 ? null : container(3, items);
}

/**
 * Port of ExternalME.CreateIUOUUnitNode (ExternalME.cs:267-294). UNVERIFIED:
 * two C# quirks are ported verbatim — the unit number tag uses
 * `list[num].UnitID + 1` (the running item index into the filtered list, not
 * the matched signal's unit), and the conversions container is built from the
 * WHOLE controller's unit-signal list, not the per-unit subset.
 */
function buildIuouUnitNode(
  controller: EnabledMeController,
  enabledMe: EnabledMeSignal[],
  isIndoor: boolean,
  tag: number,
): XblElementSpec | null {
  if (!controller.addErrorSignals) return null;
  const list = enabledMe.filter(
    (x) => x.g50Id === controller.index && x.isIndoorSignal === isIndoor && x.unitId !== -1,
  );
  if (list.length === 0) return null;
  const offset = isIndoor ? 0 : 50;
  const items: XblElementSpec[][] = [];
  for (let i = 0; i < 50; i++) {
    const unitSignals = list.filter((x) => x.unitId === i + offset);
    if (unitSignals.length === 0) continue;
    const num = items.length;
    const item: XblElementSpec[] = [
      node(1, new Uint8Array([(list[num].unitId + 1) & 0xff])),
    ];
    const ids = buildUnitExternalIdsNode(unitSignals);
    if (ids) item.push(ids);
    const conversions = buildUnitConversionsNode(list);
    if (conversions) item.push(conversions);
    items.push(item);
  }
  return container(tag, [array(items)]);
}

/** Port of ExternalME.CreateGroupsNode (ExternalME.cs:380-404). */
function buildGroupsNode(
  controller: EnabledMeController,
  enabledMe: EnabledMeSignal[],
): XblElementSpec {
  const groups = controller.groups.filter((g) => g.enabled && g.type !== GROUP_TYPE_SYS_COMPONENT);
  const items = groups.map((group): XblElementSpec[] => {
    const signals = groupStatusSignals(enabledMe, controller.index, group.idx);
    return [
      node(1, new Uint8Array([(group.idx + 1) & 0xff])),
      node(2, new Uint8Array([group.type & 0xff])),
      node(3, new Uint8Array([group.fanSpeed & 0xff])),
      node(4, new Uint8Array([group.dualSetPoint ? 1 : 0])),
      node(5, new Uint8Array([group.urc ? 1 : 0])),
      buildGroupExternalIdsNode(signals),
      buildGroupConversionsNode(signals),
      // Group tag 8 (MeterIndex) is only emitted with the consumption
      // function enabled — the pipeline refuses those projects.
    ];
  });
  return container(8, [array(items)]);
}

/** Port of one array item of ExternalME.CreateG50sNode (ExternalME.cs:196-261). */
function buildG50Item(
  controller: EnabledMeController,
  enabledMe: EnabledMeSignal[],
): XblElementSpec[] {
  const out: XblElementSpec[] = [
    node(1, ipv4Bytes(controller.ip)),
    node(2, u16be(controller.port)),
    node(3, new Uint8Array([controller.typeIndex & 0xff])),
    node(4, new Uint8Array([controller.model & 0xff])),
    // C# emits !Compatibility (CompatibilityMode.NEW_MODEL = 0 → 1).
    node(5, new Uint8Array([controller.compatibility === 0 ? 1 : 0])),
    node(6, shrunkU16be(controller.indexCommErr & 0xffff)),
    node(7, new Uint8Array([controller.setPoint05Support & 0xff])),
    buildGroupsNode(controller, enabledMe),
  ];
  const indoor = buildIuouUnitNode(controller, enabledMe, true, 9);
  if (indoor) out.push(indoor);
  const outdoor = buildIuouUnitNode(controller, enabledMe, false, 10);
  if (outdoor) out.push(outdoor);
  if (controller.model === MODEL_AE_C400E) {
    // UNVERIFIED: no AE-C400E sample; ported verbatim from ExternalME.cs:249-260.
    out.push(node(11, nullTerminatedUtf8(controller.authUserId, 254, 255)));
    out.push(node(12, nullTerminatedUtf8(controller.authPassword, 254, 255)));
    out.push(node(13, u16be(controller.certDownloadPort)));
    out.push(node(14, new Uint8Array([controller.persistentConnection ? 1 : 0])));
  }
  return out;
}

/** Port of ExternalME.CreateExternalXBLNode (ExternalME.cs:158-192). */
export function buildMeNode(me: MeMbsXblPipelineResult["me"]): XblElementSpec {
  // CreateG50sNode: controllers with at least one enabled group (of any
  // type — the controller filter does NOT exclude SYS_COMPONENT, unlike the
  // groups array). The controller's own Enabled flag is ignored
  // (ExternalME.cs:196) — the fixture has controller 0 Enabled=False with 6
  // enabled groups and still emits it.
  const controllers = me.controllers.filter((c) => c.groups.some((g) => g.enabled));
  const children: XblElementSpec[] = [
    node(1, u16be(me.pollPeriod)),
    node(2, new Uint8Array([me.ansTimeout & 0xff])),
    node(3, new Uint8Array([me.controllerTout & 0xff])),
    node(4, new Uint8Array([me.readCyclesPerAlarm & 0xff])),
    node(5, new Uint8Array([me.writeMaxBurst & 0xff])),
    container(6, [array(controllers.map((c) => buildG50Item(c, me.signals)))]),
  ];
  if (me.temperatureMode === TEMP_FAHRENHEIT) {
    children.push(node(7, new Uint8Array([1])));
  }
  return container(8, children);
}
