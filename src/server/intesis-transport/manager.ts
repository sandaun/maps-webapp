import "server-only";
import { randomUUID } from "node:crypto";
import {
  GatewayError,
  GatewaySession,
  type ConsoleCommandOptions,
  type MonitorOptions,
  type SendFileOptions,
} from "./session";
import { TcpDuplex, type Duplex } from "./transport";
import { SerialDuplex } from "./serial";
import { summarizeInfo, type GatewayInfoSummary } from "./info";
import { assertGatewayAvailable } from "../modbus-scan/guard";

/**
 * In-memory manager for live gateway sessions, behind the `GatewaySessions`
 * interface. Limitation (documented for the MVP): single-process — sessions
 * live in this Node process and do not survive restarts or multiple replicas.
 *
 * Passwords are held in memory only (inside the GatewaySession) and are never
 * serialized into statuses, events, logs, or error messages.
 */

export interface GatewaySessionStatus {
  transport?: "tcp" | "usb";
  id: string;
  /** Local project selected for this session, when one is open. */
  projectId?: string;
  host: string;
  port: number;
  connected: boolean;
  /** False when the firmware fell back to cleartext (SKT pattern). */
  encrypted: boolean;
  busy: boolean;
  /** True while the diagnostics monitor (SPONS/COMMS pushes) is enabled. */
  monitoring: boolean;
  /** True while the monitor also streams raw bus frames (`COMMS=1`). */
  monitorComms: boolean;
  /** True while the monitor also streams firmware debug lines (`DEBUG=1`). */
  monitorDebug: boolean;
  connectedAt: string;
  gateway?: GatewayInfoSummary;
}

export type SessionEvent =
  | { type: "log"; at: string; line: string }
  | { type: "progress"; at: string; receivedBytes: number; totalBytes: number }
  | { type: "monitor"; at: string; line: string }
  | { type: "status"; at: string; status: GatewaySessionStatus };

export type SessionEventListener = (event: SessionEvent) => void;

export interface ConnectOptions {
  transport?: "tcp" | "usb";
  host: string;
  port?: number;
  password: string;
}

export interface GatewaySessions {
  connect(options: ConnectOptions): Promise<GatewaySessionStatus>;
  disconnect(id: string): void;
  list(): GatewaySessionStatus[];
  getStatus(id: string): GatewaySessionStatus;
  queryInfo(id: string): Promise<GatewayInfoSummary>;
  /** RECVCMPLT: downloads and validates the "complete" blob (read-only). */
  receiveProject(id: string): Promise<Uint8Array>;
  /**
   * SENDCMPLT: uploads a "complete" blob (WRITE — only reachable through the
   * gated deploy service, src/server/deploy/).
   */
  sendComplete(id: string, blob: Uint8Array, options?: SendFileOptions): Promise<void>;
  /** Subscribe to the session event stream (SSE); replays recent history. */
  subscribe(id: string, listener: SessionEventListener): () => void;
  /**
   * Free-text diagnostics console command (docs/reference/console-protocol.md).
   * Response closes on an idle gap — unknown commands are silent by design.
   */
  runConsoleCommand(
    id: string,
    command: string,
    options?: ConsoleCommandOptions,
  ): Promise<{ lines: string[]; timedOut: boolean }>;
  /** Enables/disables the live monitor; pushed lines flow as `monitor` events. */
  setMonitor(id: string, enabled: boolean, options?: MonitorOptions): Promise<GatewaySessionStatus>;
}

/** HTTP-shaped error so routes can reuse `errorResponse` from projects/http. */
export class GatewayRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GatewayRequestError";
  }
}

/** Maps transport failures to HTTP statuses for the API edge. */
export function toGatewayRequestError(error: unknown): GatewayRequestError {
  if (error instanceof GatewayRequestError) return error;
  if (error instanceof Error && typeof (error as { status?: number }).status === "number") return new GatewayRequestError((error as Error & { status: number }).status, error.message);
  if (error instanceof GatewayError) {
    const status =
      error.code === "busy"
        ? 409
        : error.code === "no-project"
          ? 404
          : error.code === "auth"
            ? 401
            : error.code === "timeout"
              ? 504
              : 502; // connect / protocol / transfer / invalid-blob / closed
    return new GatewayRequestError(status, error.message);
  }
  return new GatewayRequestError(502, error instanceof Error ? error.message : "Gateway error");
}

type DuplexFactory = (host: string, port: number, timeoutMs: number) => Promise<Duplex>;

/** Events emitted by a session before the timestamp is attached. */
type SessionEventInput =
  | { type: "log"; line: string }
  | { type: "progress"; receivedBytes: number; totalBytes: number };

interface ManagedSession {
  password: string;
  internal?: boolean;
  transport: "tcp" | "usb";
  projectId?: string;
  session: GatewaySession;
  host: string;
  port: number;
  encrypted: boolean;
  busy: boolean;
  connectedAt: string;
  gateway?: GatewayInfoSummary;
  listeners: Set<SessionEventListener>;
  /** Recent events replayed to new SSE subscribers (ring buffer). */
  history: SessionEvent[];
  /** Recent monitor lines, replayed after `history` (kept apart so a chatty
   *  bus does not evict the transfer log). */
  monitorHistory: SessionEvent[];
}

const HISTORY_LIMIT = 200;
const MONITOR_HISTORY_LIMIT = 150;
const CONNECT_TIMEOUT_MS = 5_000;

export class GatewaySessionManager implements GatewaySessions {
  private sessions = new Map<string, ManagedSession>();

  constructor(
    private readonly createDuplex: DuplexFactory = (host, port, timeout) =>
      TcpDuplex.connect(host, port, timeout),
    private readonly createSerialDuplex: (path: string, timeout: number) => Promise<Duplex> =
      (path, timeout) => SerialDuplex.connect(path, timeout),
  ) {}

  async connect(options: ConnectOptions): Promise<GatewaySessionStatus> {
    const id = randomUUID();
    const transport = options.transport ?? "tcp";
    const port = transport === "usb" ? 0 : (options.port ?? 23);
    let managed: ManagedSession | undefined;
    try {
      const duplex = transport === "usb"
        ? await this.createSerialDuplex(options.host, CONNECT_TIMEOUT_MS)
        : await this.createDuplex(options.host, port, CONNECT_TIMEOUT_MS);
      const emit = (event: SessionEventInput) => {
        if (managed) pushEvent(managed, { ...event, at: new Date().toISOString() });
      };
      const session = new GatewaySession(duplex, {
        transport,
        password: options.password,
        log: (line) => emit({ type: "log", line }),
        progress: (receivedBytes, totalBytes) =>
          emit({ type: "progress", receivedBytes, totalBytes }),
      });
      managed = {
        password: options.password,
        transport,
        session,
        host: options.host,
        port,
        encrypted: false,
        busy: false,
        connectedAt: new Date().toISOString(),
        listeners: new Set(),
        history: [],
        monitorHistory: [],
      };
      this.sessions.set(id, managed);
      const { info, encrypted } = await session.connect();
      managed.encrypted = encrypted;
      managed.gateway = summarizeInfo(info);
      return this.getStatus(id);
    } catch (error) {
      managed?.session.close();
      this.sessions.delete(id);
      throw toGatewayRequestError(error);
    }
  }

  disconnect(id: string): void {
    const managed = this.require(id);
    assertGatewayAvailable(managed.host);
    managed.session.close();
    this.sessions.delete(id);
  }

  list(): GatewaySessionStatus[] {
    return [...this.sessions.entries()].filter(([, m]) => !m.internal).map(([id, m]) => this.toStatus(id, m));
  }

  /** Transfer the existing control connection to the worker, then reconnect as needed.
   * Opening a second control connection can prevent firmware from accepting LOGIN1.
   * The host lock prevents the browser from disconnecting this owned session.
   */
  scanConnector(id: string): () => Promise<GatewaySessionStatus> {
    const source = this.require(id);
    const options: ConnectOptions = {
      transport: source.transport,
      host: source.host,
      port: source.port,
      password: source.password,
    };
    let first = true;
    return async () => {
      assertGatewayAvailable(options.host);
      if (first) {
        first = false;
        if (this.sessions.get(id) === source && source.session.connected) {
          source.internal = true;
          return this.getStatus(id);
        }
      }
      const status = await this.connect(options);
      this.require(status.id).internal = true;
      return status;
    };
  }

  getStatus(id: string): GatewaySessionStatus {
    return this.toStatus(id, this.require(id));
  }

  setProjectId(id: string, projectId: string | null): GatewaySessionStatus {
    const managed = this.require(id);
    managed.projectId = projectId ?? undefined;
    return this.toStatus(id, managed);
  }

  async queryInfo(id: string): Promise<GatewayInfoSummary> {
    const managed = this.require(id);
    return this.runExclusive(managed, async () => {
      const info = await managed.session.queryInfo();
      managed.gateway = summarizeInfo(info);
      return managed.gateway;
    }).catch((error: unknown) => {
      throw toGatewayRequestError(error);
    });
  }

  async receiveProject(id: string): Promise<Uint8Array> {
    const managed = this.require(id);
    return this.runExclusive(managed, () => managed.session.receiveComplete()).catch(
      (error: unknown) => {
        throw toGatewayRequestError(error);
      },
    );
  }

  async sendComplete(id: string, blob: Uint8Array, options?: SendFileOptions): Promise<void> {
    const managed = this.require(id);
    return this.runExclusive(managed, () => managed.session.sendComplete(blob, options)).catch(
      (error: unknown) => {
        throw toGatewayRequestError(error);
      },
    );
  }

  subscribe(id: string, listener: SessionEventListener): () => void {
    const managed = this.require(id);
    for (const event of managed.history) listener(event);
    for (const event of managed.monitorHistory) listener(event);
    managed.listeners.add(listener);
    return () => managed.listeners.delete(listener);
  }

  async runConsoleCommand(
    id: string,
    command: string,
    options?: ConsoleCommandOptions,
  ): Promise<{ lines: string[]; timedOut: boolean }> {
    const managed = this.require(id);
    return this.runExclusive(managed, async () => {
      pushEvent(managed, {
        type: "log",
        at: new Date().toISOString(),
        line: `Console: ${command}`,
      });
      return managed.session.runConsoleCommand(command, options);
    }).catch((error: unknown) => {
      throw toGatewayRequestError(error);
    });
  }

  async setMonitor(id: string, enabled: boolean, options?: MonitorOptions): Promise<GatewaySessionStatus> {
    const managed = this.require(id);
    await this.runExclusive(managed, async () => {
      await managed.session.setMonitor(enabled, (line) => {
        const event: SessionEvent = { type: "monitor", at: new Date().toISOString(), line };
        managed.monitorHistory.push(event);
        if (managed.monitorHistory.length > MONITOR_HISTORY_LIMIT) {
          managed.monitorHistory.shift();
        }
        for (const listener of managed.listeners) listener(event);
      }, options);
    }).catch((error: unknown) => {
      throw toGatewayRequestError(error);
    });
    // Publish only after runExclusive releases the lock; otherwise SSE clients
    // retain busy=true and keep gateway transfers disabled indefinitely.
    const status = this.toStatus(id, managed);
    for (const listener of managed.listeners) {
      listener({ type: "status", at: new Date().toISOString(), status });
    }
    return status;
  }

  private async runExclusive<T>(managed: ManagedSession, op: () => Promise<T>): Promise<T> {
    assertGatewayAvailable(managed.host);
    if (managed.busy) throw new GatewayRequestError(409, "The session has an operation in progress");
    managed.busy = true;
    try {
      return await op();
    } finally {
      managed.busy = false;
    }
  }

  private require(id: string): ManagedSession {
    const managed = this.sessions.get(id);
    if (!managed) throw new GatewayRequestError(404, `Gateway session "${id}" not found`);
    return managed;
  }

  private toStatus(id: string, m: ManagedSession): GatewaySessionStatus {
    return {
      transport: m.transport,
      id,
      ...(m.projectId ? { projectId: m.projectId } : {}),
      host: m.host,
      port: m.port,
      connected: m.session.connected,
      encrypted: m.encrypted,
      busy: m.busy,
      monitoring: m.session.monitoring,
      monitorComms: m.session.monitoringComms,
      monitorDebug: m.session.monitoringDebug,
      connectedAt: m.connectedAt,
      gateway: m.gateway,
    };
  }
}

function pushEvent(managed: ManagedSession, event: SessionEvent): void {
  managed.history.push(event);
  if (managed.history.length > HISTORY_LIMIT) managed.history.shift();
  for (const listener of managed.listeners) listener(event);
}

/**
 * Process-wide singleton (single-process MVP). Kept on `globalThis` so Next.js
 * dev recompilations (which re-evaluate route modules) do not silently drop
 * live gateway sessions.
 */
const globalForSessions = globalThis as unknown as {
  __mapsGatewaySessionManager?: GatewaySessionManager;
  __mapsGatewaySessionManagerVersion?: number;
};

// Bump when cached managers cannot support the new transport/session contract.
const SESSION_MANAGER_VERSION = 2;

export function getGatewaySessionManager(): GatewaySessionManager {
  if (globalForSessions.__mapsGatewaySessionManagerVersion !== SESSION_MANAGER_VERSION) {
    const previous = globalForSessions.__mapsGatewaySessionManager;
    // Release open sockets/serial handles before replacing an incompatible cache.
    for (const { id } of previous?.list() ?? []) previous?.disconnect(id);
    globalForSessions.__mapsGatewaySessionManager = new GatewaySessionManager();
    globalForSessions.__mapsGatewaySessionManagerVersion = SESSION_MANAGER_VERSION;
  }
  globalForSessions.__mapsGatewaySessionManager ??= new GatewaySessionManager();
  return globalForSessions.__mapsGatewaySessionManager;
}

/** Test hook: drop the singleton. */
export function resetGatewaySessionManagerForTests(): void {
  globalForSessions.__mapsGatewaySessionManager = undefined;
  globalForSessions.__mapsGatewaySessionManagerVersion = undefined;
}
