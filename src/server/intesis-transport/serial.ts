import "server-only";
import { release } from "node:os";
import { SerialPort } from "serialport";
import type { Duplex } from "./transport";

export interface GatewaySerialPort {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
}

/** Lists candidates only: listing must never send commands to unrelated devices. */
export async function listGatewaySerialPorts(): Promise<{ ports: GatewaySerialPort[]; isWsl: boolean }> {
  const ports = await SerialPort.list();
  return {
    ports: ports.map(({ path, manufacturer, serialNumber, vendorId, productId }) =>
      ({ path, manufacturer, serialNumber, vendorId, productId })),
    isWsl: /microsoft/i.test(release()),
  };
}

/** MAPS ConnectSerialPort: 115200 8N1, DTR/RTS enabled, raw binary XMODEM. */
export class SerialDuplex implements Duplex {
  private queue: Uint8Array[] = [];
  private waiters: ((chunk: Uint8Array | null) => void)[] = [];
  private closed = false;

  private constructor(private readonly port: SerialPort) {
    port.on("data", (data: Buffer) => {
      if (this.closed) return;
      const chunk = new Uint8Array(data);
      const waiter = this.waiters.shift();
      if (waiter) waiter(chunk);
      else this.queue.push(chunk);
    });
    port.on("close", () => this.end());
    port.on("error", () => this.close());
  }

  static connect(path: string, timeoutMs: number): Promise<SerialDuplex> {
    return new Promise((resolve, reject) => {
      const port = new SerialPort({
        path, baudRate: 115200, dataBits: 8, stopBits: 1, parity: "none",
        rtscts: false, autoOpen: false,
      });
      const duplex = new SerialDuplex(port);
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        duplex.close();
        reject(new Error(`USB port ${path}: ${error.message}`));
      };
      const timer = setTimeout(() => fail(new Error("Opening the serial port timed out")), timeoutMs);
      port.open((error) => {
        if (settled) {
          // Release a handle even if opening completed after the timeout.
          if (port.isOpen) port.close(() => {});
          return;
        }
        if (error) return fail(error);
        port.set({ dtr: true, rts: true }, (error) => {
          if (settled) return;
          if (error) return fail(error);
          settled = true;
          clearTimeout(timer);
          resolve(duplex);
        });
      });
    });
  }

  write(data: Uint8Array): void {
    if (this.closed) throw new Error("USB connection is closed");
    this.port.write(Buffer.from(data), (error) => {
      if (error) this.close();
    });
  }

  read(timeoutMs: number): Promise<Uint8Array | null> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      const onData = (chunk: Uint8Array | null) => {
        clearTimeout(timer);
        resolve(chunk);
      };
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(onData);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve(new Uint8Array(0));
      }, timeoutMs);
      this.waiters.push(onData);
    });
  }

  private end(): void {
    this.closed = true;
    this.queue = [];
    for (const waiter of this.waiters.splice(0)) waiter(null);
  }

  close(): void {
    this.end();
    if (this.port.isOpen) this.port.close(() => {});
  }
}
