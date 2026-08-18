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
import { buildXmodem1KPackets } from "../xmodem/xmodem";
import type { Duplex } from "../transport";

/**
 * Offline fake Intesis gateway for tests: a scripted Duplex reproducing the
 * documented protocol sequences (PROTOCOL.md §3/§8/§9) — LOGIN0/1/2 with real
 * DH+XXTEA (fixed server private key), the SKT cleartext fallback for old
 * firmware, INFO? and RECVCMPLT/XMODEM-1K. No real network involved.
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
}

export class FakeGateway implements Duplex {
  private outbox: Uint8Array[] = [];
  private waiters: ((chunk: Uint8Array | null) => void)[] = [];
  private inbox = "";
  private stage: "pre-login" | "login1-sent" | "established" | "xmodem" = "pre-login";
  private pubA = 0n;
  private toClient?: Keystream; // server → client (client RX keystream)
  private fromClient?: Keystream; // client → server (client TX keystream)
  private skt: number;
  closed = false;

  constructor(private readonly config: FakeGatewayConfig) {
    this.skt = config.sktCounter ?? 0;
    if (config.greeting) this.enqueue(config.greeting);
  }

  // ----- Duplex (client side view) -----

  write(data: Uint8Array): void {
    if (this.closed) throw new Error("fake gateway closed");
    if (this.stage === "established" || this.stage === "xmodem") {
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
    this.inbox += new TextDecoder().decode(data);
    for (;;) {
      const i = this.inbox.indexOf("\r\n");
      if (i < 0) return;
      const line = this.inbox.slice(0, i);
      this.inbox = this.inbox.slice(i + 2);
      if (line === "INFO?") {
        this.respondEncrypted(`SKT${this.skt++} - OK\r\n`);
        this.respondEncrypted((this.config.infoBody ?? FAKE_INFO_BODY) + "INFO:END\r\n");
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
      }
    }
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
