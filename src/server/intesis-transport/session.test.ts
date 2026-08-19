import { describe, expect, it } from "vitest";
import { GatewayError, GatewaySession } from "./session";
import { FAKE_INFO_BODY, FakeGateway, makeTestBlob } from "./testing/fake-gateway";

/**
 * Session state machine against the scripted fake gateway (no real network):
 * encrypted login, cleartext fallback, INFO?, RECVCMPLT happy path and the
 * corruption rejections.
 */

const TEST_TIMEOUTS = {
  greetingTimeoutMs: 20,
  lineTimeoutMs: 2_000,
  transferTimeoutMs: 2_000,
  keepAliveIntervalMs: 0,
};

describe("GatewaySession over the fake gateway", () => {
  it("logs in encrypted (LOGIN0/1/2) and completes INFO?", async () => {
    const fake = new FakeGateway({ password: "admin", greeting: Uint8Array.of(0, 0) });
    const session = new GatewaySession(fake, { password: "admin", ...TEST_TIMEOUTS });
    const result = await session.connect();
    expect(result.encrypted).toBe(true);
    expect(result.info.complete).toBe(true);
    expect(result.info.byKey["GWNAME"]).toBe("IN-KNX-MBM-TEST");
    expect(result.info.byKey["APPID"]).toBe("4");
    session.close();
  });

  it("falls back to cleartext when the firmware answers SKT in clear", async () => {
    const fake = new FakeGateway({ password: "admin", cleartext: true, sktCounter: 7 });
    const session = new GatewaySession(fake, { password: "admin", ...TEST_TIMEOUTS });
    const result = await session.connect();
    expect(result.encrypted).toBe(false);
    expect(result.info.byKey["GWNAME"]).toBe("IN-KNX-MBM-TEST");
    session.close();
  });

  it("maps 'Client disconnected' to an auth error", async () => {
    const fake = new FakeGateway({ password: "admin", rejectLogin: true });
    const session = new GatewaySession(fake, { password: "admin", ...TEST_TIMEOUTS });
    await expect(session.connect()).rejects.toMatchObject({
      name: "GatewayError",
      code: "auth",
    });
  });

  it("queries INFO? on demand", async () => {
    const fake = new FakeGateway({ password: "admin" });
    const session = new GatewaySession(fake, { password: "admin", ...TEST_TIMEOUTS });
    await session.connect();
    const info = await session.queryInfo();
    expect(info.byKey["SN"]).toBe("000R12345");
    session.close();
  });

  it("downloads and validates a complete blob via RECVCMPLT + XMODEM-1K", async () => {
    const blob = makeTestBlob();
    const fake = new FakeGateway({ password: "admin", projectBlob: blob });
    const progress: [number, number][] = [];
    const session = new GatewaySession(fake, {
      password: "admin",
      ...TEST_TIMEOUTS,
      progress: (received, total) => progress.push([received, total]),
    });
    await session.connect();
    const data = await session.receiveComplete();
    expect(Buffer.from(data)).toEqual(Buffer.from(blob));
    expect(progress.at(-1)).toEqual([Math.ceil(blob.length / 1024) * 1024, blob.length]);
    session.close();
  });

  it("reports a bare unit as 'no-project' (RECVPROJ:INVALID)", async () => {
    const fake = new FakeGateway({ password: "admin" });
    const session = new GatewaySession(fake, { password: "admin", ...TEST_TIMEOUTS });
    await session.connect();
    await expect(session.receiveComplete()).rejects.toMatchObject({ code: "no-project" });
    session.close();
  });

  it("rejects a blob with a corrupted CRC32 (invalid-blob)", async () => {
    const blob = new Uint8Array(makeTestBlob());
    blob[10] ^= 0xff; // corrupt the XBL payload → CRC32 mismatch
    const fake = new FakeGateway({ password: "admin", projectBlob: blob });
    const session = new GatewaySession(fake, { password: "admin", ...TEST_TIMEOUTS });
    await session.connect();
    await expect(session.receiveComplete()).rejects.toMatchObject({ code: "invalid-blob" });
    session.close();
  });

  it("rejects when the announced length exceeds the received bytes", async () => {
    const blob = makeTestBlob();
    const fake = new FakeGateway({
      password: "admin",
      projectBlob: blob,
      announcedLength: blob.length + 5000,
    });
    const session = new GatewaySession(fake, { password: "admin", ...TEST_TIMEOUTS });
    await session.connect();
    await expect(session.receiveComplete()).rejects.toMatchObject({ code: "transfer" });
    session.close();
  });

  it("works cleartext end-to-end including RECVCMPLT", async () => {
    const blob = makeTestBlob();
    const fake = new FakeGateway({ password: "admin", cleartext: true, projectBlob: blob });
    const session = new GatewaySession(fake, { password: "admin", ...TEST_TIMEOUTS });
    const { encrypted } = await session.connect();
    expect(encrypted).toBe(false);
    const data = await session.receiveComplete();
    expect(Buffer.from(data)).toEqual(Buffer.from(blob));
    session.close();
  });

  it("refuses operations after close", async () => {
    const fake = new FakeGateway({ password: "admin" });
    const session = new GatewaySession(fake, { password: "admin", ...TEST_TIMEOUTS });
    await session.connect();
    session.close();
    await expect(session.queryInfo()).rejects.toBeInstanceOf(GatewayError);
  });

  it("uploads a complete blob via SENDCMPLT + XMODEM-1K (happy path)", async () => {
    const blob = makeTestBlob();
    const fake = new FakeGateway({ password: "admin" });
    const logs: string[] = [];
    const progress: [number, number][] = [];
    const session = new GatewaySession(fake, {
      password: "admin",
      ...TEST_TIMEOUTS,
      log: (line) => logs.push(line),
      progress: (sent, total) => progress.push([sent, total]),
    });
    await session.connect();
    await session.sendComplete(blob, {
      name: "My, Project",
      comments: "deploy, test",
      now: new Date("2026-08-19T10:20:30"),
    });
    // The command went out with sanitized args and the ZIP-only length
    // (blob = [4B len][32B XBL][4B CRC][ZIP] → zipLen = blob.length - 40).
    expect(fake.getSendCommands()).toEqual([
      `SENDCMPLT,My Project,19/08/2026 10:20:30,deploy test,${blob.length - 40}`,
    ]);
    const [received] = fake.getReceivedUploads();
    // CTRL-Z padding of the last 1K packet is included on the wire.
    expect(received.subarray(0, blob.length)).toEqual(blob);
    expect(received.length).toBe(Math.ceil(blob.length / 1024) * 1024);
    expect(progress.at(-1)).toEqual([blob.length, blob.length]);
    expect(logs.some((l) => l.includes("SENDCMPLT sent"))).toBe(true);
    expect(logs.some((l) => l.includes("accepted the upload"))).toBe(true);
    session.close();
  });

  it("uploads only the ZIP via SENDPROJ", async () => {
    const blob = makeTestBlob();
    const zip = blob.subarray(4 + 32 + 4);
    const fake = new FakeGateway({ password: "admin" });
    const session = new GatewaySession(fake, { password: "admin", ...TEST_TIMEOUTS });
    await session.connect();
    await session.sendProject(zip, { now: new Date("2026-08-19T10:20:30") });
    expect(fake.getSendCommands()).toEqual([
      `SENDPROJ,maps-cloud,19/08/2026 10:20:30,no_comments,${zip.length}`,
    ]);
    const [received] = fake.getReceivedUploads();
    expect(received.subarray(0, zip.length)).toEqual(zip);
    session.close();
  });

  it("rejects a malformed blob before touching the wire", async () => {
    const fake = new FakeGateway({ password: "admin" });
    const session = new GatewaySession(fake, { password: "admin", ...TEST_TIMEOUTS });
    await session.connect();
    await expect(session.sendComplete(Uint8Array.of(1, 2, 3))).rejects.toMatchObject({
      code: "invalid-blob",
    });
    expect(fake.getSendCommands()).toEqual([]);
    session.close();
  });

  it("survives a NAK retry scripted by the gateway", async () => {
    const blob = makeTestBlob();
    const fake = new FakeGateway({ password: "admin", sendScript: { nakPacketOnce: 2 } });
    const session = new GatewaySession(fake, { password: "admin", ...TEST_TIMEOUTS });
    await session.connect();
    await session.sendComplete(blob);
    const [received] = fake.getReceivedUploads();
    expect(received.subarray(0, blob.length)).toEqual(blob);
    session.close();
  });

  it("maps a gateway CAN CAN to a transfer error", async () => {
    const blob = makeTestBlob();
    const fake = new FakeGateway({ password: "admin", sendScript: { canAtPacket: 1 } });
    const session = new GatewaySession(fake, { password: "admin", ...TEST_TIMEOUTS });
    await session.connect();
    await expect(session.sendComplete(blob)).rejects.toMatchObject({
      code: "transfer",
      message: expect.stringContaining("cancelled"),
    });
    session.close();
  });

  it("maps CMPLTFILE:ERR after the transfer to a transfer error", async () => {
    const blob = makeTestBlob();
    const fake = new FakeGateway({ password: "admin", sendScript: { rejectAfterTransfer: true } });
    const session = new GatewaySession(fake, { password: "admin", ...TEST_TIMEOUTS });
    await session.connect();
    await expect(session.sendComplete(blob)).rejects.toMatchObject({
      code: "transfer",
      message: expect.stringContaining("rejected"),
    });
    session.close();
  });

  it("maps a refused SENDCMPLT command to a transfer error", async () => {
    const blob = makeTestBlob();
    const fake = new FakeGateway({ password: "admin", sendScript: { refuseCommand: true } });
    const session = new GatewaySession(fake, { password: "admin", ...TEST_TIMEOUTS });
    await session.connect();
    await expect(session.sendComplete(blob)).rejects.toMatchObject({
      code: "transfer",
      message: expect.stringContaining("refused"),
    });
    session.close();
  });

  it("uploads over a cleartext (SKT) session too", async () => {
    const blob = makeTestBlob();
    const fake = new FakeGateway({ password: "admin", cleartext: true });
    const session = new GatewaySession(fake, { password: "admin", ...TEST_TIMEOUTS });
    const { encrypted } = await session.connect();
    expect(encrypted).toBe(false);
    await session.sendComplete(blob);
    const [received] = fake.getReceivedUploads();
    expect(received.subarray(0, blob.length)).toEqual(blob);
    session.close();
  });
});

describe("fake gateway sanity", () => {
  it("serves the documented INFO keys", () => {
    expect(FAKE_INFO_BODY).toContain("INFO:APPID:4");
  });
});
