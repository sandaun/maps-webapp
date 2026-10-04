import "server-only";
import { randomUUID, createHash } from "node:crypto";
import { strict as assert } from "node:assert";
import { unzipSync } from "fflate";
import { XmlDocument, parseCompleteBlob } from "@/core/project-format";
import {
  emptyScanResult,
  isScanTerminal,
  pointKey,
  scanInputSchema,
  scanPoints,
  type ScanInput,
  type ScanJob,
  type ScanPoint,
} from "@/core/modbus-scan/model";
import { projectFromXml } from "@/gateway-families/knx-mbm/from-xml";
import {
  getGatewaySessionManager,
  type GatewaySessionManager,
  type GatewaySessionStatus,
} from "@/server/intesis-transport";
import { hasKnxMbmXblVerified } from "@/server/deploy/capabilities";
import { getProjectView, type ProjectView } from "@/server/projects/service";
import { buildScanBatch, RtuScanDecoder, type BusObservation } from "./rtu";
import { ModbusTcpSession, readTcpPoint } from "./tcp";
import { ScanStore } from "./store";
import {
  ScanError,
  assertGatewayAvailable,
  claimGateway,
  gatewayScanOwner,
  releaseGateway,
  withScanOwner,
} from "./guard";

const hash = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Scan failed";
type Connector = () => Promise<GatewaySessionStatus>;
export function scanNode(view: ProjectView, input: ScanInput) {
  if (view.family !== "knx-mbm")
    throw new ScanError(
      422,
      "Modbus scanning is available for KNX–Modbus Master projects.",
    );
  const node =
    input.locator.kind === "rtu"
      ? view.project.mbm.rtuNodes[input.locator.nodeIndex]
      : view.project.mbm.tcpNodes[input.locator.nodeIndex];
  if (!node) throw new ScanError(422, "Choose an existing Modbus connection.");
  return node;
}
export function nodeFingerprint(view: ProjectView, input: ScanInput) {
  const node = scanNode(view, input);
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(node).filter(([key]) => key !== "devices"),
    ),
  );
}

export class ModbusScanService {
  private jobs = new Map<string, ScanJob>();
  private tasks = new Map<string, Promise<void>>();
  private controllers = new Map<string, AbortController>();
  private initialized?: Promise<void>;
  constructor(
    readonly store = new ScanStore(),
    private readonly sessions: ScanSessions = getGatewaySessionManager(),
    private readonly getView = getProjectView,
    private readonly tcpRead = readTcpPoint,
    private readonly wait = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ) {}
  async initialize() {
    this.initialized ??= (async () => {
      for (const job of await this.store.list()) {
        this.jobs.set(job.id, job);
        if (!isScanTerminal(job.state)) {
          if (job.needsRestore) {
            job.state = "restore-pending";
            job.recoveryError =
              "The server restarted. Reconnect to the gateway to restore the saved backup.";
            job.error ??=
              "Scan interrupted by a server restart. Recovered results may be partial.";
            if (gatewayScanOwner(job.host) === undefined)
              claimGateway(job.host, job.id);
          } else {
            job.state = "failed";
            job.error = "The server restarted before this scan finished.";
            releaseGateway(job.host, job.id);
          }
          await this.store.save(job);
        } else if (!job.needsRestore) releaseGateway(job.host, job.id);
      }
    })();
    await this.initialized;
  }
  async list(projectId?: string) {
    await this.initialize();
    return [...this.jobs.values()]
      .filter((job) => !projectId || job.input.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string) {
    await this.initialize();
    const job = this.jobs.get(id);
    if (!job) throw new ScanError(404, "Scan not found");
    return job;
  }
  private launch(job: ScanJob, work: () => Promise<void>) {
    if (this.tasks.has(job.id))
      throw new ScanError(
        409,
        "This scan already has an operation in progress.",
      );
    const task = withScanOwner(job.id, work)
      .catch(async (error) => {
        job.error = message(error);
        job.state = job.needsRestore ? "restore-pending" : "failed";
        await this.store.save(job);
        if (!job.needsRestore) releaseGateway(job.host, job.id);
      })
      .finally(() => {
        this.tasks.delete(job.id);
        this.controllers.delete(job.id);
      });
    this.tasks.set(job.id, task);
  }
  /** Tests can await a worker without tying its lifetime to an HTTP request. */
  async settled(id: string) {
    await this.tasks.get(id);
  }
  async start(raw: unknown): Promise<ScanJob> {
    await this.initialize();
    const parsed = scanInputSchema.safeParse(raw);
    if (!parsed.success) throw new ScanError(400, "Invalid scan settings");
    const input = parsed.data;
    let points: ScanPoint[];
    try {
      points = scanPoints(input);
    } catch (error) {
      throw new ScanError(422, message(error));
    }
    const view = await this.getView(input.projectId);
    const node = scanNode(view, input);
    let host: string;
    let connector: Connector | undefined;
    let status: GatewaySessionStatus | undefined;
    if (input.locator.kind === "rtu") {
      if (!hasKnxMbmXblVerified())
        throw new ScanError(
          403,
          "The KNX–MBM XBL generator must be verified before RTU scanning. Run verify:xbl with a real fixture.",
        );
      if (!input.sessionId)
        throw new ScanError(
          422,
          "Connect to a KNX–MBM gateway before scanning RTU.",
        );
      status = this.sessions.getStatus(input.sessionId);
      host = status.host;
      if (!status.connected || status.gateway?.appId !== 4)
        throw new ScanError(422, "Connect to a KNX–MBM gateway.");
      if (!status.gateway.serial && !status.gateway.mac)
        throw new ScanError(
          422,
          "The gateway must report a serial number or MAC address for safe restoration.",
        );
      if (
        this.sessions
          .list()
          .some((s) => s.host === host && (s.busy || s.monitoring))
      )
        throw new ScanError(
          409,
          "Stop gateway monitoring and wait for transfers to finish before scanning.",
        );
      connector = this.sessions.scanConnector(input.sessionId);
    } else {
      host = (node as { ip: string }).ip;
      if (!host.trim())
        throw new ScanError(422, "Set the TCP connection IP address first.");
    }
    assertGatewayAvailable(host);
    const id = randomUUID();
    const now = new Date().toISOString();
    const job: ScanJob = {
      id,
      input,
      host,
      controlPort: status?.port,
      serial: status?.gateway?.serial,
      mac: status?.gateway?.mac,
      state: "preparing",
      createdAt: now,
      updatedAt: now,
      cancelRequested: false,
      needsRestore: false,
      batch: 0,
      batches: Math.ceil(points.length / input.batchSize),
      points: points.length,
      processed: 0,
      results: points.map(emptyScanResult),
      targetFingerprint: nodeFingerprint(view, input),
    };
    await this.store.save(job);
    claimGateway(host, id);
    this.jobs.set(id, job);
    this.controllers.set(id, new AbortController());
    this.launch(job, () =>
      input.locator.kind === "rtu"
        ? this.runRtu(job, connector!, view)
        : this.runTcp(job, view),
    );
    return job;
  }
  async cancel(id: string) {
    const job = await this.get(id);
    if (isScanTerminal(job.state) || job.state === "restore-pending")
      return job;
    job.cancelRequested = true;
    this.controllers.get(id)?.abort();
    await this.store.save(job);
    return job;
  }
  async reconnect(sessionId: string) {
    await this.initialize();
    const status = this.sessions.getStatus(sessionId);
    const id = gatewayScanOwner(status.host);
    if (!id || this.tasks.has(id)) return;
    const job = await this.get(id);
    if (job.needsRestore) await this.restore(id, { sessionId });
  }
  async checkReconnect(host: string) {
    await this.initialize();
    const id = gatewayScanOwner(host);
    if (!id) return;
    const job = await this.get(id);
    if (this.tasks.has(id) || !job.needsRestore)
      throw new ScanError(
        409,
        "The scan owns this gateway connection. Wait for restoration before reconnecting.",
      );
  }
  async restore(
    id: string,
    credentials: { sessionId?: string; password?: string },
  ) {
    const job = await this.get(id);
    if (!job.needsRestore)
      throw new ScanError(409, "No backup restoration is pending.");
    if (this.tasks.has(id))
      throw new ScanError(409, "Restoration is already running.");
    let connector: Connector;
    if (credentials.sessionId) {
      const session = this.sessions.getStatus(credentials.sessionId);
      if (session.host !== job.host)
        throw new ScanError(
          422,
          "Reconnect to the gateway that owns this backup.",
        );
      connector = this.sessions.scanConnector(credentials.sessionId);
    } else {
      if (!credentials.password)
        throw new ScanError(
          422,
          "Enter the gateway password to restore the backup.",
        );
      const password = credentials.password;
      connector = async () =>
        this.sessions.connect({
          host: job.host,
          port: job.controlPort,
          password,
        });
    }
    job.state = "restoring";
    await this.store.save(job);
    this.launch(job, () => this.restoreBackup(job, connector));
    return job;
  }
  private identity(job: ScanJob, status: GatewaySessionStatus) {
    if (
      status.gateway?.appId !== 4 ||
      (job.serial && job.serial !== status.gateway.serial) ||
      (job.mac && job.mac !== status.gateway.mac)
    )
      throw new ScanError(
        409,
        "Gateway identity changed. The backup will not be sent to this device.",
      );
  }
  private observe(
    job: ScanJob,
    observation: BusObservation,
    allowed?: Set<string>,
  ) {
    if (job.input.targets?.length) {
      job.observations ??= [];
      for (const row of job.results) {
        if (
          row.function !== observation.function ||
          (allowed && !allowed.has(pointKey(row)))
        )
          continue;
        const quantity = row.quantity ?? 1;
        const offset = row.address - observation.address;
        if (
          observation.values
            ? offset < 0 || offset + quantity > observation.values.length
            : offset !== 0 || observation.quantity !== quantity
        )
          continue;
        if (job.observations.length >= 10000) {
          job.observations.shift();
          job.observationsTruncated = true;
        }
        job.observations.push({
          ...observation,
          address: row.address,
          quantity,
          values: observation.values?.slice(offset, offset + quantity),
        });
        this.observeResult(row, {
          ...observation,
          values: observation.values?.slice(offset, offset + quantity),
        });
      }
      job.processed = job.results.filter((row) => row.attempts >= 2).length;
      return;
    }
    for (let i = 0; i < observation.quantity; i++) {
      const key = `${observation.function}:${observation.address + i}`;
      if (allowed && !allowed.has(key)) continue;
      const row = job.results.find((r) => pointKey(r) === key);
      if (!row) continue;
      this.observeResult(row, {
        ...observation,
        values: observation.values?.slice(i, i + 1),
      });
    }
    job.processed = job.results.filter((row) => row.attempts >= 2).length;
  }
  private observeResult(
    row: ScanJob["results"][number],
    observation: BusObservation,
  ) {
    row.attempts++;
    row.lastAt = observation.at;
    if (observation.values) {
      const value = observation.values[0];
      row.samples++;
      row.lastValue = value;
      if (!row.values.includes(value) && row.values.length < 16)
        row.values.push(value);
      row.changed = row.values.length > 1;
      row.status = "readable";
    } else if (observation.exceptionCode !== undefined) {
      if (!row.exceptionCodes.includes(observation.exceptionCode))
        row.exceptionCodes.push(observation.exceptionCode);
      if (!row.samples) row.status = "exception";
    } else if (observation.timeout) {
      row.timeouts++;
      if (!row.samples && !row.exceptionCodes.length) row.status = "timeout";
    }
  }
  private async runTcp(job: ScanJob, view: ProjectView) {
    const node = scanNode(view, job.input) as {
      port: number;
      rxTimeout: number;
      connTimeout: number;
    };
    const started = Date.now();
    const signal = this.controllers.get(job.id)!.signal;
    const tcp =
      this.tcpRead === readTcpPoint
        ? new ModbusTcpSession(job.host, node.port, job.input.slave)
        : undefined;
    const read = tcp
      ? (
          _host: string,
          _port: number,
          _slave: number,
          point: ScanPoint,
          timeout: number,
          signal: AbortSignal,
        ) => tcp.read(point, timeout, signal)
      : this.tcpRead;
    try {
      job.state = "scanning";
      await this.store.save(job);
      do {
        for (let i = 0; i < job.results.length; i++) {
          if (
            job.cancelRequested ||
            Date.now() - started >= job.input.maxDurationSeconds * 1000
          )
            break;
          job.batch = Math.floor(i / job.input.batchSize) + 1;
          const point = job.results[i];
          for (
            let attempt = 0;
            attempt < 2 && !job.cancelRequested;
            attempt++
          ) {
            const result = await read(
              job.host,
              node.port,
              job.input.slave,
              point,
              Math.min(30000, Math.max(1000, node.rxTimeout, node.connTimeout)),
              signal,
            );
            this.observe(job, {
              ...point,
              quantity: point.quantity ?? 1,
              at: new Date().toISOString(),
              ...result,
            });
          }
          await this.store.save(job);
        }
        if (job.input.observationSeconds && !job.cancelRequested)
          await this.wait(500);
      } while (
        !job.cancelRequested &&
        Date.now() - started <
          Math.min(
            job.input.observationSeconds ?? 0,
            job.input.maxDurationSeconds,
          ) *
            1000
      );
      if (!job.cancelRequested && job.processed < job.points)
        job.error = "Time limit reached. Remaining points are unconfirmed.";
      job.state = job.cancelRequested ? "cancelled" : "completed";
    } catch (error) {
      job.error = message(error);
      job.state = job.cancelRequested ? "cancelled" : "failed";
    } finally {
      tcp?.close();
    }
    await this.store.save(job);
    releaseGateway(job.host, job.id);
  }
  private async runRtu(job: ScanJob, connector: Connector, view: ProjectView) {
    let current: string | undefined;
    let unsubscribe = () => {};
    let captureError: unknown;
    const close = () => {
      unsubscribe();
      unsubscribe = () => {};
      if (current) {
        try {
          this.sessions.disconnect(current);
        } catch {}
        current = undefined;
      }
    };
    const connect = async () => {
      close();
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const status = await connector();
          current = status.id;
          this.identity(job, status);
          return status.id;
        } catch (error) {
          lastError = error;
          close();
          if (error instanceof ScanError) throw error;
          await this.wait(300);
        }
      }
      throw lastError;
    };
    const started = Date.now();
    try {
      await connect();
      const backup = await this.sessions.receiveProject(current!);
      const parsed = parseCompleteBlob(backup);
      const archive = unzipSync(parsed.zip);
      const filename = Object.keys(archive).find((name) =>
        name.endsWith(".ibmaps"),
      );
      assert(filename);
      const live = projectFromXml(
        XmlDocument.parse(new TextDecoder().decode(archive[filename])),
      );
      const selected = scanNode(view, job.input);
      const liveNode = live.mbm.rtuNodes[job.input.locator.nodeIndex];
      assert(liveNode, "RTU node is missing from the live project");
      for (const field of [
        "baudrate",
        "dataBits",
        "parity",
        "stopBits",
        "physicalPort",
      ] as const)
        assert.equal(
          liveNode[field],
          (selected as typeof liveNode)[field],
          "Live RTU settings differ from this project. Receive the gateway project before scanning.",
        );
      // Compile the first batch before arming restoration; invalid plans never write hardware.
      const first = buildScanBatch(
        backup,
        job.input,
        job.results.slice(0, job.input.batchSize),
      );
      await this.store.backup(job.id, backup);
      job.backupHash = hash(backup);
      job.needsRestore = true;
      await this.store.save(job); // Durable before the first SENDCMPLT.
      for (
        let offset = 0;
        offset < job.results.length;
        offset += job.input.batchSize
      ) {
        if (
          job.cancelRequested ||
          Date.now() - started >= job.input.maxDurationSeconds * 1000
        )
          break;
        const batch = job.results.slice(offset, offset + job.input.batchSize);
        const allowed = new Set(batch.map(pointKey));
        const proposal =
          offset === 0 ? first : buildScanBatch(backup, job.input, batch);
        job.batch = Math.floor(offset / job.input.batchSize) + 1;
        job.state = "preparing";
        await this.store.save(job);
        await this.sessions.sendComplete(current!, proposal.blob, {
          name: "Modbus scan",
          comments: "Temporary read-only scan batch",
        });
        await connect();
        const received = await this.sessions.receiveProject(current!);
        assert.equal(
          hash(received),
          hash(proposal.blob),
          "Temporary scan configuration verification failed",
        );
        const decoder = new RtuScanDecoder(
          job.input.slave,
          proposal.bus,
          (observation) => this.observe(job, observation, allowed),
        );
        unsubscribe = this.sessions.subscribe(current!, (event) => {
          if (event.type === "monitor")
            try {
              decoder.feed(event.line, event.at);
            } catch (error) {
              captureError = error;
            }
        });
        job.state = "scanning";
        await this.sessions.setMonitor(current!, true, {
          comms: true,
          debug: true,
        });
        await this.store.save(job);
        const captureStarted = Date.now();
        while (
          !job.cancelRequested &&
          (batch.some((row) => row.attempts < 2) ||
            Date.now() - captureStarted <
              (job.input.observationSeconds ?? 0) * 1000) &&
          Date.now() - started < job.input.maxDurationSeconds * 1000
        ) {
          await this.wait(1000);
          if (captureError) throw captureError;
          if (!this.sessions.getStatus(current!).connected)
            throw new Error("Gateway connection lost during scan");
          await this.store.save(job);
        }
        await this.sessions.setMonitor(current!, false);
        unsubscribe();
        unsubscribe = () => {};
      }
      if (!job.cancelRequested && job.processed < job.points)
        job.error = "Time limit reached. Remaining points are unconfirmed.";
    } catch (error) {
      job.error = message(error);
    } finally {
      if (current) {
        try {
          if (this.sessions.getStatus(current).monitoring)
            await this.sessions.setMonitor(current, false);
        } catch {}
      }
      close();
      if (job.needsRestore) await this.restoreBackup(job, connector);
      else {
        job.state = job.cancelRequested ? "cancelled" : "failed";
        await this.store.save(job);
        releaseGateway(job.host, job.id);
      }
    }
  }
  private async restoreBackup(job: ScanJob, connector: Connector) {
    job.state = "restoring";
    await this.store.save(job);
    const backup = await this.store.readBackup(job.id);
    assert.equal(
      hash(backup),
      job.backupHash,
      "Backup checksum changed; restore refused",
    );
    parseCompleteBlob(backup);
    for (let attempt = 0; attempt < 3; attempt++) {
      let current: string | undefined;
      try {
        const status = await connector();
        current = status.id;
        this.identity(job, status);
        // An interrupted upload or a lost verification ACK may already leave the
        // original installed. Confirm it first rather than writing it again.
        let received = await this.sessions.receiveProject(current);
        if (hash(received) !== job.backupHash) {
          await this.sessions.sendComplete(current, backup, {
            name: "Restore backup",
            comments: "Restore original project after Modbus scan",
          });
          this.sessions.disconnect(current);
          current = undefined;
          const verify = await connector();
          current = verify.id;
          this.identity(job, verify);
          received = await this.sessions.receiveProject(current);
        }
        assert.equal(
          hash(received),
          job.backupHash,
          "Restored project checksum differs from the backup",
        );
        job.restoredHash = hash(received);
        job.needsRestore = false;
        delete job.recoveryError;
        job.state = job.cancelRequested
          ? "cancelled"
          : job.error
            ? "failed"
            : "completed";
        await this.store.save(job);
        releaseGateway(job.host, job.id);
        return;
      } catch (error) {
        job.recoveryError = message(error);
        await this.wait(300);
      } finally {
        if (current)
          try {
            this.sessions.disconnect(current);
          } catch {}
      }
    }
    job.state = "restore-pending";
    await this.store.save(job); // Keep the persistent gateway lock.
  }
}

const globals = globalThis as unknown as {
  __mapsModbusScans?: ModbusScanService;
};
export function getModbusScanService() {
  return (globals.__mapsModbusScans ??= new ModbusScanService());
}
export type ScanSessions = Pick<
  GatewaySessionManager,
  | "getStatus"
  | "list"
  | "scanConnector"
  | "connect"
  | "disconnect"
  | "receiveProject"
  | "sendComplete"
  | "subscribe"
  | "setMonitor"
>;
