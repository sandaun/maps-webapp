import { describe, expect, it } from "vitest";
import {
  ACK,
  buildXmodem1KPackets,
  CAN,
  CRC_REQ,
  crc16Ccitt,
  EOT,
  STX,
  XmodemReceiver,
} from "./index";

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

/** Feed a whole scripted transfer and collect everything the receiver sends. */
function runTransfer(rx: XmodemReceiver, chunks: Uint8Array[]) {
  const sent: number[] = [];
  let last;
  for (const chunk of chunks) {
    last = rx.push(chunk);
    sent.push(...last.send);
    if (last.status !== "active") break;
  }
  return { sent: Uint8Array.from(sent), last: last ?? rx.push(new Uint8Array()) };
}

describe("XmodemReceiver", () => {
  it("requests CRC mode on begin()", () => {
    expect(hex(new XmodemReceiver().begin())).toBe(hex(Uint8Array.of(CRC_REQ)));
  });

  it("receives a full XMODEM-1K transfer (round-trip with buildXmodem1KPackets)", () => {
    const data = Uint8Array.from({ length: 2500 }, (_, i) => (i * 7 + 3) & 0xff);
    const rx = new XmodemReceiver();
    const wire = buildXmodem1KPackets(data);
    const { sent, last } = runTransfer(rx, [wire]);
    expect(last!.status).toBe("done");
    // 3 packets (1024+1024+452→padded) => 3 ACK + 1 ACK for EOT.
    expect(sent).toEqual(Uint8Array.of(ACK, ACK, ACK, ACK));
    // Last packet is CTRL-Z padded; caller trims to the announced length.
    expect(last!.data!.length).toBe(3072);
    expect(last!.data!.subarray(0, 2500)).toEqual(data);
  });

  it("accepts data delivered in arbitrarily small chunks", () => {
    const data = Uint8Array.from({ length: 100 }, (_, i) => i);
    const wire = buildXmodem1KPackets(data);
    const rx = new XmodemReceiver();
    const sent: number[] = [];
    let last;
    for (let i = 0; i < wire.length; i += 7) {
      last = rx.push(wire.subarray(i, i + 7));
      sent.push(...last.send);
    }
    expect(last!.status).toBe("done");
    expect(last!.data!.subarray(0, 100)).toEqual(data);
    expect(sent).toEqual([ACK, ACK]);
  });

  it("rejects a packet with a bad CRC and re-requests it (C as NAK)", () => {
    const data = Uint8Array.from({ length: 10 }, (_, i) => i);
    const wire = buildXmodem1KPackets(data);
    const corrupted = new Uint8Array(wire);
    corrupted[5] ^= 0xff; // flip a payload byte of packet 1
    const rx = new XmodemReceiver();
    const step1 = rx.push(corrupted.subarray(0, 1029)); // full packet 1, corrupt
    expect(step1.status).toBe("active");
    expect(step1.send).toEqual(Uint8Array.of(CRC_REQ));
    // Now the "device" retransmits packet 1 correctly, then the rest.
    const good = buildXmodem1KPackets(data);
    const step2 = rx.push(good.subarray(0, 1029));
    expect(step2.send).toEqual(Uint8Array.of(ACK));
    const step3 = rx.push(good.subarray(1029)); // EOT
    expect(step3.status).toBe("done");
    expect(step3.data!.subarray(0, 10)).toEqual(data);
  });

  it("re-ACKs a duplicate of the last accepted packet without appending it", () => {
    const data = Uint8Array.from({ length: 2000 }, (_, i) => i & 0xff);
    const wire = buildXmodem1KPackets(data);
    const rx = new XmodemReceiver();
    const packet1 = wire.subarray(0, 1029);
    expect(rx.push(packet1).send).toEqual(Uint8Array.of(ACK));
    // Duplicate packet 1 (lost ACK scenario): re-ACK, no append.
    const dup = rx.push(packet1);
    expect(dup.send).toEqual(Uint8Array.of(ACK));
    expect(dup.receivedBytes).toBe(1024);
    const rest = rx.push(wire.subarray(1029));
    expect(rest.status).toBe("done");
    expect(rest.data!.length).toBe(2048);
    expect(rest.data!.subarray(0, 2000)).toEqual(data);
  });

  it("rejects an out-of-order packet number", () => {
    const data = Uint8Array.from({ length: 2000 }, (_, i) => i & 0xff);
    const wire = buildXmodem1KPackets(data);
    const rx = new XmodemReceiver();
    // Send packet 2 first.
    const step = rx.push(wire.subarray(1029, 2058));
    expect(step.send).toEqual(Uint8Array.of(CRC_REQ));
    expect(step.receivedBytes).toBe(0);
  });

  it("treats CAN CAN as a device-initiated cancellation", () => {
    const rx = new XmodemReceiver();
    const step = rx.push(Uint8Array.of(CAN, CAN));
    expect(step.status).toBe("cancelled");
    expect(step.send).toEqual(Uint8Array.of(ACK));
  });

  it("fails after maxRetries timeouts and sends CAN CAN CAN", () => {
    const rx = new XmodemReceiver({ maxRetries: 3 });
    expect(rx.onTimeout().send).toEqual(Uint8Array.of(CRC_REQ));
    const last = rx.onTimeout();
    expect(last.send).toEqual(Uint8Array.of(CRC_REQ));
    const failed = rx.onTimeout();
    expect(failed.status).toBe("failed");
    expect(failed.send).toEqual(Uint8Array.of(CAN, CAN, CAN));
    expect(failed.error).toMatch(/no data/);
  });
});

describe("buildXmodem1KPackets (test helper)", () => {
  it("frames a packet as [STX][n][~n][1024 B][CRC16 BE]", () => {
    const data = Uint8Array.from({ length: 5 }, (_, i) => i + 1);
    const wire = buildXmodem1KPackets(data);
    expect(wire[0]).toBe(STX);
    expect(wire[1]).toBe(1);
    expect(wire[2]).toBe(0xfe);
    const payload = wire.subarray(3, 3 + 1024);
    expect(payload.subarray(0, 5)).toEqual(data);
    expect(payload[1023]).toBe(0x1a); // CTRL-Z padding
    const crc = crc16Ccitt(payload);
    expect((wire[1027] << 8) | wire[1028]).toBe(crc);
    expect(wire[1029]).toBe(EOT);
  });

  it("encodes an empty transfer as EOT only", () => {
    const wire = buildXmodem1KPackets(new Uint8Array(0));
    expect(wire).toEqual(Uint8Array.of(EOT));
  });
});
