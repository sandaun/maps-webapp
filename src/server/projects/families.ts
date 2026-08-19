import "server-only";
import type { XmlDocument } from "@/core/project-format";
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
  setGatewayInfo as knxSetGatewayInfo,
  setGeneralInfo as knxSetGeneralInfo,
  setKnxExtendedAddresses,
  setKnxPhysicalAddress,
  updateDevice as knxUpdateDevice,
  updateRtuNode as knxUpdateRtuNode,
  updateSignal as knxUpdateSignal,
  updateTcpNode as knxUpdateTcpNode,
  validateProject as validateKnxMbmProject,
  type KnxMbmProject,
  type NodeLocator,
  type SignalPatch as KnxMbmSignalPatch,
} from "@/gateway-families/knx-mbm";
import {
  addSignal as meAddSignal,
  isMeMbsProject,
  projectFromXml as meMbsProjectFromXml,
  removeSignal as meRemoveSignal,
  setGatewayInfo as meSetGatewayInfo,
  setGeneralInfo as meSetGeneralInfo,
  updateController,
  updateGroup,
  updateMbsConfig,
  updateMeScalars,
  updateRtuConfig,
  updateSignal as meUpdateSignal,
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
  Pick<MbsConfig, "media" | "byteOrder" | "updateCOV" | "commErrorTout" | "registerBase">
>;
type MeScalarsPatch = Partial<
  Pick<MeMbsProject["me"], "pollPeriod" | "ansTimeout" | "controllerTout" | "writeMaxBurst">
>;
type MeControllerPatch = Partial<
  Pick<MeControllerInfo, "description" | "enabled" | "ip" | "port" | "model" | "compatibility" | "addErrorSignals">
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
  | { type: "addSignal" }
  | { type: "removeSignal"; id: number }
  | { type: "updateSignal"; id: number; patch: KnxMbmSignalPatch }
  | { type: "addRtuNode" }
  | { type: "addTcpNode" }
  | { type: "removeNode"; locator: NodeLocator }
  | { type: "updateRtuNode"; nodeIndex: number; patch: RtuNodePatch }
  | { type: "updateTcpNode"; nodeIndex: number; patch: TcpNodePatch }
  | { type: "addDevice"; locator: NodeLocator }
  | { type: "updateDevice"; locator: NodeLocator; deviceIndex: number; patch: DevicePatch }
  | { type: "removeDevice"; locator: NodeLocator; deviceIndex: number };

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
  | { type: "updateGroup"; controllerIndex: number; groupIndex: number; patch: MeGroupPatch };

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
  applyPatch: (doc: XmlDocument, patch: ProjectPatch) => void;
}

const KNX_MBM_TYPES = new Set([
  "setGeneralInfo",
  "setGatewayInfo",
  "setKnxPhysicalAddress",
  "setKnxExtendedAddresses",
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
  applyPatch: (doc, patch) => applyKnxMbmPatch(doc, patch as KnxMbmPatch),
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
  applyPatch: (doc, patch) => applyMeMbsPatch(doc, patch as MeMbsPatch),
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
    case "addSignal":
      knxAddSignal(doc);
      break;
    case "removeSignal":
      knxRemoveSignal(doc, patch.id);
      break;
    case "updateSignal":
      knxUpdateSignal(doc, patch.id, patch.patch);
      break;
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
      knxRemoveDevice(doc, { ...patch.locator, deviceIndex: patch.deviceIndex });
      break;
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
      meAddSignal(doc);
      break;
    case "removeSignal":
      meRemoveSignal(doc, patch.id);
      break;
    case "updateSignal":
      meUpdateSignal(doc, patch.id, patch.patch);
      break;
    case "updateMbsConfig":
      updateMbsConfig(doc, patch.patch);
      break;
    case "updateRtuConfig":
      updateRtuConfig(doc, patch.patch);
      break;
    case "updateTcpConfig":
      updateTcpConfig(doc, patch.patch);
      break;
    case "updateMeScalars":
      updateMeScalars(doc, patch.patch);
      break;
    case "updateController":
      updateController(doc, patch.controllerIndex, patch.patch);
      break;
    case "updateGroup":
      updateGroup(doc, patch.controllerIndex, patch.groupIndex, patch.patch);
      break;
  }
}
