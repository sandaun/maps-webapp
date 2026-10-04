import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SerialDuplex, listGatewaySerialPorts } from "./serial";

const driver = vi.hoisted(() => ({
  instances: [] as MockPort[],
  openError: null as Error | null,
  setError: null as Error | null,
  stallOpen: false,
}));

class MockPort extends EventEmitter {
  isOpen = false;
  openCallback?: (error: Error | null) => void;
  readonly writes: Buffer[] = [];
  set = vi.fn((_options: Record<string, unknown>, callback: (error: Error | null) => void) => callback(driver.setError));
  close = vi.fn((callback: () => void) => { this.isOpen = false; this.emit("close"); callback(); });
  constructor(readonly options: Record<string, unknown>) {
    super();
    driver.instances.push(this);
  }
  open(callback: (error: Error | null) => void) {
    this.openCallback = callback;
    if (driver.stallOpen) return;
    this.isOpen = !driver.openError;
    callback(driver.openError);
  }
  write(data: Buffer, callback: (error: Error | null) => void) {
    this.writes.push(data);
    callback(null);
  }
}

vi.mock("serialport", () => ({
  SerialPort: class {
    static list = vi.fn(async () => [{ path: "COM3", manufacturer: "Intesis" }]);
    constructor(options: Record<string, unknown>) { return new MockPort(options); }
  },
}));

beforeEach(() => {
  driver.instances = [];
  driver.openError = null;
  driver.setError = null;
  driver.stallOpen = false;
});
afterEach(() => vi.useRealTimers());

describe("SerialDuplex", () => {
  it("enumerates ports without opening or probing them", async () => {
    expect((await listGatewaySerialPorts()).ports).toEqual([{ path: "COM3", manufacturer: "Intesis" }]);
    expect(driver.instances).toHaveLength(0);
  });

  it("configures the MAPS console and preserves binary bytes in both directions", async () => {
    const link = await SerialDuplex.connect("COM3", 1000);
    const port = driver.instances[0];
    expect(port.options).toMatchObject({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: "none", rtscts: false });
    expect(port.set).toHaveBeenCalledWith({ dtr: true, rts: true }, expect.any(Function));
    const bytes = Uint8Array.of(0, 255, 13, 10, 0x1a);
    link.write(bytes);
    expect(new Uint8Array(port.writes[0])).toEqual(bytes);
    port.emit("data", Buffer.from(bytes));
    expect(await link.read(100)).toEqual(bytes);
    const waiting = link.read(100);
    link.close();
    expect(await waiting).toBe(null);
    expect(() => link.write(bytes)).toThrow(/closed/);
  });

  it("removes a timed-out read so it cannot consume the next chunk", async () => {
    const link = await SerialDuplex.connect("COM3", 1000);
    expect(await link.read(1)).toEqual(new Uint8Array(0));
    driver.instances[0].emit("data", Buffer.from([7]));
    expect(await link.read(100)).toEqual(Uint8Array.of(7));
    link.close();
  });

  it("rejects a busy port and cleans up after a control-line error", async () => {
    driver.openError = new Error("Access denied");
    await expect(SerialDuplex.connect("COM3", 1000)).rejects.toThrow("Access denied");
    driver.openError = null;
    driver.setError = new Error("Cannot set RTS");
    await expect(SerialDuplex.connect("COM3", 1000)).rejects.toThrow("Cannot set RTS");
    expect(driver.instances[1].close).toHaveBeenCalled();
  });

  it("releases a port that finishes opening after the connect timeout", async () => {
    vi.useFakeTimers();
    driver.stallOpen = true;
    const connecting = SerialDuplex.connect("COM3", 100);
    const rejected = expect(connecting).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    const port = driver.instances[0];
    port.isOpen = true;
    port.openCallback?.(null);
    expect(port.close).toHaveBeenCalled();
  });

  it("handles an unplug/error by releasing pending reads", async () => {
    const link = await SerialDuplex.connect("COM3", 1000);
    const waiting = link.read(100);
    driver.instances[0].emit("error", new Error("Device unplugged"));
    expect(await waiting).toBe(null);
    expect(await link.read(100)).toBe(null);
  });
});
