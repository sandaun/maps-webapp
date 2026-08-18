import "server-only";
import { crc16Ccitt } from "../crypto/crc16";

/**
 * XMODEM / XMODEM-1K receiver (CRC-16/CCITT mode) as a pure byte state
 * machine: the caller feeds inbound chunks with `push()` and drives timeouts
 * with `onTimeout()`; both return the control bytes to write back.
 *
 * Port of the receiver in `sonda_maps.py` (`xmodem_receive`), itself a port of
 * `IntesisComm.XModem/XModem.cs` (PROTOCOL.md §4), with the documented fixes
 * (docs/knx-mbm-mvp.md §9.9): a retransmitted copy of the last accepted packet
 * is re-ACKed instead of rejected, and the caller (session) must NOT ignore a
 * final `RECVCMPLT:ERR`.
 *
 * Only the receiver is implemented: the MVP never sends files to a gateway
 * (no SENDPROJ/SENDCMPLT). `buildXmodem1KPackets` exists for tests/fake
 * servers only.
 */

export const SOH = 0x01;
export const STX = 0x02;
export const EOT = 0x04;
export const ACK = 0x06;
export const CAN = 0x18;
export const CTRL_Z = 0x1a;
/** 'C': receiver requests CRC-16 mode (also used as NAK by the sonda). */
export const CRC_REQ = 0x43;

export type XmodemStatus = "active" | "done" | "cancelled" | "failed";

export interface XmodemStep {
  /** Control bytes to write to the channel (may be empty). */
  send: Uint8Array;
  status: XmodemStatus;
  /** Payload bytes accepted so far (CTRL-Z padding of the last packet included). */
  receivedBytes: number;
  /** Complete payload once status is "done". */
  data?: Uint8Array;
  error?: string;
}

export interface XmodemReceiverOptions {
  /** Max consecutive timeouts/garbage before failing (sonda: 16). */
  maxRetries?: number;
}

export class XmodemReceiver {
  private readonly maxRetries: number;
  private pending: number[] = [];
  private chunks: Uint8Array[] = [];
  private received = 0;
  private expectedPacket = 1;
  private retries = 0;
  private status: XmodemStatus = "active";

  constructor(options: XmodemReceiverOptions = {}) {
    this.maxRetries = options.maxRetries ?? 16;
  }

  /** Initial handshake: request CRC mode. */
  begin(): Uint8Array {
    return Uint8Array.of(CRC_REQ);
  }

  getReceivedBytes(): number {
    return this.received;
  }

  getStatus(): XmodemStatus {
    return this.status;
  }

  /**
   * Bytes received after the terminal EOT (e.g. a `RECVCMPLT:OK` line in the
   * same TCP segment). The session must hand them back to the line channel.
   */
  takePending(): Uint8Array {
    const out = Uint8Array.from(this.pending);
    this.pending = [];
    return out;
  }

  /** Feed inbound bytes; returns what to write back and the new status. */
  push(chunk: Uint8Array): XmodemStep {
    const send: number[] = [];
    if (this.status !== "active") return this.step(send);
    for (const b of chunk) this.pending.push(b);
    this.drain(send);
    return this.step(send);
  }

  /** The caller observed a read timeout: re-request the current packet. */
  onTimeout(): XmodemStep {
    const send: number[] = [];
    if (this.status !== "active") return this.step(send);
    this.retries++;
    if (this.retries >= this.maxRetries) {
      this.status = "failed";
      send.push(CAN, CAN, CAN);
      return this.step(send, `XMODEM: no data after ${this.maxRetries} attempts`);
    }
    send.push(CRC_REQ);
    return this.step(send);
  }

  private drain(send: number[]): void {
    for (;;) {
      if (this.status !== "active" || this.pending.length === 0) return;
      const b = this.pending[0];
      if (b === SOH || b === STX) {
        const size = b === SOH ? 128 : 1024;
        if (this.pending.length < 1 + 2 + size + 2) return; // wait for the full frame
        this.pending.shift();
        const packetNo = this.pending.shift()!;
        const packetNoInv = this.pending.shift()!;
        const payload = Uint8Array.from(this.pending.splice(0, size));
        const crcHi = this.pending.shift()!;
        const crcLo = this.pending.shift()!;
        const crcRx = (crcHi << 8) | crcLo;
        this.handlePacket(packetNo, packetNoInv, payload, crcRx, send);
      } else if (b === EOT) {
        this.pending.shift();
        send.push(ACK);
        this.status = "done";
      } else if (b === CAN) {
        if (this.pending.length < 2) return; // wait to see if a second CAN follows
        this.pending.shift();
        if (this.pending.shift() === CAN) {
          send.push(ACK);
          this.status = "cancelled";
        }
        // A lone CAN is treated as garbage.
      } else {
        // Garbage byte: drop it and re-request (the sonda sends 'C' as NAK).
        this.pending.shift();
        this.retries++;
        if (this.retries >= this.maxRetries) {
          this.status = "failed";
          send.push(CAN, CAN, CAN);
          return;
        }
        send.push(CRC_REQ);
      }
    }
  }

  private handlePacket(
    packetNo: number,
    packetNoInv: number,
    payload: Uint8Array,
    crcRx: number,
    send: number[],
  ): void {
    const headerOk = packetNo === ((~packetNoInv) & 0xff);
    const crcOk = crc16Ccitt(payload) === crcRx;
    if (!headerOk || !crcOk) {
      this.retries++;
      if (this.retries >= this.maxRetries) {
        this.status = "failed";
        send.push(CAN, CAN, CAN);
        return;
      }
      send.push(CRC_REQ);
      return;
    }
    if (packetNo === ((this.expectedPacket - 1) & 0xff)) {
      // Retransmission of the last accepted packet: re-ACK, do not append
      // (documented fix over the sonda, which rejected duplicates).
      send.push(ACK);
      return;
    }
    if (packetNo !== this.expectedPacket) {
      send.push(CRC_REQ);
      return;
    }
    this.chunks.push(payload);
    this.received += payload.length;
    this.expectedPacket = (this.expectedPacket + 1) & 0xff;
    this.retries = 0;
    send.push(ACK);
  }

  private step(send: number[], error?: string): XmodemStep {
    let data: Uint8Array | undefined;
    if (this.status === "done") {
      const out = new Uint8Array(this.received);
      let offset = 0;
      for (const chunk of this.chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
      }
      data = out;
    }
    return {
      send: Uint8Array.from(send),
      status: this.status,
      receivedBytes: this.received,
      data,
      error: this.status === "failed" ? (error ?? "XMODEM transfer failed") : undefined,
    };
  }
}

/**
 * Test/fake-server helper: encode data as XMODEM-1K CRC frames
 * ([STX][n][~n][1024 B payload CTRL-Z padded][CRC16 BE]) followed by EOT.
 */
export function buildXmodem1KPackets(data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let packetNo = 1;
  for (let pos = 0; pos < data.length; pos += 1024) {
    const payload = new Uint8Array(1024).fill(CTRL_Z);
    payload.set(data.subarray(pos, pos + 1024));
    const crc = crc16Ccitt(payload);
    const frame = new Uint8Array(3 + 1024 + 2);
    frame[0] = STX;
    frame[1] = packetNo & 0xff;
    frame[2] = ~packetNo & 0xff;
    frame.set(payload, 3);
    frame[3 + 1024] = (crc >> 8) & 0xff;
    frame[3 + 1025] = crc & 0xff;
    parts.push(frame);
    packetNo = (packetNo + 1) & 0xff;
  }
  parts.push(Uint8Array.of(EOT));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
