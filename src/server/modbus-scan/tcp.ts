import "server-only";
import { Socket } from "node:net";
import type { ScanPoint } from "@/core/modbus-scan/model";

type TcpResult = {
  values?: number[];
  exceptionCode?: number;
  timeout?: boolean;
};

class TcpConnectionClosedError extends Error {}

/** Sequential transactions share a socket. Timeouts discard it so a delayed
 * reply cannot be mistaken for the next transaction. */
export class ModbusTcpSession {
  private socket?: Socket;
  private received = Buffer.alloc(0);
  private transaction = 0;
  private reading = false;
  private pending?: {
    id: number;
    point: ScanPoint;
    finish: (error?: Error, result?: TcpResult) => void;
  };

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly slave: number,
  ) {}

  private disconnect() {
    const socket = this.socket;
    this.socket = undefined;
    this.received = Buffer.alloc(0);
    socket?.destroy();
  }

  close() {
    this.pending?.finish(new Error("Modbus TCP session closed"));
    this.disconnect();
  }

  private consume(chunk: Buffer) {
    if (!this.pending) {
      this.received = Buffer.alloc(0);
      return;
    }
    this.received = Buffer.concat([this.received, chunk]);
    while (this.received.length >= 7) {
      const length = this.received.readUInt16BE(4);
      const pending = this.pending;
      if (
        !pending ||
        this.received.readUInt16BE(0) !== pending.id ||
        this.received.readUInt16BE(2) !== 0 ||
        this.received[6] !== this.slave ||
        length < 3 ||
        length > 254
      ) {
        pending?.finish(new Error("Invalid Modbus TCP response header"));
        this.disconnect();
        return;
      }
      if (this.received.length < 6 + length) return;
      const pdu = this.received.subarray(7, 6 + length);
      this.received = this.received.subarray(6 + length);
      const quantity = pending.point.quantity ?? 1;
      const fn = pending.point.function;
      if (pdu[0] === (fn | 128) && pdu.length === 2) {
        pending.finish(undefined, { exceptionCode: pdu[1] });
        return;
      }
      const bytes = fn <= 2 ? Math.ceil(quantity / 8) : quantity * 2;
      if (pdu[0] !== fn || pdu[1] !== bytes || pdu.length !== bytes + 2) {
        pending.finish(
          new Error("Invalid Modbus TCP response function or length"),
        );
        return;
      }
      pending.finish(undefined, {
        values: Array.from({ length: quantity }, (_, i) =>
          fn <= 2
            ? (pdu[2 + Math.floor(i / 8)] >>> i % 8) & 1
            : pdu.readUInt16BE(2 + i * 2),
        ),
      });
      // Only one request is outstanding. Surplus data cannot belong to a
      // future transaction and must not prefix its response.
      return;
    }
  }

  async read(
    point: ScanPoint,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<TcpResult> {
    if (this.reading)
      throw new Error("Only one Modbus TCP transaction may be in flight");
    if (signal.aborted) throw new Error("Scan cancelled");
    this.reading = true;
    const startedAt = Date.now();
    const reused = Boolean(
      this.socket && !this.socket.destroyed && !this.socket.readableEnded,
    );
    try {
      try {
        return await this.readOnce(point, timeoutMs, signal);
      } catch (error) {
        if (
          !reused ||
          !(error instanceof TcpConnectionClosedError) ||
          signal.aborted
        )
          throw error;
        const remaining = timeoutMs - (Date.now() - startedAt);
        if (remaining <= 0) return { timeout: true };
        // A peer can close after a reply before Node notices its FIN. Retry
        // that reused connection once, with a fresh ID and the same deadline.
        return await this.readOnce(point, remaining, signal);
      }
    } finally {
      this.reading = false;
    }
  }

  private readOnce(
    point: ScanPoint,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<TcpResult> {
    if (signal.aborted) return Promise.reject(new Error("Scan cancelled"));
    return new Promise((resolve, reject) => {
      const id = (this.transaction = (this.transaction % 65535) + 1);
      let settled = false;
      const finish = (error?: Error, result: TcpResult = {}) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        this.pending = undefined;
        this.received = Buffer.alloc(0);
        if (error || result.timeout) this.disconnect();
        if (error) reject(error);
        else resolve(result);
      };
      const abort = () => finish(new Error("Scan cancelled"));
      const timer = setTimeout(
        () => finish(undefined, { timeout: true }),
        timeoutMs,
      );
      this.pending = { id, point, finish };
      signal.addEventListener("abort", abort, { once: true });
      const request = Buffer.alloc(12);
      request.writeUInt16BE(id, 0);
      request.writeUInt16BE(6, 4);
      request[6] = this.slave;
      request[7] = point.function;
      request.writeUInt16BE(point.address, 8);
      request.writeUInt16BE(point.quantity ?? 1, 10);
      const send = () => {
        if (!settled) this.socket?.write(request);
      };
      if (!this.socket || this.socket.destroyed || this.socket.readableEnded) {
        this.disconnect();
        const socket = new Socket();
        this.socket = socket;
        socket.setNoDelay(true);
        socket.on("data", (bytes) => {
          if (this.socket === socket) this.consume(bytes);
        });
        socket.on("error", (error) => {
          if (this.socket === socket) {
            const code = (error as NodeJS.ErrnoException).code;
            this.pending?.finish(
              this.received.length === 0 &&
                (code === "ECONNRESET" || code === "EPIPE")
                ? new TcpConnectionClosedError(error.message)
                : error,
            );
            this.disconnect();
          }
        });
        const closed = () => {
          if (this.socket !== socket) return;
          this.pending?.finish(
            this.received.length === 0
              ? new TcpConnectionClosedError(
                  "Modbus TCP connection closed before a response",
                )
              : new Error("Modbus TCP connection closed during a response"),
          );
          this.disconnect();
        };
        socket.on("end", closed);
        socket.on("close", closed);
        socket.connect(this.port, this.host, send);
      } else send();
    });
  }
}

export async function readTcpPoint(
  host: string,
  port: number,
  slave: number,
  point: ScanPoint,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<TcpResult> {
  const session = new ModbusTcpSession(host, port, slave);
  try {
    return await session.read(point, timeoutMs, signal);
  } finally {
    session.close();
  }
}
