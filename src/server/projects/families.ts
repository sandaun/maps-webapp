import "server-only";
import type { XmlDocument } from "@/core/project-format";
import type { ConversionSelection, SignalConversionRefs } from "@/core/signals/conversion-refs";
import type { ValidationIssue } from "@/core/validation/issue";
import {
  addDevice as knxAddDevice,
  addRtuNode as knxAddRtuNode,
  addSignal as knxAddSignal,
  addTcpNode as knxAddTcpNode,
  isKnxMbmProject,
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
  updateRtuConfig,
  updateSignalAndUserAddress,
  updateTcpConfig,
  validateProject as validateMeMbsProject,
  type MeMbsProject,
  type SignalPatch as MeMbsSignalPatch,
} from "@/gateway-families/me-mbs";
import type { MeControllerInfo, MeGroupInfo } from "@/protocols/me";
import type { MbsConfig } from "@/protocols/modbus/slave";
import {
  MAX_RTU_NODES,
  MAX_TCP_NODES,
  type MbmDevice,
  type MbmRtuNode,
  type MbmTcpNode,
} from "@/protocols/modbus/master";
import { ProjectServiceError } from "./errors";

/**
 * Gateway-family registry: the single place where the project service learns
 * which .ibmaps families exist and how to detect, model, validate and patch
 * each one. Families themselves stay UI/transport-agnostic under
 * `src/gateway-families/<id>/`.
 */

export type FamilyId = "knx-mbm" | "me-mbs";

// --- patch types --------------------------------------------------------------

/** Editable node/device fields (topology itself changes via add/remove ops). */
export type RtuNodePatch = Partial<Omit<MbmRtuNode, "devices">>;
export type TcpNodePatch = Partial<Omit<MbmTcpNode, "devices">>;
export type DevicePatch = Partial<Omit<MbmDevice, "index">>;

type MbsConfigPatch = Partial<
  Pick<
    MbsConfig,
    "media" | "byteOrder" | "updateCOV" | "addressMode" | "slaveAddressMode" | "commErrorTout" | "registerBase" | "slaves"
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

/** Patch operations accepted by the API (validated with zod at the edge). */
export type ProjectPatch = KnxMbmPatch | MeMbsPatch;

// --- registry -----------------------------------------------------------------

interface FamilyEntry {
  id: FamilyId;
  /** Human-readable family name for badges and error messages. */
  displayName: string;
  detect: (doc: XmlDocument) => boolean;
  fromXml: (doc: XmlDocument) => KnxMbmProject | MeMbsProject;
  validate: (project: KnxMbmProject | MeMbsProject) => ValidationIssue[];
  /** True when this family knows how to apply the patch (payload included). */
  accepts: (patch: ProjectPatch) => boolean;
  /** Applies a whole batch; every ID in the batch refers to the document before it. */
  applyPatches: (doc: XmlDocument, patches: ProjectPatch[]) => void;
}

const KNX_MBM_TYPES = new Set([
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

export const FAMILIES: readonly FamilyEntry[] = [KNX_MBM, ME_MBS];

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

/**
 * Like MAPS, signal IDs are renumbered once after the deletions (DeleteObject
 * with `isLastObject`), so the original IDs of a multi-row delete stay valid.
 */
function applyKnxMbmPatches(doc: XmlDocument, patches: KnxMbmPatch[]): void {
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
      updateMbsConfigAndSignals(doc, patch.patch);
      break;
    case "updateRtuConfig":
      updateRtuConfig(doc, patch.patch);
      break;
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
