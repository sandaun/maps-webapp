import type { KnxMbmProject } from "@/gateway-families/knx-mbm/model";
import type { MeMbsProject } from "@/gateway-families/me-mbs/model";
import type { ValidationIssue } from "@/core/validation/issue";
import type { MeControllerInfo, MeGroupInfo } from "@/protocols/me";
import type { MbsConfig } from "@/protocols/modbus/slave";
import type { MbmDevice, MbmRtuNode, MbmTcpNode } from "@/protocols/modbus/master/nodes";

/**
 * Client-side mirrors of the server API shapes (`src/server/projects`). The
 * server modules are `server-only`, so these pure types are duplicated here
 * and kept structurally identical; client code must never import the server.
 */

export type ProjectSource = "gateway" | "file" | "template" | "demo";

/** Gateway families this build can open (mirror of `server/projects/families`). */
export type FamilyId = "knx-mbm" | "me-mbs";

export const FAMILY_LABELS: Record<FamilyId, string> = {
  "knx-mbm": "KNX ↔ Modbus Master",
  "me-mbs": "Mitsubishi Electric AC ↔ Modbus Slave",
};

export interface ProjectMeta {
  id: string;
  name: string;
  description: string;
  source: ProjectSource;
  family: FamilyId;
  fileName?: string;
  updatedAt: string; // ISO
}

interface ProjectViewBase {
  meta: ProjectMeta;
  issues: ValidationIssue[];
  hasCompleteBlob: boolean;
}

/** Family-discriminated project view: `family` selects the model type. */
export type ProjectView =
  | (ProjectViewBase & { family: "knx-mbm"; project: KnxMbmProject })
  | (ProjectViewBase & { family: "me-mbs"; project: MeMbsProject });

export type NodeLocator = { kind: "rtu" | "tcp"; nodeIndex: number };

export interface SignalPatchInput {
  active?: boolean;
  description?: string;
  knx?: Partial<KnxMbmProject["signals"][number]["knx"]>;
  modbus?:
    | Partial<KnxMbmProject["signals"][number]["modbus"]>
    | Partial<MeMbsProject["signals"][number]["modbus"]>;
  me?: Partial<MeMbsProject["signals"][number]["me"]>;
  idxOperations?: string;
  idxFilters?: string;
}

export type RtuNodePatchInput = Partial<Omit<MbmRtuNode, "devices">>;
export type TcpNodePatchInput = Partial<Omit<MbmTcpNode, "devices">>;
export type DevicePatchInput = Partial<Omit<MbmDevice, "index">>;

export type MbsConfigPatchInput = Partial<
  Pick<MbsConfig, "media" | "byteOrder" | "updateCOV" | "commErrorTout" | "registerBase">
>;
export type MeScalarsPatchInput = Partial<
  Pick<MeMbsProject["me"], "pollPeriod" | "ansTimeout" | "controllerTout" | "writeMaxBurst">
>;
export type MeControllerPatchInput = Partial<
  Pick<MeControllerInfo, "description" | "enabled" | "ip" | "port" | "model" | "compatibility" | "addErrorSignals">
>;
export type MeGroupPatchInput = Partial<
  Pick<MeGroupInfo, "enabled" | "description" | "type" | "fanSpeeds" | "dualSetPoint" | "urc" | "capacity">
>;

/** Mirror of `ProjectPatch` in `src/server/projects/families.ts`. */
export type ProjectPatchInput =
  | { type: "setGeneralInfo"; name?: string; description?: string }
  | { type: "setGatewayInfo"; name?: string; ip?: string; netmask?: string; gateway?: string; dhcp?: boolean }
  | { type: "setKnxPhysicalAddress"; address: number }
  | { type: "setKnxExtendedAddresses"; enabled: boolean }
  | { type: "addSignal" }
  | { type: "removeSignal"; id: number }
  | { type: "updateSignal"; id: number; patch: SignalPatchInput }
  | { type: "addRtuNode" }
  | { type: "addTcpNode" }
  | { type: "removeNode"; locator: NodeLocator }
  | { type: "updateRtuNode"; nodeIndex: number; patch: RtuNodePatchInput }
  | { type: "updateTcpNode"; nodeIndex: number; patch: TcpNodePatchInput }
  | { type: "addDevice"; locator: NodeLocator }
  | { type: "updateDevice"; locator: NodeLocator; deviceIndex: number; patch: DevicePatchInput }
  | { type: "removeDevice"; locator: NodeLocator; deviceIndex: number }
  | { type: "updateMbsConfig"; patch: MbsConfigPatchInput }
  | { type: "updateRtuConfig"; patch: Partial<MbsConfig["rtu"]> }
  | { type: "updateTcpConfig"; patch: Partial<MbsConfig["tcp"]> }
  | { type: "updateMeScalars"; patch: MeScalarsPatchInput }
  | { type: "updateController"; controllerIndex: number; patch: MeControllerPatchInput }
  | { type: "updateGroup"; controllerIndex: number; groupIndex: number; patch: MeGroupPatchInput };
