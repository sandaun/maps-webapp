import { request } from "./api";
import type { ProjectMeta } from "./project-types";

export const GATEWAY_SESSIONS_CHANGED_EVENT = "maps:gateway-sessions-changed";

function notifyGatewaySessionsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(GATEWAY_SESSIONS_CHANGED_EVENT));
  }
}

/**
 * Client mirrors of the gateway API shapes (`src/server/intesis-transport`,
 * which is `server-only`). Kept structurally identical; client code must never
 * import the server modules. Passwords flow only into `connectGateway` — they
 * are never stored client-side.
 */

/** Mirror of `GatewayInfoSummary` in `src/server/intesis-transport/info.ts`. */
export interface GatewayInfoSummary {
  name?: string;
  serial?: string;
  appName?: string;
  appId?: number;
  appVersion?: string;
  platform?: string;
  mac?: string;
  ip?: string;
  netmask?: string;
  gateway?: string;
  dhcp?: boolean;
  status?: string;
  bootloader: boolean;
  noApp: boolean;
}

/** Mirror of `GatewaySessionStatus` in `src/server/intesis-transport/manager.ts`. */
export interface GatewaySessionStatus {
  id: string;
  host: string;
  port: number;
  connected: boolean;
  encrypted: boolean;
  busy: boolean;
  connectedAt: string;
  gateway?: GatewayInfoSummary;
}

/** Mirror of `DiscoveredGateway` in `src/server/intesis-transport/discovery.ts`. */
export interface DiscoveredGateway {
  address: string;
  info: GatewayInfoSummary;
  raw: Record<string, string>;
}

/** Mirror of `SessionEvent` in `src/server/intesis-transport/manager.ts`. */
export type SessionEvent =
  | { type: "log"; at: string; line: string }
  | { type: "progress"; at: string; receivedBytes: number; totalBytes: number }
  | { type: "status"; at: string; status: GatewaySessionStatus };

/** KNX ↔ Modbus Master AppId (`IBOX_KNX_MBM = 4`, see docs/knx-mbm-mvp.md §1). */
export const KNX_MBM_APP_ID = 4;
/** ME AC ↔ Modbus Slave unit AppId (`ME_AC_XXX = 64` — 770 Air, see docs/ac-me-mbs-analisi.md §1). */
export const ME_MBS_APP_ID = 64;

/**
 * Family of a discovered/session gateway, or null when unsupported.
 * Detection by AppId first, then by name patterns.
 */
export function gatewayFamily(
  info: GatewayInfoSummary,
  raw?: Record<string, string>,
): "knx-mbm" | "me-mbs" | null {
  if (info.appId === KNX_MBM_APP_ID) return "knx-mbm";
  if (info.appId === ME_MBS_APP_ID) return "me-mbs";
  const haystack = [info.appName, info.platform, ...Object.values(raw ?? {})]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  if (/IN-KNX-MBM|KNXMBM/i.test(haystack)) return "knx-mbm";
  if (/IN770AIR|IN770MIT|IN-ME-AC-MBS/i.test(haystack)) return "me-mbs";
  return null;
}

/** True when a discovered/session gateway belongs to the KNX–MBM family. */
export function isKnxMbmGateway(info: GatewayInfoSummary, raw?: Record<string, string>): boolean {
  return gatewayFamily(info, raw) === "knx-mbm";
}

/** UDP/23 discovery scan. Optional unicast targets for NAT/WSL setups. */
export async function scanGateways(targets?: string[]): Promise<DiscoveredGateway[]> {
  const data = await request<{ gateways: DiscoveredGateway[] }>("/api/gateway/discovery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(targets?.length ? { targets } : {}),
  });
  return data.gateways;
}

/**
 * Open a control session. The password is sent once over this request and
 * held in memory server-side only; callers must clear their copy after use.
 */
export async function connectGateway(host: string, password: string): Promise<GatewaySessionStatus> {
  const data = await request<{ session: GatewaySessionStatus }>("/api/gateway/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ host, password }),
  });
  notifyGatewaySessionsChanged();
  return data.session;
}

/** Live sessions on this (single-process) server. */
export async function listGatewaySessions(): Promise<GatewaySessionStatus[]> {
  const data = await request<{ sessions: GatewaySessionStatus[] }>("/api/gateway/sessions");
  return data.sessions;
}

export async function getGatewaySession(id: string): Promise<GatewaySessionStatus> {
  const data = await request<{ session: GatewaySessionStatus }>(
    `/api/gateway/sessions/${encodeURIComponent(id)}`,
  );
  return data.session;
}

export async function disconnectGateway(id: string): Promise<void> {
  await request(`/api/gateway/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
  notifyGatewaySessionsChanged();
}

/** Fresh `INFO?` query (read-only). */
export async function queryGatewayInfo(id: string): Promise<GatewayInfoSummary> {
  const data = await request<{ info: GatewayInfoSummary }>(
    `/api/gateway/sessions/${encodeURIComponent(id)}/info`,
    { method: "POST" },
  );
  return data.info;
}

/** RECVCMPLT: receive the project from the gateway (read-only on the device). */
export async function receiveGatewayProject(id: string): Promise<ProjectMeta> {
  const data = await request<{ project: ProjectMeta }>(
    `/api/gateway/sessions/${encodeURIComponent(id)}/receive`,
    { method: "POST" },
  );
  return data.project;
}

/** Mirror of `DeployGateCheck` in `src/server/deploy/service.ts`. */
export interface DeployGateCheck {
  id: "family" | "capability" | "session-appid";
  ok: boolean;
  detail: string;
}

/** Mirror of `DeployStatus` in `src/server/deploy/service.ts`. */
export interface DeployStatus {
  deployable: boolean;
  checks: DeployGateCheck[];
}

/** Mirror of `DeployResult` in `src/server/deploy/service.ts`. */
export interface DeployResult {
  projectId: string;
  sessionId: string;
  bytes: number;
  xblBytes: number;
  zipBytes: number;
  appId: number;
  swVersion: string;
}

/** Server-side deploy gate evaluation for a project/session pair. */
export async function getDeployStatus(sessionId: string, projectId: string): Promise<DeployStatus> {
  const data = await request<{ status: DeployStatus }>(
    `/api/gateway/sessions/${encodeURIComponent(sessionId)}/deploy?projectId=${encodeURIComponent(projectId)}`,
  );
  return data.status;
}

/**
 * SENDCMPLT deploy (WRITES configuration to the gateway). The server re-runs
 * all gates; the UI must still ask for explicit confirmation first.
 */
export async function deployGatewayProject(
  sessionId: string,
  projectId: string,
): Promise<DeployResult> {
  const data = await request<{ result: DeployResult }>(
    `/api/gateway/sessions/${encodeURIComponent(sessionId)}/deploy`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    },
  );
  return data.result;
}
