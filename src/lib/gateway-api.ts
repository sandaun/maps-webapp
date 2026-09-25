import { ApiError, request } from "./api";
import type { ScannedMeGroup } from "@/gateway-families/me-mbs/bus-scan";
import type { ProjectMeta } from "./project-types";

export const GATEWAY_SESSIONS_CHANGED_EVENT = "maps:gateway-sessions-changed";

export interface GatewaySessionsChangedDetail {
  session?: GatewaySessionStatus;
  disconnectedId?: string;
}

function notifyGatewaySessionsChanged(detail: GatewaySessionsChangedDetail): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(GATEWAY_SESSIONS_CHANGED_EVENT, { detail }));
  }
}

/**
 * Sessions live only in the server's memory, so a dev-server recompile or
 * restart drops them while the browser still holds the id. When a
 * session-scoped route answers 404, drop the stale session client-side too,
 * so the UI returns to the Connection screen instead of going zombie.
 */
async function sessionScoped<T>(id: string, promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notifyGatewaySessionsChanged({ disconnectedId: id });
    }
    throw error;
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
  monitoring: boolean;
  /** True while the monitor also streams firmware debug lines (`DEBUG=1`). */
  monitorDebug: boolean;
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
  | { type: "monitor"; at: string; line: string }
  | { type: "status"; at: string; status: GatewaySessionStatus };

/** KNX ↔ Modbus Master AppId (`IBOX_KNX_MBM = 4`, see docs/plans/knx-mbm-mvp.md §1). */
export const KNX_MBM_APP_ID = 4;
/** ME AC ↔ Modbus Slave unit AppId (`ME_AC_XXX = 64` — 770 Air, see docs/reference/ac-me-mbs-analisi.md §1). */
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
  notifyGatewaySessionsChanged({ session: data.session });
  return data.session;
}

/** Live sessions on this (single-process) server. */
export async function listGatewaySessions(): Promise<GatewaySessionStatus[]> {
  const data = await request<{ sessions: GatewaySessionStatus[] }>("/api/gateway/sessions");
  return data.sessions;
}

export async function getGatewaySession(id: string): Promise<GatewaySessionStatus> {
  const data = await sessionScoped(
    id,
    request<{ session: GatewaySessionStatus }>(
      `/api/gateway/sessions/${encodeURIComponent(id)}`,
    ),
  );
  return data.session;
}

export async function disconnectGateway(id: string): Promise<void> {
  await sessionScoped(
    id,
    request(`/api/gateway/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  ).catch((error: unknown) => {
    // A 404 means the server already dropped the session — that is the goal.
    if (error instanceof ApiError && error.status === 404) return;
    throw error;
  });
  notifyGatewaySessionsChanged({ disconnectedId: id });
}

/** Fresh `INFO?` query (read-only). */
export async function queryGatewayInfo(id: string): Promise<GatewayInfoSummary> {
  const data = await sessionScoped(
    id,
    request<{ info: GatewayInfoSummary }>(
      `/api/gateway/sessions/${encodeURIComponent(id)}/info`,
      { method: "POST" },
    ),
  );
  return data.info;
}

/** RECVCMPLT: receive the project from the gateway (read-only on the device). */
export async function receiveGatewayProject(id: string): Promise<ProjectMeta> {
  const data = await sessionScoped(
    id,
    request<{ project: ProjectMeta }>(
      `/api/gateway/sessions/${encodeURIComponent(id)}/receive`,
      { method: "POST" },
    ),
  );
  return data.project;
}

/** Mirror of `ConsoleResult` in `src/server/intesis-transport/session.ts`. */
export interface ConsoleCommandResult {
  lines: string[];
  timedOut: boolean;
}

/**
 * Diagnostics console: free-text command, response closes on an idle gap.
 * Unknown commands are silent by design (docs/reference/console-protocol.md).
 */
export async function sendConsoleCommand(
  id: string,
  command: string,
): Promise<ConsoleCommandResult> {
  return sessionScoped(
    id,
    request<ConsoleCommandResult>(
      `/api/gateway/sessions/${encodeURIComponent(id)}/console`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      },
    ),
  );
}

export interface MeScanParams {
  /** Controller `TypeIndex` (0 = direct connection, 1-3 = expansion). */
  typeIndex: number;
  ip: string;
  port: number;
  /** Secure controllers (AE-C400E) are rejected by the route — always omit. */
  secure?: false;
}

/** Result of the `me-scan` route (`ok`/`error` from `parseBusScanResult`). */
export interface MeScanResult {
  ok: boolean;
  groups: ScannedMeGroup[];
  error?: string;
}

/**
 * M-NET bus scan of a centralized controller (long-running: up to 2 min).
 * Aborting `signal` cancels only the client-side wait — the gateway finishes
 * the scan in the background.
 */
export async function scanMeGroups(
  id: string,
  params: MeScanParams,
  signal?: AbortSignal,
): Promise<MeScanResult> {
  return sessionScoped(
    id,
    request<MeScanResult>(`/api/gateway/sessions/${encodeURIComponent(id)}/me-scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal,
    }),
  );
}

/** Enables/disables the live diagnostics monitor (pushes arrive via SSE). */
export async function setGatewayMonitor(
  id: string,
  enabled: boolean,
  debug = false,
): Promise<GatewaySessionStatus> {
  const data = await sessionScoped(
    id,
    request<{ session: GatewaySessionStatus }>(
      `/api/gateway/sessions/${encodeURIComponent(id)}/monitor`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, debug }),
      },
    ),
  );
  return data.session;
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
  const data = await sessionScoped(
    sessionId,
    request<{ status: DeployStatus }>(
      `/api/gateway/sessions/${encodeURIComponent(sessionId)}/deploy?projectId=${encodeURIComponent(projectId)}`,
    ),
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
  const data = await sessionScoped(
    sessionId,
    request<{ result: DeployResult }>(
      `/api/gateway/sessions/${encodeURIComponent(sessionId)}/deploy`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      },
    ),
  );
  return data.result;
}
