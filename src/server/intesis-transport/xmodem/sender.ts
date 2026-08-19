import "server-only";
import { crc16Ccitt } from "../crypto/crc16";
import {
  ACK,
  CAN,
  CRC_REQ,
  CTRL_Z,
  EOT,
  SOH,
  STX,
  type XmodemStatus,
} from "./xmodem";

/**
 * XMODEM / XMODEM-1K transmitter (CRC-16/CCITT mode) as a pure byte state
 * machine, mirroring `XmodemReceiver`: the caller feeds inbound control bytes
 * with `push()` and drives timeouts with `onTimeout()`; both return the bytes
 * to write to the channel.
 *
 * Port of `xmodem_transmit` in `temp/maps-cloud/sonda_maps.py` (live-validated
 * round-trip, PROTOCOL.md §10), itself a port of
 * `IntesisComm.XModem/XModem.cs` (`XmodemTransmit`):
 * - waits for the receiver's sync byte: `C` (0x43) = CRC-16 mode, `NAK` =
 *   8-bit checksum mode (kept for old firmware; the 700 Series requests CRC);
 * - packets `[STX|SOH][n][~n][1024/128 B payload CTRL-Z padded][CRC16 BE]`,
 *   max 25 retransmissions per packet on NAK/garbage/timeout;
 * - double `CAN` from the receiver cancels (answered with ACK);
 * - EOT retried up to 10 times (the caller's `onTimeout` cadence sets the
 *   ~2 s spacing, PROTOCOL.md §4) until the receiver ACKs it.
 */

export const NAK = 0x15;

export type XmodemSenderPhase = "sync" | "packets" | "eot";

export interface XmodemSenderStep {
  /** Bytes to write to the channel (may be empty). */
  send: Uint8Array;
  status: XmodemStatus;
  phase: XmodemSenderPhase;
  /** Payload bytes acknowledged so far (CTRL-Z padding excluded). */
  sentBytes: number;
  totalBytes: number;
  error?: string;
}

export interface XmodemSenderOptions {
  /** Use 1024-byte STX packets (default) or 128-byte SOH packets. */
  use1k?: boolean;
  /** Max retransmissions per packet (sonda/MAPS: 25). */
  maxRetries?: number;
  /** Max EOT retransmissions (sonda/MAPS: 10). */
  maxEotRetries?: number;
  /** Max sync waits before giving up (sonda: 30 s at 2 s reads ≈ 15). */
  maxSyncRetries?: number;
}

export class XmodemSender {
  private readonly data: Uint8Array;
  private readonly packetSize: number;
  private readonly header: number;
  private readonly maxRetries: number;
  private readonly maxEotRetries: number;
  private readonly maxSyncRetries: number;

  private phase: XmodemSenderPhase = "sync";
  private status: XmodemStatus = "active";
  private crcMode: boolean | undefined;
  private packetNo = 1;
  private pos = 0;
  private retries = 0;
  private eotRetries = 0;
  private syncRetries = 0;
  private pending: number[] = [];

  constructor(data: Uint8Array, options: XmodemSenderOptions = {}) {
    this.data = data;
    this.packetSize = options.use1k === false ? 128 : 1024;
    this.header = this.packetSize === 1024 ? STX : SOH;
    this.maxRetries = options.maxRetries ?? 25;
    this.maxEotRetries = options.maxEotRetries ?? 10;
    this.maxSyncRetries = options.maxSyncRetries ?? 15;
  }

  /** Nothing to send yet: the receiver's sync byte (`C`/NAK) starts the transfer. */
  begin(): XmodemSenderStep {
    return this.step([]);
  }

  getStatus(): XmodemStatus {
    return this.status;
  }

  getSentBytes(): number {
    return this.pos;
  }

  /** Feed inbound control bytes (ACK/NAK/CAN/`C`); returns what to write back. */
  push(chunk: Uint8Array): XmodemSenderStep {
    const send: number[] = [];
    if (this.status !== "active") return this.step(send);
    for (const b of chunk) this.pending.push(b);
    this.drain(send);
    return this.step(send);
  }

  /** The caller observed a read timeout: re-sync, retransmit or re-send EOT. */
  onTimeout(): XmodemSenderStep {
    const send: number[] = [];
    if (this.status !== "active") return this.step(send);
    if (this.phase === "sync") {
      this.syncRetries++;
      if (this.syncRetries >= this.maxSyncRetries) {
        this.status = "failed";
        send.push(CAN, CAN, CAN);
        return this.step(send, "XMODEM: no sync byte (C/NAK) from the receiver");
      }
      return this.step(send);
    }
    if (this.phase === "eot") {
      this.sendEot(send);
      return this.step(send);
    }
    this.retransmit(send);
    return this.step(send);
  }

  private drain(send: number[]): void {
    for (;;) {
      if (this.status !== "active" || this.pending.length === 0) return;
      const b = this.pending[0];
      if (b === CAN) {
        if (this.pending.length < 2) return; // wait to see if a second CAN follows
        this.pending.shift();
        if (this.pending.shift() === CAN) {
          send.push(ACK);
          this.status = "cancelled";
        }
        // A lone CAN is treated as garbage.
        continue;
      }
      if (this.phase === "sync") {
        if (b === CRC_REQ || b === NAK) {
          this.pending.shift();
          this.crcMode = b === CRC_REQ;
          if (this.data.length === 0) {
            // Nothing to send: straight to the EOT handshake (sonda behaviour).
            this.phase = "eot";
            this.sendEot(send);
          } else {
            this.phase = "packets";
            this.sendCurrentPacket(send);
          }
          continue;
        }
        // Garbage while waiting for sync: drop it.
        this.pending.shift();
        continue;
      }
      if (this.phase === "eot") {
        this.pending.shift();
        if (b === ACK) {
          this.status = "done";
          return;
        }
        // NAK/garbage during EOT: re-send EOT (counts towards the EOT limit).
        this.sendEot(send);
        continue;
      }
      // packets phase
      this.pending.shift();
      if (b === ACK) {
        this.pos += this.packetSize;
        if (this.pos >= this.data.length) {
          this.pos = this.data.length;
          this.phase = "eot";
          this.eotRetries = 0;
          this.sendEot(send);
        } else {
          this.packetNo = (this.packetNo + 1) & 0xff;
          this.retries = 0;
          this.sendCurrentPacket(send);
        }
        continue;
      }
      // NAK or garbage: retransmit the current packet.
      this.retransmit(send);
      if (this.status !== "active") return;
    }
  }

  private retransmit(send: number[]): void {
    this.retries++;
    if (this.retries >= this.maxRetries) {
      this.status = "failed";
      send.push(CAN, CAN, CAN);
      return;
    }
    this.sendCurrentPacket(send);
  }

  private sendEot(send: number[]): void {
    this.eotRetries++;
    if (this.eotRetries > this.maxEotRetries) {
      this.status = "failed";
      return;
    }
    send.push(EOT);
  }

  private sendCurrentPacket(send: number[]): void {
    const payload = new Uint8Array(this.packetSize).fill(CTRL_Z);
    payload.set(this.data.subarray(this.pos, this.pos + this.packetSize));
    send.push(this.header, this.packetNo & 0xff, ~this.packetNo & 0xff);
    for (const byte of payload) send.push(byte);
    if (this.crcMode) {
      const crc = crc16Ccitt(payload);
      send.push((crc >> 8) & 0xff, crc & 0xff);
    } else {
      let sum = 0;
      for (const byte of payload) sum = (sum + byte) & 0xff;
      send.push(sum);
    }
  }

  private step(send: number[], error?: string): XmodemSenderStep {
    return {
      send: Uint8Array.from(send),
      status: this.status,
      phase: this.phase,
      sentBytes: Math.min(this.pos, this.data.length),
      totalBytes: this.data.length,
      error:
        this.status === "failed"
          ? (error ??
            (this.phase === "eot"
              ? `XMODEM: EOT not acknowledged after ${this.maxEotRetries} attempts`
              : `XMODEM: packet ${this.packetNo} not acknowledged after ${this.maxRetries} attempts`))
          : undefined,
    };
  }
}
