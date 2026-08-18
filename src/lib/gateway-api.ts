import { request } from "./api";
import type { ProjectMeta } from "./project-types";

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

/** True when a discovered/session gateway belongs to the KNX–MBM family. */
export function isKnxMbmGateway(info: GatewayInfoSummary, raw?: Record<string, string>): boolean {
  if (info.appId === KNX_MBM_APP_ID) return true;
  const haystack = [info.appName, info.platform, ...Object.values(raw ?? {})]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return /IN-KNX-MBM|KNXMBM/i.test(haystack);
}

/** UDP/23 discovery scan. */
export async function scanGateways(): Promise<DiscoveredGateway[]> {
  const data = await request<{ gateways: DiscoveredGateway[] }>("/api/gateway/discovery", {
    method: "POST",
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
