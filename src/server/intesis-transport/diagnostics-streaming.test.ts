// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { GatewaySession } from "./session";
import { GatewaySessionManager } from "./manager";
import { FakeGateway } from "./testing/fake-gateway";
import { readDiagnosticHistory } from "./diagnostics-archive";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), "maps-streaming-")); process.env.MAPS_DATA_DIR = directory; });
afterEach(async () => { delete process.env.MAPS_DATA_DIR; await rm(directory, { recursive: true, force: true }); });

describe("diagnostics transport under load", () => {
  it("sends prefixed SPONS keepalive on all family ports and never restarts disabled COMMS", async () => {
    const fake = new FakeGateway({ password: "", infoBody: "INFO:APPID:64\r\n" });
    const session = new GatewaySession(fake, { password: "", greetingTimeoutMs: 1, keepAliveIntervalMs: 100 });
    try {
      await session.connect();
      await session.setMonitor(true, () => {}, { comms: false, debug: false });
      const before = fake.consoleCommands.length;
      await vi.waitFor(() => expect(fake.consoleCommands.slice(before)).toEqual(["0MS:SPONS=1", "1ME:SPONS=1"]), { interval: 10 });
      await session.setMonitor(false);
      const disabled = fake.consoleCommands.length;
      await vi.waitFor(() => expect(fake.consoleCommands.slice(disabled)).toEqual(["0MS:SPONS=0", "1ME:SPONS=0"]), { interval: 10 });
      expect(session.monitoring).toBe(false);
    } finally { session.close(); }
  });

  it("does not inject keepalive into a pending console command", async () => {
    const fake = new FakeGateway({ password: "" });
    const session = new GatewaySession(fake, { password: "", greetingTimeoutMs: 1, keepAliveIntervalMs: 100 });
    try {
      await session.connect();
      await session.setMonitor(true, () => {});
      const pending = session.runConsoleCommand("HELP?", { idleMs: 350 });
      const before = fake.consoleCommands.length;
      await new Promise((resolve) => setTimeout(resolve, 220));
      expect(fake.consoleCommands.length).toBe(before);
      await pending;
      expect(session.connected).toBe(true);
    } finally { session.close(); }
  });

  it("drains 30,000 encrypted lines in order, yields to timers and captures independently of a failed viewer", async () => {
    const fake = new FakeGateway({ password: "", monitorLines: [] });
    const manager = new GatewaySessionManager(async () => fake);
    const { id } = await manager.connect({ host: "192.0.2.1", password: "" });
    let last = 0;
    let timerRanAt = -1;
    const observed: number[] = [];
    const unsubscribe = manager.subscribe(id, (event) => {
      if (event.type === "monitor" && event.line.startsWith("BURST:")) {
        last = Number(event.line.slice(6)); observed.push(last);
      }
    });
    try {
      await manager.setMonitor(id, true);
      expect(() => manager.subscribe(id, () => { throw new Error("viewer canceled during replay"); })).not.toThrow();
      manager.subscribe(id, (event) => { if (event.type === "monitor" && event.line.startsWith("BURST:")) throw new Error("viewer canceled"); });
      await manager.runConsoleCommand(id, "  PWD=capture-secret  ", { idleMs: 1, timeoutMs: 100 });
      await manager.flushArchive(id);
      const startup = await readDiagnosticHistory(id);
      expect(startup.entries.map((entry) => entry.line).join("\n")).not.toContain("capture-secret");
      expect(startup.entries.some((entry) => entry.line === "# Console: PWD=[redacted]")).toBe(true);
      await manager.setRecording(id, true);
      await manager.setMonitor(id, false); // Leaving the screen preserves recording.
      expect(manager.getStatus(id)).toMatchObject({ monitoring: true, recording: true });
      for (let start = 1; start <= 30_000; start += 3000) {
        fake.emitConsoleLines(Array.from({ length: 3000 }, (_, i) => `BURST:${start + i}`));
        if (start === 1) setTimeout(() => { timerRanAt = last; }, 0);
        await vi.waitFor(() => expect(last).toBe(start + 2999), { interval: 5, timeout: 3000 });
        await manager.flushArchive(id);
      }
      expect(observed).toEqual(Array.from({ length: 30_000 }, (_, i) => i + 1));
      expect(timerRanAt).toBeLessThan(3000);
      expect(manager.getStatus(id).connected).toBe(true);
      expect(manager.getStatus(id).archive).toMatchObject({ count: expect.any(Number), dropped: 0 });
      await manager.setRecording(id, false);
      await manager.setMonitor(id, false);
      await manager.flushArchive(id);
      const history = await readDiagnosticHistory(id);
      expect(history.entries.at(-1)!.line).toBe("BURST:30000");
      manager.disconnect(id);
      await manager.flushArchive(id);
      const closed = await readDiagnosticHistory(id);
      expect(closed.entries.some((entry) => entry.line === "BURST:30000")).toBe(true);
      expect(closed.archive.closedAt).toBeDefined();
    } finally {
      unsubscribe();
      if (manager.list().some((session) => session.id === id)) manager.disconnect(id);
      await manager.flushArchive(id);
      fake.close();
    }
  }, 15_000);

  it("retains the transport error and clears monitoring on disconnect", async () => {
    const fake = new FakeGateway({ password: "" });
    fake.getCloseReason = () => "TCP ECONNRESET: connection reset by peer";
    const log: string[] = [];
    const disconnected = vi.fn();
    const session = new GatewaySession(fake, { password: "", greetingTimeoutMs: 1, keepAliveIntervalMs: 0, log: (line) => log.push(line), disconnected });
    try {
      await session.connect();
      await session.setMonitor(true, () => {});
      fake.close();
      await vi.waitFor(() => expect(session.connected).toBe(false));
      expect(session.monitoring).toBe(false);
      expect(log.at(-1)).toContain("ECONNRESET");
      expect(disconnected).toHaveBeenCalledWith("TCP ECONNRESET: connection reset by peer");
    } finally { session.close(); }
  });
});
