import { createServer, type Server, type Socket } from "node:net";
import { afterEach, expect, it } from "vitest";
import { readTcpPoint } from "./tcp";
let server: Server | undefined;
afterEach(async () => { if (server) await new Promise<void>((resolve) => server!.close(() => resolve())); server = undefined; });
async function listen(reply: (socket: Socket, request: Buffer) => void) {
  server = createServer((socket) => socket.once("data", (request) => reply(socket, request)));
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve)); return (server.address() as { port: number }).port;
}
function response(pdu: number[]) { const bytes = Buffer.alloc(7 + pdu.length); bytes.writeUInt16BE(1, 0); bytes.writeUInt16BE(pdu.length + 1, 4); bytes[6] = 1; Buffer.from(pdu).copy(bytes, 7); return bytes; }
it("handles fragmented TCP replies and checks the requested PDU address", async () => {
  const port = await listen((socket, request) => { expect(request.readUInt16BE(8)).toBe(109); const bytes = response([3,2,0,1]); socket.write(bytes.subarray(0,4)); socket.end(bytes.subarray(4)); });
  expect(await readTcpPoint("127.0.0.1", port, 1, { function: 3, address: 109 }, 1000, new AbortController().signal)).toEqual({ values: [1] });
});
it("returns Modbus exceptions without treating them as values", async () => {
  const port = await listen((socket) => socket.end(response([131,2])));
  expect(await readTcpPoint("127.0.0.1", port, 1, { function: 3, address: 10 }, 1000, new AbortController().signal)).toEqual({ exceptionCode: 2 });
});
it("rejects a response for a different transaction", async () => {
  const port = await listen((socket) => { const bytes = response([3,2,0,1]); bytes.writeUInt16BE(2,0); socket.end(bytes); });
  await expect(readTcpPoint("127.0.0.1", port, 1, { function: 3, address: 10 }, 1000, new AbortController().signal)).rejects.toThrow("header");
});
it("times out without manufacturing a zero value", async () => {
  const port = await listen(() => {});
  expect(await readTcpPoint("127.0.0.1", port, 1, { function: 3, address: 10 }, 20, new AbortController().signal)).toEqual({ timeout: true });
});
it("reads all words of a float or 64-bit value in one Modbus transaction", async () => {
  const port = await listen((socket, request) => { expect(request.readUInt16BE(10)).toBe(4); socket.end(response([3, 8, 0x41, 0xc8, 0, 0, 0x12, 0x34, 0xab, 0xcd])); });
  expect(await readTcpPoint("127.0.0.1", port, 1, { function: 3, address: 104, quantity: 4 }, 1000, new AbortController().signal)).toEqual({ values: [0x41c8, 0, 0x1234, 0xabcd] });
});
