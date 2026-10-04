import { createServer, type Server, type Socket } from "node:net";
import { afterEach, expect, it } from "vitest";
import { ModbusTcpSession, readTcpPoint } from "./tcp";
let server: Server | undefined;
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});
async function listen(reply: (socket: Socket, request: Buffer) => void) {
  server = createServer((socket) =>
    socket.once("data", (request) => reply(socket, request)),
  );
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return (server.address() as { port: number }).port;
}
function response(pdu: number[]) {
  const bytes = Buffer.alloc(7 + pdu.length);
  bytes.writeUInt16BE(1, 0);
  bytes.writeUInt16BE(pdu.length + 1, 4);
  bytes[6] = 1;
  Buffer.from(pdu).copy(bytes, 7);
  return bytes;
}

async function sessionServer(
  reply: (socket: Socket, request: Buffer, connection: number) => void,
) {
  let connections = 0;
  server = createServer((socket) => {
    const connection = ++connections;
    socket.setNoDelay(true);
    socket.on("data", (request) => {
      if (!socket.writableEnded) reply(socket, request, connection);
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return {
    session: new ModbusTcpSession(
      "127.0.0.1",
      (server.address() as { port: number }).port,
      1,
    ),
    connections: () => connections,
  };
}

function pointReply(request: Buffer) {
  const bytes = response([3, 2, 0, request.readUInt16BE(8)]);
  bytes.writeUInt16BE(request.readUInt16BE(0), 0);
  return bytes;
}

it("works with a device that closes the connection after every response", async () => {
  const { session, connections } = await sessionServer((socket, request) =>
    socket.end(pointReply(request)),
  );
  try {
    for (let address = 1; address <= 4; address++)
      expect(
        await session.read(
          { function: 3, address },
          1000,
          new AbortController().signal,
        ),
      ).toEqual({ values: [address] });
    expect(connections()).toBe(4);
  } finally {
    session.close();
  }
});

it("retries one reused connection closed before a reply with a new transaction ID", async () => {
  const ids: number[] = [];
  const { session, connections } = await sessionServer(
    (socket, request, connection) => {
      ids.push(request.readUInt16BE(0));
      if (connection === 1 && ids.length > 1) socket.end();
      else socket.write(pointReply(request));
    },
  );
  try {
    expect(
      await session.read(
        { function: 3, address: 1 },
        1000,
        new AbortController().signal,
      ),
    ).toEqual({ values: [1] });
    expect(
      await session.read(
        { function: 3, address: 2 },
        1000,
        new AbortController().signal,
      ),
    ).toEqual({ values: [2] });
    expect(connections()).toBe(2);
    expect(new Set(ids).size).toBe(3);
  } finally {
    session.close();
  }
});

it("does not retry indefinitely when the replacement connection also closes", async () => {
  let requests = 0;
  const { session, connections } = await sessionServer((socket, request) => {
    if (++requests === 1) socket.write(pointReply(request));
    else socket.end();
  });
  try {
    await session.read(
      { function: 3, address: 1 },
      1000,
      new AbortController().signal,
    );
    await expect(
      session.read(
        { function: 3, address: 2 },
        1000,
        new AbortController().signal,
      ),
    ).rejects.toThrow("closed");
    expect(connections()).toBe(2);
    expect(requests).toBe(3);
  } finally {
    session.close();
  }
});

it("discards surplus bytes coalesced with a response or arriving while idle", async () => {
  const { session, connections } = await sessionServer((socket, request) => {
    socket.write(
      Buffer.concat([pointReply(request), Buffer.from([0xaa, 0xbb])]),
    );
    setTimeout(() => {
      if (!socket.destroyed) socket.write(Buffer.from([0xcc, 0xdd, 0xee]));
    }, 5);
  });
  try {
    for (let address = 1; address <= 3; address++) {
      expect(
        await session.read(
          { function: 3, address },
          1000,
          new AbortController().signal,
        ),
      ).toEqual({ values: [address] });
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    expect(connections()).toBe(1);
  } finally {
    session.close();
  }
});
it("reuses one socket and distinct transaction IDs for repeated observation reads", async () => {
  let connections = 0;
  const transactions: number[] = [];
  server = createServer((socket) => {
    connections++;
    socket.on("data", (request) => {
      transactions.push(request.readUInt16BE(0));
      const bytes = response([3, 2, 0, request.readUInt16BE(8)]);
      bytes.writeUInt16BE(request.readUInt16BE(0), 0);
      socket.write(bytes.subarray(0, 4));
      socket.write(bytes.subarray(4));
    });
  });
  await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
  const session = new ModbusTcpSession(
    "127.0.0.1",
    (server.address() as { port: number }).port,
    1,
  );
  try {
    for (let address = 1; address <= 5; address++)
      expect(
        await session.read(
          { function: 3, address },
          1000,
          new AbortController().signal,
        ),
      ).toEqual({ values: [address] });
    expect(connections).toBe(1);
    expect(new Set(transactions).size).toBe(5);
  } finally {
    session.close();
  }
});

it("reconnects after a timeout and cannot use the old delayed response for the next read", async () => {
  let connections = 0;
  server = createServer((socket) => {
    const connection = ++connections;
    socket.on("data", (request) => {
      if (connection === 1) return;
      const bytes = response([3, 2, 0, 25]);
      bytes.writeUInt16BE(request.readUInt16BE(0), 0);
      socket.write(bytes);
    });
  });
  await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
  const session = new ModbusTcpSession(
    "127.0.0.1",
    (server.address() as { port: number }).port,
    1,
  );
  try {
    expect(
      await session.read(
        { function: 3, address: 104 },
        20,
        new AbortController().signal,
      ),
    ).toEqual({ timeout: true });
    expect(
      await session.read(
        { function: 3, address: 105 },
        1000,
        new AbortController().signal,
      ),
    ).toEqual({ values: [25] });
    expect(connections).toBe(2);
  } finally {
    session.close();
  }
});

it("cancellation closes a pending persistent session and rejects overlapping transactions", async () => {
  const controller = new AbortController();
  const port = await listen(() => controller.abort());
  const session = new ModbusTcpSession("127.0.0.1", port, 1);
  const pending = session.read(
    { function: 3, address: 104 },
    1000,
    controller.signal,
  );
  await expect(
    session.read({ function: 3, address: 105 }, 1000, controller.signal),
  ).rejects.toThrow("in flight");
  await expect(pending).rejects.toThrow("cancelled");
  session.close();
});

it("handles fragmented TCP replies and checks the requested PDU address", async () => {
  const port = await listen((socket, request) => {
    expect(request.readUInt16BE(8)).toBe(109);
    const bytes = response([3, 2, 0, 1]);
    socket.write(bytes.subarray(0, 4));
    socket.end(bytes.subarray(4));
  });
  expect(
    await readTcpPoint(
      "127.0.0.1",
      port,
      1,
      { function: 3, address: 109 },
      1000,
      new AbortController().signal,
    ),
  ).toEqual({ values: [1] });
});
it("returns Modbus exceptions without treating them as values", async () => {
  const port = await listen((socket) => socket.end(response([131, 2])));
  expect(
    await readTcpPoint(
      "127.0.0.1",
      port,
      1,
      { function: 3, address: 10 },
      1000,
      new AbortController().signal,
    ),
  ).toEqual({ exceptionCode: 2 });
});
it("rejects a response for a different transaction", async () => {
  const port = await listen((socket) => {
    const bytes = response([3, 2, 0, 1]);
    bytes.writeUInt16BE(2, 0);
    socket.end(bytes);
  });
  await expect(
    readTcpPoint(
      "127.0.0.1",
      port,
      1,
      { function: 3, address: 10 },
      1000,
      new AbortController().signal,
    ),
  ).rejects.toThrow("header");
});
it("times out without manufacturing a zero value", async () => {
  const port = await listen(() => {});
  expect(
    await readTcpPoint(
      "127.0.0.1",
      port,
      1,
      { function: 3, address: 10 },
      20,
      new AbortController().signal,
    ),
  ).toEqual({ timeout: true });
});
it("reads all words of a float or 64-bit value in one Modbus transaction", async () => {
  const port = await listen((socket, request) => {
    expect(request.readUInt16BE(10)).toBe(4);
    socket.end(response([3, 8, 0x41, 0xc8, 0, 0, 0x12, 0x34, 0xab, 0xcd]));
  });
  expect(
    await readTcpPoint(
      "127.0.0.1",
      port,
      1,
      { function: 3, address: 104, quantity: 4 },
      1000,
      new AbortController().signal,
    ),
  ).toEqual({ values: [0x41c8, 0, 0x1234, 0xabcd] });
});
