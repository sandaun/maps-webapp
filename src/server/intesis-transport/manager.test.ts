import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { claimGateway, releaseGateway, withScanOwner } from "../modbus-scan/guard";
import {
  GatewayRequestError,
  GatewaySessionManager,
  toGatewayRequestError,
  type SessionEvent,
} from "./manager";
import { GatewayError } from "./session";
import { FakeGateway, makeTestBlob, type FakeGatewayConfig } from "./testing/fake-gateway";

/** Manager wired to fake gateways instead of real TCP. */
function makeManager(configs: Record<string, FakeGatewayConfig>) {
  return new GatewaySessionManager((host) => {
    const config = configs[host];
    if (!config) return Promise.reject(new Error(`unknown host ${host}`));
    return Promise.resolve(new FakeGateway(config));
  });
}

describe("GatewaySessionManager", () => {
  it("hands the existing connection to the scan and prevents browser disconnection", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "maps-scan-owner-"));
    const previous = process.env.MAPS_DATA_DIR; process.env.MAPS_DATA_DIR = dataDir;
    let connections = 0;
    const manager = new GatewaySessionManager(async () => {
      connections++; return new FakeGateway({ password: "worker-password" });
    });
    try {
      const source = await manager.connect({ host: "192.0.2.222", password: "worker-password" });
      const connector = manager.scanConnector(source.id);
      claimGateway(source.host, "scan-job");
      const worker = await withScanOwner("scan-job", connector);
      expect(worker.id).toBe(source.id); expect(connections).toBe(1);
      expect(manager.list()).toEqual([]);
      expect(() => manager.disconnect(source.id)).toThrow(/active scan/);
      withScanOwner("scan-job", () => manager.disconnect(worker.id));
      const reconnected = await withScanOwner("scan-job", connector);
      expect(connections).toBe(2); expect(reconnected.id).not.toBe(source.id);
      expect(manager.list()).toEqual([]);
      withScanOwner("scan-job", () => manager.disconnect(reconnected.id));
      releaseGateway(source.host, "scan-job");
    } finally {
      if (previous === undefined) delete process.env.MAPS_DATA_DIR; else process.env.MAPS_DATA_DIR = previous;
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
  it("connects, reports status and disconnects (password never serialized)", async () => {
    const manager = makeManager({ "10.0.0.1": { password: "admin" } });
    const status = await manager.connect({ host: "10.0.0.1", password: "admin" });
    expect(status.connected).toBe(true);
    expect(status.encrypted).toBe(true);
    expect(status.port).toBe(23);
    expect(status.gateway?.name).toBe("IN-KNX-MBM-TEST");
    expect(JSON.stringify(manager.list())).not.toContain("admin");
    manager.disconnect(status.id);
    expect(manager.list()).toEqual([]);
    expect(() => manager.getStatus(status.id)).toThrow(GatewayRequestError);
  });

  it("tracks the local project selected in a session and clears it on disconnect", async () => {
    const manager = makeManager({ "10.0.0.8": { password: "admin" } });
    const { id } = await manager.connect({ host: "10.0.0.8", password: "admin" });
    expect(manager.setProjectId(id, "project-a").projectId).toBe("project-a");
    expect(manager.list()[0].projectId).toBe("project-a");
    expect(manager.setProjectId(id, null).projectId).toBeUndefined();
    manager.disconnect(id);
    expect(manager.list()).toEqual([]);
  });

  it("queries INFO? and receives a project blob", async () => {
    const blob = makeTestBlob();
    const manager = makeManager({ "10.0.0.2": { password: "admin", projectBlob: blob } });
    const { id } = await manager.connect({ host: "10.0.0.2", password: "admin" });
    const info = await manager.queryInfo(id);
    expect(info.serial).toBe("000R12345");
    const data = await manager.receiveProject(id);
    expect(Buffer.from(data)).toEqual(Buffer.from(blob));
  });

  it("streams log/progress events with history replay for late subscribers", async () => {
    const blob = makeTestBlob();
    const manager = makeManager({ "10.0.0.3": { password: "admin", projectBlob: blob } });
    const { id } = await manager.connect({ host: "10.0.0.3", password: "admin" });
    const events: SessionEvent[] = [];
    manager.subscribe(id, (e) => events.push(e));
    await manager.receiveProject(id);
    expect(events.some((e) => e.type === "log" && e.line.includes("RECVCMPLT"))).toBe(true);
    expect(events.some((e) => e.type === "progress")).toBe(true);
    // Late subscriber gets the replayed history.
    const replayed: SessionEvent[] = [];
    manager.subscribe(id, (e) => replayed.push(e));
    expect(replayed.length).toBeGreaterThan(0);
  });

  it("maps transport errors to HTTP statuses", async () => {
    const manager = makeManager({ "10.0.0.4": { password: "admin" } }); // no project
    const { id } = await manager.connect({ host: "10.0.0.4", password: "admin" });
    await expect(manager.receiveProject(id)).rejects.toMatchObject({ status: 404 });
  });

  it("rejects unknown sessions with 404", () => {
    const manager = makeManager({});
    expect(() => manager.getStatus("nope")).toThrowError(
      expect.objectContaining({ status: 404 }) as Error,
    );
  });

  it("maps gateway rejections to 401", async () => {
    const manager = makeManager({ "10.0.0.5": { password: "admin", rejectLogin: true } });
    await expect(manager.connect({ host: "10.0.0.5", password: "admin" })).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe("toGatewayRequestError", () => {
  it.each([
    ["busy", 409],
    ["no-project", 404],
    ["auth", 401],
    ["timeout", 504],
    ["connect", 502],
    ["protocol", 502],
    ["transfer", 502],
    ["invalid-blob", 502],
    ["closed", 502],
  ] as const)("maps %s → %d", (code, status) => {
    expect(toGatewayRequestError(new GatewayError(code, "x")).status).toBe(status);
  });

  it("passes GatewayRequestError through", () => {
    const err = new GatewayRequestError(418, "teapot");
    expect(toGatewayRequestError(err)).toBe(err);
  });
});
