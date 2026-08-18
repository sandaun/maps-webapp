import type { KnxMbmProject } from "@/gateway-families/knx-mbm/model";
import type { ValidationIssue } from "@/core/validation/issue";
import type { MbmDevice, MbmRtuNode, MbmTcpNode } from "@/protocols/modbus/master/nodes";

/**
 * Client-side mirrors of the server API shapes (`src/server/projects`). The
 * server modules are `server-only`, so these pure types are duplicated here
 * and kept structurally identical; client code must never import the server.
 */

export type ProjectSource = "gateway" | "file" | "demo";

export interface ProjectMeta {
  id: string;
  name: string;
  description: string;
  source: ProjectSource;
  fileName?: string;
  updatedAt: string; // ISO
}

export interface ProjectView {
  meta: ProjectMeta;
  project: KnxMbmProject;
  issues: ValidationIssue[];
  hasCompleteBlob: boolean;
}

export type NodeLocator = { kind: "rtu" | "tcp"; nodeIndex: number };

export interface SignalPatchInput {
  active?: boolean;
  description?: string;
  knx?: Partial<KnxMbmProject["signals"][number]["knx"]>;
  modbus?: Partial<KnxMbmProject["signals"][number]["modbus"]>;
  idxOperations?: string;
  idxFilters?: string;
}

export type RtuNodePatchInput = Partial<Omit<MbmRtuNode, "devices">>;
export type TcpNodePatchInput = Partial<Omit<MbmTcpNode, "devices">>;
export type DevicePatchInput = Partial<Omit<MbmDevice, "index">>;

/** Mirror of `ProjectPatch` in `src/server/projects/service.ts`. */
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
  | { type: "removeDevice"; locator: NodeLocator; deviceIndex: number };
