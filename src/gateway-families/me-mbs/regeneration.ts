import type { XmlDocument } from "@/core/project-format";
import {
  COMPATIBILITY_MODES,
  CONTROLLER_MODELS,
  GROUP_TYPES,
  type MeControllerInfo,
  type MeGroupInfo,
} from "@/protocols/me";
import { ADDRESS_MODES } from "@/protocols/modbus/slave";
import { readMbsConfig, readMeConfig } from "./from-xml";
import { MeMbsSignalEngine } from "./signals-engine";
import { updateController, updateGroup, updateMbsConfig, updateMeScalars } from "./xml-ops";

/**
 * Model patches wired to the MAPS handler the desktop form calls for the same
 * edit (docs/reference/me-mbs-regeneracio-senyals.md §4; `F` =
 * IntesisBoxMAPS.Protocols.ME/frmExternalMe.cs, `P` =
 * IntesisBoxMAPS.Projects/IntesisProjectMbsMe_RT.cs). Each function applies
 * the attribute patch, the form rules MAPS applies with it, and then the
 * signal regeneration — only when the value actually changed, like the
 * form's equality checks (`CheckGroupEqual`, `CheckControllerEqual`).
 */

type GroupPatch = Parameters<typeof updateGroup>[3];
type ControllerPatch = Parameters<typeof updateController>[2];
type MeScalarsPatch = Parameters<typeof updateMeScalars>[1];
type MbsConfigPatch = Parameters<typeof updateMbsConfig>[1];

/** Group fields whose change runs `ModifyGroupUpdate` (F:527-591). Capacity does not. */
const GROUP_SIGNAL_FIELDS = ["description", "type", "fanSpeeds", "dualSetPoint", "urc"] as const;
/** Controller fields whose change runs `ModifyController` (F:778, F:879). */
const CONTROLLER_SIGNAL_FIELDS = ["model", "compatibility", "addErrorSignals"] as const;

/** Load the signal lists, run one MAPS handler and write them back. */
export function regenerateSignals(doc: XmlDocument, handler: (engine: MeMbsSignalEngine) => void): void {
  const engine = MeMbsSignalEngine.fromXml(doc);
  handler(engine);
  engine.writeTo(doc);
}

/** `updateGroup` → `EnableGroup` (tree check, F:358) or `ModifyGroupUpdate`. */
export function updateGroupAndSignals(
  doc: XmlDocument,
  controllerIndex: number,
  groupIndex: number,
  patch: GroupPatch,
): void {
  const before = groupOf(doc, controllerIndex, groupIndex);
  const effective = { ...patch };
  // cb_groupType_SelectedIndexChanged (F:822): BU, WH and CEH force the fan
  // speeds to 0 (and disable the selector), saved together with the type.
  if (patch.type === GROUP_TYPES.BU || patch.type === GROUP_TYPES.WH || patch.type === GROUP_TYPES.CEH) {
    effective.fanSpeeds = 0;
  }
  updateGroup(doc, controllerIndex, groupIndex, effective);
  const after = groupOf(doc, controllerIndex, groupIndex);
  if (before.enabled !== after.enabled) {
    regenerateSignals(doc, (e) => e.enableGroup(controllerIndex, groupIndex));
  } else if (GROUP_SIGNAL_FIELDS.some((key) => before[key] !== after[key])) {
    regenerateSignals(doc, (e) => e.modifyGroupUpdate(controllerIndex, groupIndex));
  }
}

/**
 * `updateController` → `ModifyController` for model, compatibility and
 * "Individual error signals"; description, IP, port and type go through
 * `ModifyControllerNoUpdate` (no signal change). MAPS has no handler for the
 * controller `Enabled` flag: its signals follow the groups only.
 */
export function updateControllerAndSignals(
  doc: XmlDocument,
  controllerIndex: number,
  patch: ControllerPatch,
): void {
  const before = controllerOf(doc, controllerIndex);
  const effective = { ...patch };
  // cb_g50Model_SelectedIndexChanged (F:807): AG-150 forces the old
  // compatibility (selector disabled); any other model resets it to the new
  // one, which the user may change afterwards.
  if (patch.model !== undefined && patch.model !== before.model) {
    effective.compatibility =
      patch.model === CONTROLLER_MODELS.AG_150
        ? COMPATIBILITY_MODES.OLD_MODEL
        : (patch.compatibility ?? COMPATIBILITY_MODES.NEW_MODEL);
  }
  updateController(doc, controllerIndex, effective);
  let after = controllerOf(doc, controllerIndex);
  if (after.model !== before.model || after.compatibility !== before.compatibility) {
    clearUnsupportedGroupOptions(doc, controllerIndex, after);
    after = controllerOf(doc, controllerIndex);
  }
  if (CONTROLLER_SIGNAL_FIELDS.some((key) => before[key] !== after[key])) {
    regenerateSignals(doc, (e) => e.modifyController(controllerIndex));
  }
}

/**
 * `updateMeScalars` → `UpdateTemperatureMode` (F:929) or
 * `UpdateConsumptionFunction` (F:891 → P:1213). Both end in the same full
 * regeneration with `RestoreUserConfig`; polling and timeouts do not touch
 * the signals.
 */
export function updateMeScalarsAndSignals(doc: XmlDocument, patch: MeScalarsPatch): void {
  const before = readMeConfig(doc);
  updateMeScalars(doc, patch);
  const after = readMeConfig(doc);
  if (before.temperatureMode !== after.temperatureMode || before.consumptionEnabled !== after.consumptionEnabled) {
    regenerateSignals(doc, (e) => e.initializeAndRestore());
  }
}

/**
 * `updateMbsConfig` → `AddressModeChanged` (P:1034), which also resets the
 * register base (base 1 for V4, 0 otherwise; an explicit value in the same
 * patch wins), and the slave mode radio buttons (F: frmInternalMBS.cs:452-471
 * → P:1058).
 */
export function updateMbsConfigAndSignals(doc: XmlDocument, patch: MbsConfigPatch): void {
  const before = readMbsConfig(doc);
  const addressModeChanged = patch.addressMode !== undefined && patch.addressMode !== before.addressMode;
  const effective = { ...patch };
  if (addressModeChanged && patch.registerBase === undefined) {
    effective.registerBase = patch.addressMode === ADDRESS_MODES.V4_COMP ? 1 : 0;
  }
  updateMbsConfig(doc, effective);
  const after = readMbsConfig(doc);
  if (addressModeChanged) regenerateSignals(doc, (e) => e.addressModeChanged());
  if (after.slaveAddressMode !== before.slaveAddressMode) {
    regenerateSignals(doc, (e) => e.slaveAddressModeChanged());
  }
}

/**
 * `SaveThisController` (F:656): an AG-150 controller has no URC nor dual
 * setpoint groups, and the old compatibility has no dual setpoint.
 */
function clearUnsupportedGroupOptions(
  doc: XmlDocument,
  controllerIndex: number,
  controller: MeControllerInfo,
): void {
  const ag150 = controller.model === CONTROLLER_MODELS.AG_150;
  const oldModel = controller.compatibility === COMPATIBILITY_MODES.OLD_MODEL;
  for (const group of controller.groups) {
    const patch: GroupPatch = {};
    if (ag150 && group.urc) patch.urc = false;
    if ((ag150 || oldModel) && group.dualSetPoint) patch.dualSetPoint = false;
    if (Object.keys(patch).length > 0) updateGroup(doc, controllerIndex, group.index, patch);
  }
}

function controllerOf(doc: XmlDocument, controllerIndex: number): MeControllerInfo {
  const controller = readMeConfig(doc).controllers[controllerIndex];
  if (!controller) throw new Error(`G50 controller ${controllerIndex} not found`);
  return controller;
}

function groupOf(doc: XmlDocument, controllerIndex: number, groupIndex: number): MeGroupInfo {
  const group = controllerOf(doc, controllerIndex).groups.find((g) => g.index === groupIndex);
  if (!group) throw new Error(`Group ${groupIndex} of controller ${controllerIndex} not found`);
  return group;
}
