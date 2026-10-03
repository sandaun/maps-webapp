import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { buildCompleteBlob, buildProjectZip, extractIbmaps, parseCompleteBlob, XmlDocument } from "@/core/project-format";
import { generateKnxMbmXbl } from "@/gateway-families/knx-mbm/xbl/generate";
import { projectFromXml } from "@/gateway-families/knx-mbm/from-xml";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { runXblPipeline } from "@/gateway-families/knx-mbm/xbl/pipeline";
import type { ProjectView } from "@/server/projects/service";
import type { SessionEventListener, GatewaySessionStatus } from "@/server/intesis-transport";
import { scanInputSchema, pointKey, emptyScanResult } from "@/core/modbus-scan/model";
import { ModbusScanService, type ScanSessions } from "./service";
import { ScanStore } from "./store";
import { assertGatewayAvailable, claimGateway, gatewayScanOwner, withScanOwner } from "./guard";
import { buildScanBatch, crc16, RtuScanDecoder } from "./rtu";

vi.mock("@/server/deploy/capabilities", () => ({ hasKnxMbmXblVerified: () => true }));
let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "maps-scan-")); process.env.MAPS_DATA_DIR = dir; });
afterEach(async () => { delete process.env.MAPS_DATA_DIR; await rm(dir, { recursive: true, force: true }); });
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const xml = SYNTHETIC_KNX_MBM_XML;
const baseline = buildCompleteBlob(generateKnxMbmXbl(xml, { appId: 4, now: new Date(2026, 0, 1) }), buildProjectZip("fixture.ibmaps", xml));
const view = { family: "knx-mbm", project: projectFromXml(XmlDocument.parse(xml)), meta: { id: "test", revision: 1 }, issues: [] } as unknown as ProjectView;
const settings = () => scanInputSchema.parse({ projectId: "test", locator: { kind: "rtu", nodeIndex: 0 }, slave: 1, sessionId: "source", ranges: [1,2,3,4].map((fn) => ({ function: fn, start: 10, end: 11 })), batchSize: 3 });
function frame(bytes: number[]) { const crc = crc16(bytes); return [...bytes, crc & 255, crc >>> 8].map((byte) => byte.toString(16).padStart(2, "0")).join(" "); }

function rig() {
  let active = baseline; let listener: SessionEventListener = () => {}; let index = 0;
  const status = (id = "source"): GatewaySessionStatus => ({ id, host: "192.0.2.10", port: 23, connected: true, encrypted: true, busy: false, monitoring: false, monitorComms: false, monitorDebug: false, connectedAt: new Date().toISOString(), gateway: { appId: 4, serial: "scan-unit", bootloader: false, noApp: false } });
  const flags = { failRestore: false, failTemporary: false, identityChanged: false, blockTemporary: undefined as (() => Promise<void>) | undefined };
  const uploadStates: string[] = [];
  let service: ModbusScanService;
  const sessions: ScanSessions = {
    getStatus: vi.fn((id) => status(id)), list: () => [status()],
    scanConnector: () => async () => ({ ...status(`worker-${++index}`), gateway: { ...status().gateway!, serial: flags.identityChanged ? "other-unit" : "scan-unit" } }),
    connect: async () => status(`worker-${++index}`), disconnect: vi.fn(),
    receiveProject: vi.fn(async () => new Uint8Array(active)),
    sendComplete: vi.fn(async (_id, bytes) => {
      const job = (await service.list())[0]; const persisted = await service.store.read(job.id);
      expect(persisted.needsRestore).toBe(true);
      expect(sha(await service.store.readBackup(job.id))).toBe(persisted.backupHash);
      expect(() => withScanOwner("another-operation", () => assertGatewayAvailable("192.0.2.10"))).toThrow();
      const restore = sha(bytes) === sha(baseline); uploadStates.push(restore ? "restore" : "temporary");
      if (restore && flags.failRestore) throw new Error("Network unavailable");
      active = new Uint8Array(bytes);
      if (!restore && flags.blockTemporary) await flags.blockTemporary();
      if (!restore && flags.failTemporary) throw new Error("Upload acknowledgement lost");
    }),
    subscribe: (_id, next) => { listener = next; return () => { listener = () => {}; }; },
    setMonitor: vi.fn(async (id, enabled) => {
      if (enabled) {
        const compiled = runXblPipeline(XmlDocument.parse(extractIbmaps(parseCompleteBlob(active).zip).xml));
        for (let repeat = 0; repeat < 2; repeat++) for (const point of compiled.mbm.signals.filter((s) => s.configId >= 2)) {
          const address = point.address - point.base; const at = new Date().toISOString();
          const quantity = point.readFunc <= 2 ? 1 : point.dataLength / 16;
          const data = Array.from({ length: quantity }, (_, i) => [address + i >>> 8, address + i & 255]).flat();
          listener({ type: "monitor", at, line: `1MM:RTUB [Tx] ${frame([1, point.readFunc, address >>> 8, address & 255, 0, quantity])}` });
          listener({ type: "monitor", at, line: `1MM:RTUB [Rx] ${frame(point.readFunc <= 2 ? [1, point.readFunc, 1, 1] : [1, point.readFunc, data.length, ...data])}` });
        }
      }
      return status(id);
    }),
  };
  const store = new ScanStore(); service = new ModbusScanService(store, sessions, async () => view, undefined, async () => {});
  return { service, store, sessions, flags, uploadStates, active: () => active };
}

describe("persistent scan and recovery", () => {
  it("captures complete 32/64-bit values through temporary RTU signals and restores the backup", async () => {
    const r = rig(); const input = scanInputSchema.parse({ ...settings(), ranges: [], targets: [{ function: 3, address: 10, quantity: 2 }, { function: 4, address: 20, quantity: 4 }] });
    const job = await r.service.start(input); await r.service.settled(job.id);
    expect(job.state).toBe("completed"); expect(job.processed).toBe(2); expect(job.needsRestore).toBe(false);
    expect(job.observations).toHaveLength(4);
    expect(job.observations?.find((o) => o.function === 3)?.values).toEqual([10, 11]);
    expect(job.observations?.find((o) => o.function === 4)?.values).toEqual([20, 21, 22, 23]);
    expect(job.restoredHash).toBe(sha(baseline));
  });
  it("retries a temporary reconnect while firmware applies the uploaded configuration", async () => {
    const r = rig(); const originalConnector = r.sessions.scanConnector;
    r.sessions.scanConnector = (id) => {
      const connect = originalConnector(id); let calls = 0;
      return async () => { if (++calls === 2) throw new Error("No LOGIN1 response from the gateway"); return connect(); };
    };
    const job = await r.service.start(settings()); await r.service.settled(job.id);
    expect(job.state).toBe("completed"); expect(job.needsRestore).toBe(false); expect(job.processed).toBe(8);
  });
  it("runs multiple read-only batches and restores the exact initial blob once at the end", async () => {
    const r = rig(); const job = await r.service.start(settings()); await r.service.settled(job.id);
    expect(r.uploadStates).toEqual(["temporary", "temporary", "temporary", "restore"]);
    const done = await r.service.get(job.id); expect(done.state).toBe("completed"); expect(done.processed).toBe(8);
    expect(done.results.every((row) => row.samples === 2)).toBe(true); expect(done.restoredHash).toBe(sha(baseline));
    expect(sha(r.active())).toBe(sha(baseline)); expect(gatewayScanOwner(done.host)).toBeUndefined();
    expect((await readFile(path.join(dir, "modbus-scans", job.id, "job.json"), "utf8"))).not.toContain("password");
  });
  it("restores after an ambiguous temporary upload failure", async () => {
    const r = rig(); r.flags.failTemporary = true; const job = await r.service.start(settings()); await r.service.settled(job.id);
    expect(r.uploadStates).toEqual(["temporary", "restore"]); expect((await r.service.get(job.id)).state).toBe("failed"); expect(sha(r.active())).toBe(sha(baseline));
  });
  it("cancellation during a transfer waits for it and then restores", async () => {
    const r = rig(); let release!: () => void; let entered!: () => void;
    const transferStarted = new Promise<void>((resolve) => { entered = resolve; });
    r.flags.blockTemporary = () => { entered(); return new Promise<void>((resolve) => { release = resolve; }); };
    const job = await r.service.start(settings()); await transferStarted;
    await expect(r.service.checkReconnect(job.host)).rejects.toThrow(/owns this gateway connection/);
    await r.service.cancel(job.id); release(); await r.service.settled(job.id);
    expect((await r.service.get(job.id)).state).toBe("cancelled"); expect(r.uploadStates).toEqual(["temporary", "restore"]);
  });
  it("keeps deployment blocked after repeated restore failures and recovers after restart/reconnect", async () => {
    const r = rig(); r.flags.failRestore = true; const job = await r.service.start(settings()); await r.service.settled(job.id);
    expect((await r.service.get(job.id)).state).toBe("restore-pending"); expect(() => assertGatewayAvailable(job.host)).toThrow();
    await expect(r.service.checkReconnect(job.host)).resolves.toBeUndefined();
    const restarted = new ModbusScanService(r.store, r.sessions, async () => view, undefined, async () => {});
    await restarted.initialize(); expect((await restarted.get(job.id)).needsRestore).toBe(true);
    r.flags.failRestore = false; await restarted.reconnect("source"); await restarted.settled(job.id);
    expect((await restarted.get(job.id)).needsRestore).toBe(false); expect(sha(r.active())).toBe(sha(baseline)); expect(() => assertGatewayAvailable(job.host)).not.toThrow();
  });
  it("never uploads if persisting the backup fails", async () => {
    const r = rig(); vi.spyOn(r.store, "backup").mockRejectedValue(new Error("Disk full"));
    const job = await r.service.start(settings()); await r.service.settled(job.id); expect(r.sessions.sendComplete).not.toHaveBeenCalled();
    expect((await r.service.get(job.id)).needsRestore).toBe(false);
  });
  it("refuses a corrupted backup and leaves recovery pending", async () => {
    const r = rig(); r.flags.failRestore = true; const job = await r.service.start(settings()); await r.service.settled(job.id);
    await r.store.backup(job.id, new Uint8Array([1,2,3])); r.flags.failRestore = false;
    const before = r.uploadStates.length; await r.service.restore(job.id, { sessionId: "source" }); await r.service.settled(job.id);
    expect(r.uploadStates.length).toBe(before); expect((await r.service.get(job.id)).state).toBe("restore-pending"); expect(() => assertGatewayAvailable(job.host)).toThrow();
  });
  it("does not send a backup to a different physical gateway", async () => {
    const r = rig(); r.flags.failRestore = true; const job = await r.service.start(settings()); await r.service.settled(job.id);
    r.flags.failRestore = false; r.flags.identityChanged = true;
    const before = r.uploadStates.length; await r.service.restore(job.id, { sessionId: "source" }); await r.service.settled(job.id);
    expect(r.uploadStates.length).toBe(before); expect((await r.service.get(job.id)).recoveryError).toContain("identity changed");
  });
  it("a durable needsRestore journal is discovered even without an active worker", async () => {
    const r = rig(); const input = settings(); const now = new Date().toISOString();
    const job = { id: "crashed", input, host: "192.0.2.10", serial: "scan-unit", state: "scanning" as const, createdAt: now, updatedAt: now, needsRestore: true, cancelRequested: false, backupHash: sha(baseline), batch: 1, batches: 1, points: 1, processed: 0, results: [emptyScanResult({ function: 3, address: 10 })] };
    await r.store.backup(job.id, baseline); await r.store.save(job); claimGateway(job.host, job.id);
    await r.service.initialize(); expect((await r.service.get(job.id)).state).toBe("restore-pending"); expect(() => assertGatewayAvailable(job.host)).toThrow();
  });
});

describe("RTU representation and address handling", () => {
  it("preserves existing signals, uses Port B single-node decoding, and converts base 1 explicitly", () => {
    const doc = XmlDocument.parse(xml); doc.setAttr(["ExternalProtocol", "RtuNodes", "RtuNode", "Device"], "BaseRegister", "1");
    const source = doc.serialize(); const original = buildCompleteBlob(generateKnxMbmXbl(source, { now: new Date(2026,0,1) }), buildProjectZip("test.ibmaps", source));
    const proposed = buildScanBatch(original, settings(), [{ function: 3, address: 10 }]);
    const model = projectFromXml(XmlDocument.parse(extractIbmaps(parseCompleteBlob(proposed.blob).zip).xml));
    expect(model.signals.at(-1)?.modbus.address).toBe(11); expect(model.signals.at(-1)?.modbus.writeFunc).toBe(-1); expect(proposed.bus).toBe("B");
    expect(model.signals.slice(0,2)).toEqual(projectFromXml(doc).signals);
  });
  it("correlates requests, rejects bad CRCs and decodes packed bits", () => {
    const emit = vi.fn(); const decoder = new RtuScanDecoder(1, "B", emit);
    decoder.feed(`1MM:RTUB [Tx] ${frame([1,1,0,5,0,3])}`, "now");
    decoder.feed("1MM:RTUB [Rx] 01 01 01 05 00 00", "now"); expect(emit).not.toHaveBeenCalled();
    decoder.feed(`1MM:RTUA [Rx] ${frame([1,1,1,5])}`, "now"); expect(emit).not.toHaveBeenCalled();
    decoder.feed(`1MM:RTUB [Rx] ${frame([1,1,1,5])}`, "now"); expect(emit.mock.calls[0][0].values).toEqual([1,0,1]); expect(decoder.badFrames).toBe(1);
  });
  it("distinguishes illegal-address replies and timeouts", () => {
    const emit = vi.fn(); const decoder = new RtuScanDecoder(1, "B", emit);
    decoder.feed(`1MM:RTUB [Tx] ${frame([1,3,0,10,0,1])}`, "now"); decoder.feed(`1MM:RTUB [Rx] ${frame([1,131,2])}`, "now");
    expect(emit.mock.calls[0][0].exceptionCode).toBe(2);
    decoder.feed(`1MM:RTUB [Tx] ${frame([1,4,0,11,0,1])}`, "now"); decoder.feed("1MM:RTUB Timeout!", "now"); expect(emit.mock.calls[1][0].timeout).toBe(true);
  });
  it("stops if a Modbus write is seen", () => { const decoder = new RtuScanDecoder(1, "B", () => {}); expect(() => decoder.feed(`1MM:RTUB [Tx] ${frame([1,6,0,10,0,1])}`, "now")).toThrow("write"); });
});
