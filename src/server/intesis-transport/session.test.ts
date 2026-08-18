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
});

describe("fake gateway sanity", () => {
  it("serves the documented INFO keys", () => {
    expect(FAKE_INFO_BODY).toContain("INFO:APPID:4");
  });
});
