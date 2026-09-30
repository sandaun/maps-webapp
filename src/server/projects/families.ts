import "server-only";
import type { ApplyDeviceTemplate } from "@/core/device-templates/types";
import { applyDeviceTemplate } from "@/server/device-templates/apply";
import { getPreviewTemplate } from "@/server/device-templates/cache";
import type { XmlDocument } from "@/core/project-format";
import type { ConversionSelection, SignalConversionRefs } from "@/core/signals/conversion-refs";
import type { ValidationIssue } from "@/core/validation/issue";
import {
  addDevice as knxAddDevice,
  addRtuNode as knxAddRtuNode,
  addSignal as knxAddSignal,
  addTcpNode as knxAddTcpNode,
  isKnxMbmProject,
  moveSignal as knxMoveSignal,
  projectFromXml as knxMbmProjectFromXml,
  removeDevice as knxRemoveDevice,
  removeNode as knxRemoveNode,
  removeSignal as knxRemoveSignal,
  reorderSignalIds as knxReorderSignalIds,
  setGatewayInfo as knxSetGatewayInfo,
  setGeneralInfo as knxSetGeneralInfo,
  setKnxExtendedAddresses,
  setKnxPhysicalAddress,
  updateDevice as knxUpdateDevice,
  updateMbmConfig,
  updateRtuNode as knxUpdateRtuNode,
  updateSignal as knxUpdateSignal,
  updateTcpNode as knxUpdateTcpNode,
  validateProject as validateKnxMbmProject,
  knxSelectionRefs,
  knxRestoredRefs,
  addConversion as knxAddConversion,
  updateConversion as knxUpdateConversion,
  removeConversion as knxRemoveConversion,
  ConversionEditError,
  type ConversionLocator,
  type ConversionPatch,
  type KnxMbmProject,
  type RemovedDeviceSignals,
  type NodeLocator,
  type SignalPatch as KnxMbmSignalPatch,
} from "@/gateway-families/knx-mbm";
import {
  isMeMbsProject,
  projectFromXml as meMbsProjectFromXml,
  setGatewayInfo as meSetGatewayInfo,
  setGeneralInfo as meSetGeneralInfo,
  UnsupportedRegenerationError,
  updateControllerAndSignals,
  updateGroupAndSignals,
  updateMbsConfigAndSignals,
  updateMeScalarsAndSignals,
  updateRtuConfigAndSlaves,
  updateSignalAndUserAddress,
  updateTcpConfig,
  validateProject as validateMeMbsProject,
  type MeMbsProject,
  type SignalPatch as MeMbsSignalPatch,
} from "@/gateway-families/me-mbs";
import {
  addConversion as mbsKnxAddConversion,
  addSignal as mbsKnxAddSignal,
  ConversionEditError as MbsKnxConversionEditError,
  isMbsKnxProject,
  mbsKnxRestoredRefs,
  mbsKnxSelectionRefs,
  moveSignal as mbsKnxMoveSignal,
  projectFromXml as mbsKnxProjectFromXml,
  removeConversion as mbsKnxRemoveConversion,
  removeSignal as mbsKnxRemoveSignal,
  reorderSignalIds as mbsKnxReorderSignalIds,
  setGatewayInfo as mbsKnxSetGatewayInfo,
  setGeneralInfo as mbsKnxSetGeneralInfo,
  setKnxExtendedAddresses as mbsKnxSetKnxExtendedAddresses,
  setKnxPhysicalAddress as mbsKnxSetKnxPhysicalAddress,
  SignalEditError as MbsKnxSignalEditError,
  updateConversion as mbsKnxUpdateConversion,
  updateMbsConfig as mbsKnxUpdateMbsConfig,
  updateRtuConfig as mbsKnxUpdateRtuConfig,
  updateSignal as mbsKnxUpdateSignal,
  updateTcpConfig as mbsKnxUpdateTcpConfig,
  validateProject as validateMbsKnxProject,
  type MbsKnxConfigPatch,
  type MbsKnxProject,
  type SignalPatch as MbsKnxSignalPatch,
} from "@/gateway-families/mbs-knx";
import type { MeControllerInfo, MeGroupInfo } from "@/protocols/me";
import { SLAVE_ID_RANGE, type MbsConfig } from "@/protocols/modbus/slave";
import {
  MAX_RTU_NODES,
  MAX_TCP_NODES,
  type MbmDevice,
  type MbmRtuNode,
  type MbmTcpNode,
} from "@/protocols/modbus/master";
import { ProjectServiceError } from "./errors";
import { setProjectPassword } from "./password";

/**
 * Gateway-family registry: the single place where the project service learns
 * which .ibmaps families exist and how to detect, model, validate and patch
 * each one. Families themselves stay UI/transport-agnostic under
 * `src/gateway-families/<id>/`.
 */

export type FamilyId = "knx-mbm" | "me-mbs" | "mbs-knx";

// --- patch types --------------------------------------------------------------

/** Editable node/device fields (topology itself changes via add/remove ops). */
export type RtuNodePatch = Partial<Omit<MbmRtuNode, "devices">>;
export type TcpNodePatch = Partial<Omit<MbmTcpNode, "devices">>;
export type DevicePatch = Partial<Omit<MbmDevice, "index">>;

type MbsConfigPatch = Partial<
  Pick<
    MbsConfig,
    "media" | "byteOrder" | "updateCOV" | "addressMode" | "slaveAddressMode" | "commErrorTout" | "registerBase"
  >
>;
type MeScalarsPatch = Partial<
  Pick<
    MeMbsProject["me"],
    "pollPeriod" | "ansTimeout" | "controllerTout" | "writeMaxBurst" | "temperatureMode" | "consumptionEnabled"
  >
>;
type MeControllerPatch = Partial<
  Pick<MeControllerInfo, "description" | "enabled" | "ip" | "port" | "type" | "model" | "compatibility" | "addErrorSignals">
>;
type MeGroupPatch = Partial<
  Pick<MeGroupInfo, "enabled" | "description" | "type" | "fanSpeeds" | "dualSetPoint" | "urc" | "capacity">
>;

/** Patch ops a KNX ↔ Modbus Master project accepts. */
export type KnxMbmPatch =
  | ApplyDeviceTemplate
  | { type: "undoDeviceTemplate"; token: string }
  | ProjectPasswordPatch
  | SignalMovePatch
  | { type: "setGeneralInfo"; name?: string; description?: string }
  | { type: "setGatewayInfo"; name?: string; ip?: string; netmask?: string; gateway?: string; dhcp?: boolean }
  | { type: "setKnxPhysicalAddress"; address: number }
  | { type: "setKnxExtendedAddresses"; enabled: boolean }
  | {
      type: "updateMbmConfig";
      patch: {
        media?: number;
        deadband?: number;
        pollRecords?: { enabled?: boolean; useMissingReg?: boolean; maxRegisters?: number };
      };
    }
  | { type: "addSignal" }
  | { type: "removeSignal"; id: number }
  | { type: "updateSignal"; id: number; patch: KnxMbmSignalPatchInput }
  | { type: "addRtuNode" }
  | { type: "addTcpNode" }
  | { type: "removeNode"; locator: NodeLocator }
  | { type: "updateRtuNode"; nodeIndex: number; patch: RtuNodePatch }
  | { type: "updateTcpNode"; nodeIndex: number; patch: TcpNodePatch }
  | { type: "addDevice"; locator: NodeLocator }
  | { type: "updateDevice"; locator: NodeLocator; deviceIndex: number; patch: DevicePatch }
  | { type: "removeDevice"; locator: NodeLocator; deviceIndex: number; signals: RemovedDeviceSignals }
  | ConversionLibraryPatch;

/**
 * Conversion library edits (Configuration → Conversions). `values` makes the
 * new entry a copy (Duplicate); without it the entry gets the MAPS defaults.
 */
type ConversionLibraryPatch =
  | {
      type: "addConversion";
      conversionType: 0 | 1 | 2;
      values?: { description: string; params: [number, number, number, number] };
    }
  | ({ type: "updateConversion"; patch: ConversionPatch } & ConversionLocator)
  | ({ type: "removeConversion" } & ConversionLocator)
  /** Undo of an assignment: both halves back to the refs they had, even if MAPS would not write them. */
  | { type: "restoreSignalConversions"; id: number; refs: SignalConversionRefs };

const CONVERSION_LIBRARY_TYPES = new Set([
  "addConversion",
  "updateConversion",
  "removeConversion",
  "restoreSignalConversions",
]);

/** `updateSignal` payload of the API: conversions come as a selection, never as raw refs. */
type KnxMbmSignalPatchInput = Omit<KnxMbmSignalPatch, "conversionRefs"> & { conversions?: ConversionSelection };

/** Patch ops a Mitsubishi Electric AC ↔ Modbus Slave project accepts. */
export type MeMbsPatch =
  | ProjectPasswordPatch
  | { type: "setGeneralInfo"; name?: string; description?: string }
  | { type: "setGatewayInfo"; name?: string; ip?: string; netmask?: string; gateway?: string; dhcp?: boolean }
  | { type: "addSignal" }
  | { type: "removeSignal"; id: number }
  | { type: "updateSignal"; id: number; patch: MeMbsSignalPatch }
  | { type: "updateMbsConfig"; patch: MbsConfigPatch }
  | { type: "updateRtuConfig"; patch: Partial<MbsConfig["rtu"]> }
  | { type: "updateTcpConfig"; patch: Partial<MbsConfig["tcp"]> }
  | { type: "updateMeScalars"; patch: MeScalarsPatch }
  | { type: "updateController"; controllerIndex: number; patch: MeControllerPatch }
  | { type: "updateGroup"; controllerIndex: number; groupIndex: number; patch: MeGroupPatch }
  | ConversionLibraryPatch;

/** `updateSignal` payload of the API for MBS–KNX: conversions come as a selection. */
type MbsKnxSignalPatchInput = Omit<MbsKnxSignalPatch, "conversionRefs"> & { conversions?: ConversionSelection };

/** Patch ops a KNX ↔ Modbus Slave project accepts. */
export type MbsKnxPatch =
  | ProjectPasswordPatch
  | SignalMovePatch
  | { type: "setGeneralInfo"; name?: string; description?: string }
  | { type: "setGatewayInfo"; name?: string; ip?: string; netmask?: string; gateway?: string; dhcp?: boolean }
  | { type: "setKnxPhysicalAddress"; address: number }
  | { type: "setKnxExtendedAddresses"; enabled: boolean }
  | { type: "updateMbsConfig"; patch: MbsKnxConfigPatch }
  | { type: "updateRtuConfig"; patch: Partial<MbsConfig["rtu"]> }
  | { type: "updateTcpConfig"; patch: Partial<MbsConfig["tcp"]> }
  | { type: "addSignal" }
  | { type: "removeSignal"; id: number }
  | { type: "updateSignal"; id: number; patch: MbsKnxSignalPatchInput }
  | ConversionLibraryPatch;

/** Patch operations accepted by the API (validated with zod at the edge). */
type ProjectPasswordPatch = { type: "setProjectPassword"; password: string };
type SignalMovePatch = { type: "moveSignal"; id: number; count?: number; toIndex: number };
export type ProjectPatch = KnxMbmPatch | MeMbsPatch | MbsKnxPatch;

// --- registry -----------------------------------------------------------------

interface FamilyEntry {
  id: FamilyId;
  /** Human-readable family name for badges and error messages. */
  displayName: string;
  detect: (doc: XmlDocument) => boolean;
  fromXml: (doc: XmlDocument) => KnxMbmProject | MeMbsProject | MbsKnxProject;
  validate: (project: KnxMbmProject | MeMbsProject | MbsKnxProject) => ValidationIssue[];
  /** True when this family knows how to apply the patch (payload included). */
  accepts: (patch: ProjectPatch) => boolean;
  /** Applies a whole batch; every ID in the batch refers to the document before it. */
  applyPatches: (doc: XmlDocument, patches: ProjectPatch[]) => void;
}

const KNX_MBM_TYPES = new Set([
  "applyDeviceTemplate",
  "undoDeviceTemplate",
  "moveSignal",
  "setProjectPassword",
  "setGeneralInfo",
  "setGatewayInfo",
  "setKnxPhysicalAddress",
  "setKnxExtendedAddresses",
  "updateMbmConfig",
  "addSignal",
  "removeSignal",
  "updateSignal",
  "addRtuNode",
  "addTcpNode",
  "removeNode",
  "updateRtuNode",
  "updateTcpNode",
  "addDevice",
  "updateDevice",
  "removeDevice",
  ...CONVERSION_LIBRARY_TYPES,
]);

const ME_MBS_TYPES = new Set([
  "setProjectPassword",
  "setGeneralInfo",
  "setGatewayInfo",
  "addSignal",
  "removeSignal",
  "updateSignal",
  "updateMbsConfig",
  "updateRtuConfig",
  "updateTcpConfig",
  "updateMeScalars",
  "updateController",
  "updateGroup",
  // Accepted only to answer with the reason: MAPS has no conversions editor for this family.
  ...CONVERSION_LIBRARY_TYPES,
]);

const KNX_MBM: FamilyEntry = {
  id: "knx-mbm",
  displayName: "KNX ↔ Modbus Master",
  detect: isKnxMbmProject,
  fromXml: (doc) => knxMbmProjectFromXml(doc),
  validate: (project) => validateKnxMbmProject(project as KnxMbmProject),
  accepts: (patch) =>
    KNX_MBM_TYPES.has(patch.type) &&
    (patch.type !== "updateSignal" || !("me" in patch.patch)),
  applyPatches: (doc, patches) => applyKnxMbmPatches(doc, patches as KnxMbmPatch[]),
};

const ME_MBS: FamilyEntry = {
  id: "me-mbs",
  displayName: "Mitsubishi Electric AC ↔ Modbus Slave",
  detect: isMeMbsProject,
  fromXml: (doc) => meMbsProjectFromXml(doc),
  validate: (project) => validateMeMbsProject(project as MeMbsProject),
  accepts: (patch) =>
    ME_MBS_TYPES.has(patch.type) &&
    (patch.type !== "updateSignal" || !("knx" in patch.patch)),
  applyPatches: (doc, patches) => applyMeMbsPatches(doc, patches as MeMbsPatch[]),
};

const MBS_KNX_TYPES = new Set([
  "moveSignal",
  "setProjectPassword",
  "setGeneralInfo",
  "setGatewayInfo",
  "setKnxPhysicalAddress",
  "setKnxExtendedAddresses",
  "updateMbsConfig",
  "updateRtuConfig",
  "updateTcpConfig",
  "addSignal",
  "removeSignal",
  "updateSignal",
  ...CONVERSION_LIBRARY_TYPES,
]);

/**
 * Modbus Slave fields of an MBS–KNX row the MAPS grid lets the user edit:
 * no string format (`stringFormatAvailable = false`) and a single slave
 * (`SetSlaveAddressModeEnabled(false)`), so no `stringLength` / `slaveIndex`.
 */
const MBS_KNX_MODBUS_FIELDS = new Set(["address", "bit", "lenBits", "format", "readWrite"]);

const MBS_KNX: FamilyEntry = {
  id: "mbs-knx",
  displayName: "KNX ↔ Modbus Slave",
  detect: isMbsKnxProject,
  fromXml: (doc) => mbsKnxProjectFromXml(doc),
  validate: (project) => validateMbsKnxProject(project as MbsKnxProject),
  accepts: (patch) =>
    MBS_KNX_TYPES.has(patch.type) &&
    (patch.type !== "updateSignal" ||
      (!("me" in patch.patch) &&
        Object.keys((patch.patch as MbsKnxSignalPatchInput).modbus ?? {}).every((key) => MBS_KNX_MODBUS_FIELDS.has(key)))),
  applyPatches: (doc, patches) => applyMbsKnxPatches(doc, patches as MbsKnxPatch[]),
};

export const FAMILIES: readonly FamilyEntry[] = [KNX_MBM, ME_MBS, MBS_KNX];

/** Detect the family of an .ibmaps document, or undefined when unsupported. */
export function detectFamily(doc: XmlDocument): FamilyEntry | undefined {
  return FAMILIES.find((family) => family.detect(doc));
}

export function familyById(id: FamilyId): FamilyEntry {
  const family = FAMILIES.find((f) => f.id === id);
  if (!family) throw new Error(`Unknown gateway family: ${id}`);
  return family;
}

/** Text for 422 rejections: the families this build can open. */
export function supportedFamiliesText(): string {
  return FAMILIES.map((f) => f.displayName).join("; ");
}

// --- per-family patch dispatch ---------------------------------------------------

const SIGNAL_REMOVING = new Set<KnxMbmPatch["type"]>(["removeSignal", "removeDevice", "removeNode"]);

function assertSingleMove(patches: ProjectPatch[]): void {
  if (patches.length !== 1 && patches.some((patch) => patch.type === "moveSignal")) {
    throw new ProjectServiceError(422, "Move a signal in a separate request: moving renumbers the signal IDs.");
  }
}

function applySignalMove(
  doc: XmlDocument,
  patch: SignalMovePatch,
  move: (doc: XmlDocument, id: number, toIndex: number, count?: number) => void,
): void {
  try {
    move(doc, patch.id, patch.toIndex, patch.count);
  } catch (error) {
    throw new ProjectServiceError(422, error instanceof Error ? error.message : "Invalid signal move.");
  }
}

/**
 * Like MAPS, signal IDs are renumbered once after the deletions (DeleteObject
 * with `isLastObject`), so the original IDs of a multi-row delete stay valid.
 */
function applyKnxMbmPatches(doc: XmlDocument, patches: KnxMbmPatch[]): void {
  assertSingleMove(patches);
  const signalCount = () => doc.findAll(["InternalProtocol", "KNXObject"]).length;
  let deleted = false;
  for (const patch of patches) {
    const before = SIGNAL_REMOVING.has(patch.type) ? signalCount() : 0;
    applyKnxMbmPatch(doc, patch);
    if (SIGNAL_REMOVING.has(patch.type) && signalCount() < before) deleted = true;
  }
  if (deleted) knxReorderSignalIds(doc);
}

function applyKnxMbmPatch(doc: XmlDocument, patch: KnxMbmPatch): void {
  switch (patch.type) {
    case "applyDeviceTemplate":
      applyDeviceTemplate(doc, getPreviewTemplate(patch.token), patch);
      break;
    case "undoDeviceTemplate":
      // The project service restores the server-held XML snapshot before dispatch.
      break;
    case "moveSignal":
      applySignalMove(doc, patch, knxMoveSignal);
      break;
    case "setProjectPassword":
      setProjectPassword(doc, patch.password);
      break;
    case "setGeneralInfo":
      knxSetGeneralInfo(doc, patch);
      break;
    case "setGatewayInfo":
      knxSetGatewayInfo(doc, patch);
      break;
    case "setKnxPhysicalAddress":
      setKnxPhysicalAddress(doc, patch.address);
      break;
    case "setKnxExtendedAddresses":
      setKnxExtendedAddresses(doc, patch.enabled);
      break;
    case "updateMbmConfig":
      updateMbmConfig(doc, patch.patch);
      break;
    case "addSignal":
      knxAddSignal(doc);
      break;
    case "removeSignal":
      knxRemoveSignal(doc, patch.id);
      break;
    case "updateSignal": {
      const { conversions, ...rest } = patch.patch;
      let conversionRefs: KnxMbmSignalPatch["conversionRefs"];
      if (conversions) {
        const result = knxSelectionRefs(doc, patch.id, conversions, rest.knx?.flags);
        if ("error" in result) throw new ProjectServiceError(422, result.error);
        conversionRefs = result.refs;
      }
      knxUpdateSignal(doc, patch.id, { ...rest, ...(conversionRefs ? { conversionRefs } : {}) });
      break;
    }
    case "addRtuNode": {
      const count = doc.findAll(["ExternalProtocol", "RtuNodes", "RtuNode"]).length;
      if (count >= MAX_RTU_NODES) {
        throw new ProjectServiceError(409, `RTU node limit reached (${MAX_RTU_NODES}).`);
      }
      knxAddRtuNode(doc);
      break;
    }
    case "addTcpNode": {
      const count = doc.findAll(["ExternalProtocol", "TCPNodes", "TCPNode"]).length;
      if (count >= MAX_TCP_NODES) {
        throw new ProjectServiceError(409, `TCP node limit reached (${MAX_TCP_NODES}).`);
      }
      knxAddTcpNode(doc);
      break;
    }
    case "removeNode":
      knxRemoveNode(doc, patch.locator);
      break;
    case "updateRtuNode":
      knxUpdateRtuNode(doc, patch.nodeIndex, patch.patch);
      break;
    case "updateTcpNode":
      knxUpdateTcpNode(doc, patch.nodeIndex, patch.patch);
      break;
    case "addDevice":
      knxAddDevice(doc, patch.locator);
      break;
    case "updateDevice":
      knxUpdateDevice(doc, { ...patch.locator, deviceIndex: patch.deviceIndex }, patch.patch);
      break;
    case "removeDevice":
      knxRemoveDevice(doc, { ...patch.locator, deviceIndex: patch.deviceIndex }, patch.signals);
      break;
    case "restoreSignalConversions": {
      const result = knxRestoredRefs(doc, patch.id, patch.refs);
      if ("error" in result) throw new ProjectServiceError(422, result.error);
      knxUpdateSignal(doc, patch.id, { conversionRefs: result.refs });
      break;
    }
    case "addConversion":
    case "updateConversion":
    case "removeConversion":
      try {
        if (patch.type === "addConversion") knxAddConversion(doc, patch.conversionType, patch.values);
        else if (patch.type === "updateConversion") knxUpdateConversion(doc, patch, patch.patch);
        else knxRemoveConversion(doc, patch);
      } catch (error) {
        if (error instanceof ConversionEditError) throw new ProjectServiceError(error.status, error.message);
        throw error;
      }
      break;
  }
}

/**
 * ME-MBS signals derive from the model, as in MAPS (`IsRemovableRow` →
 * false): the API refuses to add or remove them.
 */
// MAPS disables conversions for this family (`IntesisProjectMbsMe_RT.ConversionsEnabled`).
const ME_FIXED_CONVERSIONS_MESSAGE =
  "Mitsubishi Electric AC ↔ Modbus Slave conversions are fixed by the gateway template: they cannot be edited.";

const ME_DERIVED_SLAVES_MESSAGE =
  "The Mitsubishi Electric AC ↔ Modbus Slave slave list is derived from the enabled groups, as in MAPS: " +
  "it cannot be edited. Enable or disable the groups, or change the slave id.";

const ME_DERIVED_SIGNALS_MESSAGE =
  "Mitsubishi Electric AC ↔ Modbus Slave signals are generated from the controllers and groups: " +
  "they cannot be added or removed. Enable or disable the groups instead.";

/**
 * The signal edits run first: their IDs refer to the document before the
 * batch, and the model patches can regenerate the signals (MAPS handlers,
 * `regeneration.ts`), which renumbers them. The model patches then run in
 * their batch order.
 */
function applyMeMbsPatches(doc: XmlDocument, patches: MeMbsPatch[]): void {
  if (patches.some((p) => p.type === "addSignal" || p.type === "removeSignal")) {
    throw new ProjectServiceError(409, ME_DERIVED_SIGNALS_MESSAGE);
  }
  if (patches.some((p) => CONVERSION_LIBRARY_TYPES.has(p.type))) {
    throw new ProjectServiceError(409, ME_FIXED_CONVERSIONS_MESSAGE);
  }
  for (const patch of patches.filter((p) => p.type === "updateSignal")) applyMeMbsPatch(doc, patch);
  try {
    for (const patch of patches.filter((p) => p.type !== "updateSignal")) applyMeMbsPatch(doc, patch);
  } catch (error) {
    if (error instanceof UnsupportedRegenerationError) throw new ProjectServiceError(422, error.message);
    throw error;
  }
}

function applyMeMbsPatch(doc: XmlDocument, patch: MeMbsPatch): void {
  switch (patch.type) {
    case "setProjectPassword":
      setProjectPassword(doc, patch.password);
      break;
    case "setGeneralInfo":
      meSetGeneralInfo(doc, patch);
      break;
    case "setGatewayInfo":
      meSetGatewayInfo(doc, patch);
      break;
    case "addSignal":
    case "removeSignal":
      throw new ProjectServiceError(409, ME_DERIVED_SIGNALS_MESSAGE);
    case "updateSignal":
      if ("conversions" in patch.patch) throw new ProjectServiceError(409, ME_FIXED_CONVERSIONS_MESSAGE);
      updateSignalAndUserAddress(doc, patch.id, patch.patch);
      break;
    case "updateMbsConfig":
      if ("slaves" in patch.patch) throw new ProjectServiceError(409, ME_DERIVED_SLAVES_MESSAGE);
      updateMbsConfigAndSignals(doc, patch.patch);
      break;
    case "updateRtuConfig": {
      // The API takes the MAPS form range (1–255, shared with MBS–KNX); ME–MBS
      // keeps its 1–247 slave ids (`SLAVE_ID_RANGE`).
      const slave = patch.patch.slaveNumber;
      if (slave !== undefined && (slave < SLAVE_ID_RANGE.min || slave > SLAVE_ID_RANGE.max)) {
        throw new ProjectServiceError(
          422,
          `Mitsubishi Electric AC ↔ Modbus Slave slave number must be ${SLAVE_ID_RANGE.min}–${SLAVE_ID_RANGE.max}.`,
        );
      }
      updateRtuConfigAndSlaves(doc, patch.patch);
      break;
    }
    case "updateTcpConfig":
      updateTcpConfig(doc, patch.patch);
      break;
    case "updateMeScalars":
      updateMeScalarsAndSignals(doc, patch.patch);
      break;
    case "updateController":
      updateControllerAndSignals(doc, patch.controllerIndex, patch.patch);
      break;
    case "updateGroup":
      updateGroupAndSignals(doc, patch.controllerIndex, patch.groupIndex, patch.patch);
      break;
    case "addConversion":
    case "updateConversion":
    case "removeConversion":
    case "restoreSignalConversions":
      throw new ProjectServiceError(409, ME_FIXED_CONVERSIONS_MESSAGE);
  }
}

// --- MBS–KNX -----------------------------------------------------------------

/** Modbus Slave settings MAPS hides for this family (`frmInternalMBS`, IntesisProjectMBSKNX_RT.cs:670-676). */
const MBS_KNX_HIDDEN_MBS_SETTINGS = ["addressMode", "slaveAddressMode", "commErrorTout", "tempSetpoint"];

/** `IntesisMb.PopulateDataLengthComboBox(isInternal)` and `PopulateFormatComboBox` without String. */
const MBS_KNX_LEN_BITS = new Set([16, 32, 64]);
const MBS_KNX_FORMATS = new Set([-1, 0, 1, 2, 3, 4]);

/** Like MAPS, signal IDs are renumbered once after the deletions (`DeleteObject` with `isLastObject`). */
function applyMbsKnxPatches(doc: XmlDocument, patches: MbsKnxPatch[]): void {
  assertSingleMove(patches);
  let deleted = false;
  for (const patch of patches) {
    try {
      if (applyMbsKnxPatch(doc, patch)) deleted = true;
    } catch (error) {
      if (error instanceof MbsKnxSignalEditError || error instanceof MbsKnxConversionEditError) {
        throw new ProjectServiceError(error.status, error.message);
      }
      throw error;
    }
  }
  if (deleted) mbsKnxReorderSignalIds(doc);
}

/** Returns true when the patch removed a signal. */
function applyMbsKnxPatch(doc: XmlDocument, patch: MbsKnxPatch): boolean {
  switch (patch.type) {
    case "moveSignal":
      applySignalMove(doc, patch, mbsKnxMoveSignal);
      break;
    case "setProjectPassword":
      setProjectPassword(doc, patch.password);
      break;
    case "setGeneralInfo":
      mbsKnxSetGeneralInfo(doc, patch);
      break;
    case "setGatewayInfo":
      mbsKnxSetGatewayInfo(doc, patch);
      break;
    case "setKnxPhysicalAddress":
      mbsKnxSetKnxPhysicalAddress(doc, patch.address);
      break;
    case "setKnxExtendedAddresses":
      mbsKnxSetKnxExtendedAddresses(doc, patch.enabled);
      break;
    case "updateMbsConfig": {
      const hidden = Object.keys(patch.patch).filter((key) => MBS_KNX_HIDDEN_MBS_SETTINGS.includes(key));
      if (hidden.length > 0) {
        throw new ProjectServiceError(409, `KNX ↔ Modbus Slave projects have no ${hidden.join(", ")} setting (MAPS hides it).`);
      }
      mbsKnxUpdateMbsConfig(doc, patch.patch);
      break;
    }
    case "updateRtuConfig":
      mbsKnxUpdateRtuConfig(doc, patch.patch);
      break;
    case "updateTcpConfig":
      mbsKnxUpdateTcpConfig(doc, patch.patch);
      break;
    case "addSignal":
      mbsKnxAddSignal(doc);
      break;
    case "removeSignal":
      return mbsKnxRemoveSignal(doc, patch.id);
    case "updateSignal": {
      const { conversions, ...rest } = patch.patch;
      const modbus = rest.modbus;
      if (modbus?.lenBits !== undefined && !MBS_KNX_LEN_BITS.has(modbus.lenBits)) {
        throw new ProjectServiceError(422, `Signal ${patch.id + 1}: the Modbus length must be 16, 32 or 64 bits.`);
      }
      if (modbus?.format !== undefined && !MBS_KNX_FORMATS.has(modbus.format)) {
        throw new ProjectServiceError(422, `Signal ${patch.id + 1}: that Modbus format is not available for this gateway.`);
      }
      let conversionRefs: MbsKnxSignalPatch["conversionRefs"];
      if (conversions) {
        // The refs follow the read/write mode the same edit leaves.
        const result = mbsKnxSelectionRefs(doc, patch.id, conversions, modbus?.readWrite);
        if ("error" in result) throw new ProjectServiceError(422, result.error);
        conversionRefs = result.refs;
      }
      mbsKnxUpdateSignal(doc, patch.id, { ...rest, ...(conversionRefs ? { conversionRefs } : {}) });
      break;
    }
    case "restoreSignalConversions": {
      const result = mbsKnxRestoredRefs(doc, patch.id, patch.refs);
      if ("error" in result) throw new ProjectServiceError(422, result.error);
      mbsKnxUpdateSignal(doc, patch.id, { conversionRefs: result.refs });
      break;
    }
    case "addConversion":
      mbsKnxAddConversion(doc, patch.conversionType, patch.values);
      break;
    case "updateConversion":
      mbsKnxUpdateConversion(doc, patch, patch.patch);
      break;
    case "removeConversion":
      mbsKnxRemoveConversion(doc, patch);
      break;
  }
  return false;
}
