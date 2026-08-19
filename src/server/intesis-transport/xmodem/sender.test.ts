import { describe, expect, it } from "vitest";
import { ACK, CAN, CRC_REQ, EOT, NAK, SOH, STX, XmodemReceiver, XmodemSender } from "./index";

/** Drive sender and receiver against each other until one terminates. */
function loopback(
  data: Uint8Array,
  opts: { tamper?: (packet: Uint8Array, packetNo: number) => Uint8Array } = {},
) {
  const tx = new XmodemSender(data);
  const rx = new XmodemReceiver();
  let txStep = tx.begin();
  expect(txStep.send.length).toBe(0);
  let rxStep = rx.push(new Uint8Array());
  let rxOutbox = rx.begin(); // 'C' sync request
  let packets = 0;
  for (let guard = 0; guard < 10_000; guard++) {
    if (txStep.status !== "active") break;
    if (rxOutbox.length > 0) {
      txStep = tx.push(rxOutbox);
      rxOutbox = new Uint8Array(0);
      continue;
    }
    if (txStep.send.length > 0) {
      let wire = txStep.send;
      if (wire[0] === STX || wire[0] === SOH) {
        packets++;
        wire = opts.tamper?.(wire, packets) ?? wire;
      }
      rxStep = rx.push(wire);
      rxOutbox = rxStep.send;
      txStep = { ...txStep, send: new Uint8Array(0) };
      continue;
    }
    throw new Error("loopback stalled: neither side has anything to send");
  }
  return { tx, rx, txStep, rxStep, packets };
}

describe("XmodemSender", () => {
  it("round-trips arbitrary data sender → receiver (XMODEM-1K, CRC16)", () => {
    const data = Uint8Array.from({ length: 2500 }, (_, i) => (i * 7 + 3) & 0xff);
    const { txStep, rxStep, packets } = loopback(data);
    expect(txStep.status).toBe("done");
    expect(rxStep.status).toBe("done");
    expect(packets).toBe(3);
    // CTRL-Z padding of the last packet included; caller trims.
    expect(rxStep.data!.subarray(0, data.length)).toEqual(data);
    expect(txStep.sentBytes).toBe(data.length);
  });

  it("sends exactly one padded packet for payloads ≤ 1024 bytes", () => {
    const data = Uint8Array.from({ length: 100 }, (_, i) => i);
    const { txStep, rxStep, packets } = loopback(data);
    expect(txStep.status).toBe("done");
    expect(packets).toBe(1);
    expect(rxStep.data!.length).toBe(1024);
    expect(rxStep.data!.subarray(0, 100)).toEqual(data);
  });

  it("goes straight to EOT for an empty payload", () => {
    const tx = new XmodemSender(new Uint8Array(0));
    const step = tx.push(Uint8Array.of(CRC_REQ));
    expect(step.send).toEqual(Uint8Array.of(EOT));
    expect(tx.push(Uint8Array.of(ACK)).status).toBe("done");
  });

  it("retransmits the current packet on NAK and still completes", () => {
    const data = Uint8Array.from({ length: 1500 }, (_, i) => i & 0xff);
    const tx = new XmodemSender(data);
    const rx = new XmodemReceiver();
    const first = tx.push(rx.begin()); // 'C' → first packet on the wire
    expect(first.send.length).toBeGreaterThan(0);
    // Receiver rejects it (NAK): the sender must retransmit the SAME packet.
    const retry = tx.push(Uint8Array.of(NAK));
    expect(retry.send).toEqual(first.send);
    expect(retry.status).toBe("active");
    // The retransmission is accepted and the transfer completes.
    let rxStep = rx.push(retry.send);
    let txStep = tx.push(rxStep.send);
    for (let guard = 0; guard < 100 && txStep.status === "active"; guard++) {
      if (txStep.send.length > 0) rxStep = rx.push(txStep.send);
      if (rxStep.send.length === 0) break;
      txStep = tx.push(rxStep.send);
    }
    expect(txStep.status).toBe("done");
    expect(rxStep.data!.subarray(0, data.length)).toEqual(data);
  });

  it("fails with CAN CAN CAN after 25 unacknowledged retransmissions", () => {
    const tx = new XmodemSender(Uint8Array.from({ length: 10 }, (_, i) => i));
    tx.push(Uint8Array.of(CRC_REQ));
    let last = tx.push(Uint8Array.of(NAK));
    for (let i = 0; i < 30 && last.status === "active"; i++) {
      last = tx.push(Uint8Array.of(NAK));
    }
    expect(last.status).toBe("failed");
    expect(last.send).toEqual(Uint8Array.of(CAN, CAN, CAN));
    expect(last.error).toMatch(/packet 1/);
  });

  it("aborts with ACK when the receiver cancels (CAN CAN)", () => {
    const tx = new XmodemSender(Uint8Array.from({ length: 10 }, (_, i) => i));
    tx.push(Uint8Array.of(CRC_REQ));
    const step = tx.push(Uint8Array.of(CAN, CAN));
    expect(step.status).toBe("cancelled");
    expect(step.send).toEqual(Uint8Array.of(ACK));
  });

  it("re-sends EOT on timeout and fails after 10 attempts", () => {
    const tx = new XmodemSender(Uint8Array.of(1, 2, 3));
    tx.push(Uint8Array.of(CRC_REQ)); // packet 1 on the wire
    const eot = tx.push(Uint8Array.of(ACK)); // packet acked → EOT
    expect(eot.send).toEqual(Uint8Array.of(EOT));
    let last = eot;
    for (let i = 0; i < 12 && last.status === "active"; i++) {
      last = tx.onTimeout();
      if (last.status === "active") expect(last.send).toEqual(Uint8Array.of(EOT));
    }
    expect(last.status).toBe("failed");
    expect(last.error).toMatch(/EOT/);
  });

  it("fails with CAN CAN CAN when no sync byte ever arrives", () => {
    const tx = new XmodemSender(Uint8Array.of(1));
    let last = tx.begin();
    for (let i = 0; i < 20 && last.status === "active"; i++) last = tx.onTimeout();
    expect(last.status).toBe("failed");
    expect(last.send).toEqual(Uint8Array.of(CAN, CAN, CAN));
    expect(last.error).toMatch(/sync/);
  });

  it("supports checksum mode when the receiver syncs with NAK", () => {
    const data = Uint8Array.from({ length: 10 }, (_, i) => i * 3);
    const tx = new XmodemSender(data);
    const step = tx.push(Uint8Array.of(NAK));
    expect(step.send[0]).toBe(STX);
    // Trailer is a single 8-bit checksum of the padded payload.
    expect(step.send.length).toBe(3 + 1024 + 1);
    let sum = 0;
    for (const b of step.send.subarray(3, 3 + 1024)) sum = (sum + b) & 0xff;
    expect(step.send[step.send.length - 1]).toBe(sum);
  });

  it("supports 128-byte SOH packets with use1k: false", () => {
    const data = Uint8Array.from({ length: 300 }, (_, i) => i & 0xff);
    const tx = new XmodemSender(data, { use1k: false });
    const rx = new XmodemReceiver();
    let txStep = tx.push(rx.begin());
    expect(txStep.send[0]).toBe(SOH);
    expect(txStep.send.length).toBe(3 + 128 + 2);
    let rxStep = rx.push(txStep.send);
    for (let guard = 0; guard < 100 && txStep.status === "active"; guard++) {
      txStep = tx.push(rxStep.send);
      if (txStep.send.length === 0) break;
      rxStep = rx.push(txStep.send);
    }
    expect(rxStep.status).toBe("done");
    expect(rxStep.data!.subarray(0, data.length)).toEqual(data);
  });
});
