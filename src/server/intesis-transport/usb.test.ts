import { describe, expect, it, vi } from "vitest";
import { GatewaySession } from "./session";
import { GatewaySessionManager } from "./manager";
import { FakeGateway, makeTestBlob } from "./testing/fake-gateway";

describe("USB gateway sessions", () => {
  it("skips LOGIN, receives and sends binary projects and runs the diagnostics console", async () => {
    const blob = makeTestBlob();
    const fake = new FakeGateway({ usb: true, password: "unused", projectBlob: blob });
    const writes = vi.spyOn(fake, "write");
    const session = new GatewaySession(fake, {
      transport: "usb", password: "", keepAliveIntervalMs: 0,
      lineTimeoutMs: 500, transferTimeoutMs: 500,
    });
    try {
      const result = await session.connect();
      expect(result.encrypted).toBe(false);
      expect(result.info.byKey.APPID).toBe("4");
      expect(new TextDecoder().decode(writes.mock.calls[0][0])).toBe("\r\n");
      expect(fake.consoleCommands).toContain("INFO?");
      expect(writes.mock.calls.some(([bytes]) => new TextDecoder().decode(bytes).includes("LOGIN"))).toBe(false);
      expect(await session.receiveComplete()).toEqual(blob);
      await session.sendComplete(blob);
      expect(fake.getReceivedUploads()).toHaveLength(1);
      expect(fake.getReceivedUploads()[0].slice(0, blob.length)).toEqual(blob);
      const response = await session.runConsoleCommand("APPINFO?", { doneWhen: (line) => line.includes("APPINFO:END") });
      expect(response.lines).toContain("APPINFO:END");
      await session.setMonitor(true, () => {});
      expect(fake.consoleCommands).toContain("0KX:SPONS=1");
      await session.setMonitor(false);
    } finally {
      session.close();
    }
  });

  it("routes USB to the serial factory and releases the port on disconnect", async () => {
    const fake = new FakeGateway({ usb: true, password: "" });
    const tcp = vi.fn();
    const serial = vi.fn(async () => fake);
    const manager = new GatewaySessionManager(tcp, serial);
    const status = await manager.connect({ transport: "usb", host: "COM3", password: "" });
    try {
      expect(tcp).not.toHaveBeenCalled();
      expect(serial).toHaveBeenCalledWith("COM3", 5000);
      expect(status).toMatchObject({ host: "COM3", transport: "usb", connected: true, encrypted: false });
      expect((await manager.queryInfo(status.id)).appId).toBe(4);
    } finally {
      manager.disconnect(status.id);
    }
    expect(fake.closed).toBe(true);
  });

  it("closes a serial session whose INFO response is incomplete", async () => {
    const fake = new FakeGateway({ usb: true, password: "", infoBody: "" });
    const manager = new GatewaySessionManager(vi.fn(), async () => fake);
    // INFO:END alone is valid, so simulate a closed port instead.
    vi.spyOn(fake, "read").mockResolvedValue(null);
    await expect(manager.connect({ transport: "usb", host: "/dev/ttyACM0", password: "" }))
      .rejects.toMatchObject({ status: 502 });
    expect(fake.closed).toBe(true);
    expect(manager.list()).toEqual([]);
  });
});
