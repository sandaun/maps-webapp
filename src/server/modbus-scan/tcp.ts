import "server-only";
import { Socket } from "node:net";
import type { ScanPoint } from "@/core/modbus-scan/model";

/** One request per connection keeps timed-out replies from matching a later point. */
export async function readTcpPoint(host: string, port: number, slave: number, point: ScanPoint, timeoutMs: number, signal: AbortSignal): Promise<{ values?: number[]; exceptionCode?: number; timeout?: boolean }> {
  return new Promise((resolve, reject) => {
    const socket = new Socket(); let received = Buffer.alloc(0); let settled = false;
    const done = (error?: Error, result: { values?: number[]; exceptionCode?: number; timeout?: boolean } = {}) => {
      if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener("abort", abort); socket.destroy();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => done(new Error("Scan cancelled"));
    const timer = setTimeout(() => done(undefined, { timeout: true }), timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    socket.on("error", (error) => done(error));
    socket.on("close", () => { if (!settled) done(new Error("Modbus TCP connection closed before a complete response")); });
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      if (received.length < 7) return;
      const length = received.readUInt16BE(4);
      if (received.readUInt16BE(0) !== 1 || received.readUInt16BE(2) !== 0 || received[6] !== slave || length < 3 || length > 254) { done(new Error("Invalid Modbus TCP response header")); return; }
      if (received.length < 6 + length) return;
      const pdu = received.subarray(7, 6 + length);
      if (pdu[0] === (point.function | 128) && pdu.length === 2) { done(undefined, { exceptionCode: pdu[1] }); return; }
      const quantity = point.quantity ?? 1;
      const bytes = point.function <= 2 ? Math.ceil(quantity / 8) : quantity * 2;
      if (pdu[0] !== point.function || pdu[1] !== bytes || pdu.length !== bytes + 2) { done(new Error("Invalid Modbus TCP response function or length")); return; }
      done(undefined, { values: Array.from({ length: quantity }, (_, i) => point.function <= 2 ? pdu[2 + Math.floor(i / 8)] >>> (i % 8) & 1 : pdu.readUInt16BE(2 + i * 2)) });
    });
    socket.connect(port, host, () => {
      const request = Buffer.alloc(12); request.writeUInt16BE(1, 0); request.writeUInt16BE(6, 4); request[6] = slave;
      request[7] = point.function; request.writeUInt16BE(point.address, 8); request.writeUInt16BE(point.quantity ?? 1, 10); socket.write(request);
    });
  });
}
