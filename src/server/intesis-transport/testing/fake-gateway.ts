import {
  bigIntToBytesBE,
  bytesToBigIntBE,
  deriveSessionMaterial,
  DH_P,
  incrementIv,
  Keystream,
  modPow,
} from "../crypto/dh";
import { xxtea128CbcDecrypt } from "../crypto/xxtea";
import { buildCompleteBlob, buildProjectZip } from "@/core/project-format";
import { buildXmodem1KPackets, XmodemReceiver } from "../xmodem/xmodem";
import type { Duplex } from "../transport";

/**
 * Offline fake Intesis gateway for tests: a scripted Duplex reproducing the
 * documented protocol sequences (PROTOCOL.md §3/§8/§9/§10) — LOGIN0/1/2 with
 * real DH+XXTEA (fixed server private key), the SKT cleartext fallback for
 * old firmware, INFO?, RECVCMPLT/XMODEM-1K and a receive-a-project mode for
 * SENDCMPLT/SENDPROJ (XMODEM-1K transmitter side). No real network involved.
 * Shared by the session and manager test suites.
 */

// Fixed server private key (endianness is irrelevant for a fixed test value).
const SERVER_B = bytesToBigIntBE(Uint8Array.from({ length: 64 }, (_, i) => i + 128));

export const FAKE_INFO_BODY =
  "INFO:GWNAME:IN-KNX-MBM-TEST\r\n" +
  "INFO:SN:000R12345\r\n" +
  "INFO:APPNAME:IN-KNX-MBM\r\n" +
  "INFO:APPID:4\r\n" +
  "INFO:APPVERSION:1.0.0.0\r\n" +
  "INFO:PLATFORM:700 Series\r\n" +
  "INFO:STATUS:RUNNING\r\n";

/** Scripted behaviours for the receive-a-project mode (SENDCMPLT/SENDPROJ). */
export interface FakeGatewaySendScript {
  /** Refuse the SEND command with `<PREFIX>:ERR` instead of READY. */
  refuseCommand?: boolean;
  /** NAK the first copy of this 1-based packet once (forces a retransmission). */
  nakPacketOnce?: number;
  /** Cancel with CAN CAN when this 1-based packet arrives. */
  canAtPacket?: number;
  /** Answer `<PREFIX>:ERR` after a fully received transfer. */
  rejectAfterTransfer?: boolean;
}

export interface FakeGatewayConfig {
  password: string;
  /** Old firmware: answer SKT in cleartext and keep the session unencrypted. */
  cleartext?: boolean;
  /** Reject the login with "Client disconnected" after LOGIN2. */
  rejectLogin?: boolean;
  /** SKT ACK counter (persists between connections — PROTOCOL.md §8.2). */
  sktCounter?: number;
  /** Blob to serve on RECVCMPLT; undefined = bare unit (RECVPROJ:INVALID). */
  projectBlob?: Uint8Array;
  /** Announce a wrong byte count in RECVCMPLT:READY. */
  announcedLength?: number;
  /** Optional greeting bytes on connect (e.g. 00 00, PROTOCOL.md §7.4). */
  greeting?: Uint8Array;
  infoBody?: string;
  /** Receive-a-project scripting for SENDCMPLT/SENDPROJ uploads. */
  sendScript?: FakeGatewaySendScript;
}

export class FakeGateway implements Duplex {
  private outbox: Uint8Array[] = [];
  private waiters: ((chunk: Uint8Array | null) => void)[] = [];
  private inbox = "";
  private stage: "pre-login" | "login1-sent" | "established" | "xmodem" | "xmodem-recv" =
    "pre-login";
  private pubA = 0n;
  private toClient?: Keystream; // server → client (client RX keystream)
  private fromClient?: Keystream; // client → server (client TX keystream)
  private skt: number;
  private uplinkRx?: XmodemReceiver; // receive-a-project mode (SENDCMPLT/SENDPROJ)
  private uploadPrefix?: string;
  private nakkedPackets = new Set<number>();
  private receivedUploads: Uint8Array[] = [];
  private sendCommands: string[] = [];
  private pushTimers: ReturnType<typeof setInterval>[] = [];
  private signalValues = new Map<string, string>();
  private commsTick = 0;
  private debugOn = false;
  private sponsOn = false;
  closed = false;

  constructor(private readonly config: FakeGatewayConfig) {
    this.skt = config.sktCounter ?? 0;
    if (config.greeting) this.enqueue(config.greeting);
  }

  // ----- Duplex (client side view) -----

  write(data: Uint8Array): void {
    if (this.closed) throw new Error("fake gateway closed");
    if (this.stage === "established" || this.stage === "xmodem" || this.stage === "xmodem-recv") {
      this.handleEstablished(this.fromClient ? this.fromClient.apply(data) : data);
      return;
    }
    this.inbox += new TextDecoder().decode(data);
    this.processLoginInbox();
  }

  read(timeoutMs: number): Promise<Uint8Array | null> {
    const queued = this.outbox.shift();
    if (queued) return Promise.resolve(queued);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(onData);
        if (i >= 0) this.waiters.splice(i, 1);
        resolve(new Uint8Array(0));
      }, timeoutMs);
      const onData = (chunk: Uint8Array | null) => {
        clearTimeout(timer);
        resolve(chunk);
      };
      this.waiters.push(onData);
    });
  }

  close(): void {
    this.closed = true;
    for (const timer of this.pushTimers) clearInterval(timer);
    this.pushTimers = [];
    for (const w of this.waiters.splice(0)) w(null);
  }

  // ----- script -----

  private processLoginInbox(): void {
    for (;;) {
      const i = this.inbox.indexOf("\r\n");
      if (i < 0) return;
      const line = this.inbox.slice(0, i);
      this.inbox = this.inbox.slice(i + 2);
      if (line.startsWith("LOGIN0=admin;")) {
        const [gB64, , aB64] = line.slice("LOGIN0=admin;".length).split(";");
        const g = bytesToBigIntBE(fromBase64(gB64));
        this.pubA = bytesToBigIntBE(fromBase64(aB64));
        const pubB = modPow(g, SERVER_B, DH_P);
        this.respondCleartext(`LOGIN1=${toBase64(bigIntToBytesBE(pubB))}\r\n`);
        this.stage = "login1-sent";
      } else if (line.startsWith("LOGIN2=")) {
        this.handleLogin2(line.slice(7));
      }
      // Empty lines (the double CRLF after LOGIN0/LOGIN2) are ignored.
    }
  }

  private handleLogin2(ctB64: string): void {
    const k = modPow(this.pubA, SERVER_B, DH_P);
    let kb = bigIntToBytesBE(k);
    if (kb.length > 1 && kb[0] === 0 && kb[1] >= 128) kb = kb.subarray(1);
    const m = deriveSessionMaterial(this.config.password, kb);
    // Decrypt LOGIN2 with the ORIGINAL IV_TX, then set up the keystreams.
    const json = xxtea128CbcDecrypt(m.key, fromBase64(ctB64), m.ivTx);
    const decoded = new TextDecoder().decode(json).replace(/\0+$/, "");
    if (decoded !== '{"sessionParams":[{"encrypted":true}]}') {
      throw new Error(`fake gateway: unexpected LOGIN2 payload: ${decoded}`);
    }
    this.fromClient = new Keystream(m.key, incrementIv(m.ivTx), m.counterTx);
    this.toClient = new Keystream(m.key, m.ivRx, m.counterRx);
    this.stage = "established";
    if (this.config.rejectLogin) {
      this.respondEncrypted("Client disconnected\r\n");
      return;
    }
    if (this.config.cleartext) {
      // Old firmware: SKT pattern in cleartext, session stays unencrypted.
      this.fromClient = undefined;
      this.toClient = undefined;
      this.respondCleartext(`SKT${this.skt++} - OK\r\n`);
      return;
    }
    this.respondEncrypted(`SKT${this.skt++} - OK\r\n`);
  }

  private handleEstablished(data: Uint8Array): void {
    if (this.stage === "xmodem") {
      // The receiver's CRC request ('C') triggers the frame burst; the ACKs
      // that follow are ignored.
      if (data.includes(0x43)) {
        const blob = this.config.projectBlob!;
        this.respondEncryptedRaw(buildXmodem1KPackets(blob));
        this.respondEncrypted("RECVCMPLT:OK\r\n");
        this.stage = "established";
      }
      return;
    }
    if (this.stage === "xmodem-recv") {
      this.handleUploadBytes(data);
      return;
    }
    this.inbox += new TextDecoder().decode(data);
    for (;;) {
      const i = this.inbox.indexOf("\r\n");
      if (i < 0) return;
      const line = this.inbox.slice(0, i);
      this.inbox = this.inbox.slice(i + 2);
      if (line === "INFO?") {
        this.respondEncrypted(`SKT${this.skt++} - OK\r\n`);
        this.respondEncrypted((this.config.infoBody ?? FAKE_INFO_BODY) + "INFO:END\r\n");
      } else if (line === "APPINFO?") {
        this.respondEncrypted(`SKT${this.skt++} - OK\r\n`);
        this.respondEncrypted(
          "APPINFO:NAME:fake-project\r\n" +
            "APPINFO:SIGNALS:6\r\n" +
            "APPINFO:APPID:4\r\n" +
            "APPINFO:END\r\n",
        );
      } else if (line === "DIAGS?") {
        this.respondEncrypted(`SKT${this.skt++} - OK\r\n`);
        this.respondEncrypted(
          "DIAGS:XMEM:61234\r\n" +
            "DIAGS:XFLASH:1048576\r\n" +
            "DIAGS:TIMEOUTS:0\r\n" +
            "DIAGS:SEMAPHORES:0\r\n" +
            "DIAGS:GPIOS:0\r\n" +
            "DIAGS:CPUTIME:0000d 00:44:52\r\n" +
            "DIAGS:END\r\n",
        );
      } else if (line === "RECVCMPLT") {
        this.respondEncrypted(`SKT${this.skt++} - OK\r\n`);
        if (!this.config.projectBlob) {
          // Bare units answer RECVPROJ:INVALID to a RECVCMPLT (PROTOCOL.md §9).
          this.respondEncrypted("RECVPROJ:INVALID\r\n");
        } else {
          const n = this.config.announcedLength ?? this.config.projectBlob.length;
          this.respondEncrypted(`RECVCMPLT:READY:${n}\r\n`);
          this.stage = "xmodem";
        }
      } else if (/^[01](KX|MM):(SPONS|COMMS|DEBUG)=[01]$/.test(line)) {
        // Monitor toggles and upload pre-commands: the real firmware ACKs
        // `<port><PREFIX>:OK` and ignores the unprefixed form in silence.
        this.respondEncrypted(`${line.slice(0, 3)}:OK\r\n`);
        this.updatePushes(line);
      } else if (/^[01](KX|MM):[0-9A-Fa-f]{4,8}\?/.test(line)) {
        this.handleSignalRead(line);
      } else if (/^[01](KX|MM):[0-9A-Fa-f]{4,8}=/.test(line)) {
        this.handleSignalWrite(line);
      } else if (line === "RESET!") {
        this.respondEncrypted("OK\r\n");
      } else if (line.startsWith("SENDCMPLT,") || line.startsWith("SENDPROJ,")) {
        this.handleSendCommand(line);
      }
      // Unknown commands are ignored in silence, like the real firmware
      // (docs/reference/console-protocol.md §4).
    }
  }

  /** Signal read `<side><PREFIX>:<idHex>?` → `<same id>=<value>;<flags>`. */
  private handleSignalRead(line: string): void {
    const m = /^([01](?:KX|MM):[0-9A-Fa-f]{4,8})\?/.exec(line);
    if (!m) return;
    const id = m[1].toUpperCase();
    // Without bus data the real firmware answers 0 (console-protocol.md §4).
    this.respondEncrypted(`${id}=${this.signalValues.get(id) ?? "0.00"};0\r\n`);
  }

  /** Signal write `<side><PREFIX>:<idHex>=<value>[;]` → `<prefix>:OK`. */
  private handleSignalWrite(line: string): void {
    const m = /^([01])(KX|MM):([0-9A-Fa-f]{4,8})=([^;]*);?/.exec(line);
    if (!m) return;
    const id = `${m[1]}${m[2]}:${m[3]}`.toUpperCase();
    this.signalValues.set(id, m[4]);
    this.respondEncrypted(`${m[1]}${m[2]}:OK\r\n`);
    if (this.sponsOn && id === "1MM:00000000") {
      // Live-observed (2026-09-25): the write propagates to the mapped KNX
      // object and SPONS reports it right after the ACK.
      const value = Number(m[4]).toFixed(2);
      this.signalValues.set("0KX:00020003", value);
      this.respondEncrypted(`0KX:00020003=${value};1\r\n`);
    }
  }

  /** Starts/stops the SPONS/COMMS push timers after a console toggle. */
  private updatePushes(line: string): void {
    const on = line.endsWith("=1");
    if (/SPONS=/.test(line)) this.sponsOn = on;
    // DEBUG only toggles timeout visibility; it must not restart the stream.
    if (/DEBUG=/.test(line)) {
      this.debugOn = on;
      return;
    }
    for (const timer of this.pushTimers) clearInterval(timer);
    this.pushTimers = [];
    if (!on) return;
    if (/SPONS=1$/.test(line) || /COMMS=1$/.test(line)) {
      // Only start the scripted stream once both toggles may be on; the
      // session enables SPONS and COMMS on both ports in sequence.
      const timer = setInterval(() => {
        if (this.closed) return;
        this.commsTick++;
        const n = this.commsTick;
        if (this.debugOn && n % 13 === 0) {
          // DEBUG=1 makes bus timeouts visible (console-protocol.md §2).
          this.respondEncrypted("1MM:RTUB Timeout!\r\n");
        } else if (n % 2 === 0) {
          this.respondEncrypted("1MM:RTUB [Tx] 01 03 00 01 00 01 D5 CA\r\n");
          this.respondEncrypted("1MM:RTUB [Rx] 01 03 02 00 A3 21 84\r\n");
        } else {
          const value = (20 + (n % 7)).toFixed(2);
          this.signalValues.set("0KX:00020003", value);
          this.respondEncrypted(`0KX:00020003=${value};0\r\n`);
        }
      }, 450);
      timer.unref?.();
      this.pushTimers.push(timer);
    }
  }

  private handleSendCommand(line: string): void {
    this.sendCommands.push(line);
    const prefix = line.startsWith("SENDCMPLT,") ? "CMPLTFILE" : "PROJFILE";
    this.respondEncrypted(`SKT${this.skt++} - OK\r\n`);
    if (this.config.sendScript?.refuseCommand) {
      this.respondEncrypted(`${prefix}:ERR\r\n`);
      return;
    }
    this.respondEncrypted(`${prefix}:READY\r\n`);
    this.uploadPrefix = prefix;
    this.uplinkRx = new XmodemReceiver();
    // Real gateways request CRC mode with 'C' once ready (PROTOCOL.md §10.5).
    this.respondEncryptedRaw(this.uplinkRx.begin());
    this.stage = "xmodem-recv";
  }

  /** XMODEM-1K receiver side of a SENDCMPLT/SENDPROJ upload, with scripts. */
  private handleUploadBytes(data: Uint8Array): void {
    const script = this.config.sendScript ?? {};
    // Packet-level scripts inspect the frame header (frames arrive whole: the
    // session writes each packet in a single channel send).
    if ((data[0] === 0x01 || data[0] === 0x02) && data.length >= 4) {
      const packetNo = data[1];
      if (script.canAtPacket === packetNo) {
        this.respondEncryptedRaw(Uint8Array.of(0x18, 0x18)); // CAN CAN
        this.stage = "established";
        this.uplinkRx = undefined;
        return;
      }
      if (script.nakPacketOnce === packetNo && !this.nakkedPackets.has(packetNo)) {
        this.nakkedPackets.add(packetNo);
        this.respondEncryptedRaw(Uint8Array.of(0x15)); // NAK → force retransmission
        return;
      }
    }
    if (!this.uplinkRx) return;
    const step = this.uplinkRx.push(data);
    this.respondEncryptedRaw(step.send);
    if (step.status === "done") {
      const received = step.data!;
      this.receivedUploads.push(received);
      const prefix = this.uploadPrefix!;
      const padded = this.uplinkRx.getReceivedBytes();
      this.uplinkRx = undefined;
      this.stage = "established";
      this.respondEncrypted(`${prefix}:RX:${received.length}/${padded}\r\n`);
      this.respondEncrypted(`${prefix}:SAVING XBL..\r\n`);
      this.respondEncrypted(`${prefix}:SAVING PROJ..\r\n`);
      this.respondEncrypted(`${prefix}:${script.rejectAfterTransfer ? "ERR" : "OK"}\r\n`);
    } else if (step.status !== "active") {
      this.uplinkRx = undefined;
      this.stage = "established";
    }
  }

  // ----- test introspection -----

  /** SENDCMPLT/SENDPROJ command lines received so far (arguments included). */
  getSendCommands(): string[] {
    return [...this.sendCommands];
  }

  /** Uploads received so far (CTRL-Z padding of the last packet included). */
  getReceivedUploads(): Uint8Array[] {
    return this.receivedUploads.map((u) => new Uint8Array(u));
  }

  private respondCleartext(text: string): void {
    this.enqueue(new TextEncoder().encode(text));
  }

  private respondEncrypted(text: string): void {
    this.respondEncryptedRaw(new TextEncoder().encode(text));
  }

  private respondEncryptedRaw(bytes: Uint8Array): void {
    this.enqueue(this.toClient ? this.toClient.apply(bytes) : bytes);
  }

  private enqueue(bytes: Uint8Array): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(bytes);
    else this.outbox.push(bytes);
  }
}

export function makeTestBlob(zipName = "test.ibmaps", xml = "<Project />"): Uint8Array {
  const zip = buildProjectZip(zipName, xml);
  return buildCompleteBlob(Uint8Array.from({ length: 32 }, (_, i) => i), zip);
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "base64"));
}
