import "server-only";
import { parseCompleteBlob } from "@/core/project-format/complete-blob";
import { ClientLogin, type RandomSource } from "./crypto/dh";
import { parseInfoLines, type GatewayInfo } from "./info";
import type { Duplex } from "./transport";
import { XmodemReceiver } from "./xmodem/xmodem";
import { XmodemSender } from "./xmodem/sender";

/**
 * Gateway control session (TCP/23): LOGIN0/1/2 handshake with DH + XXTEA,
 * cleartext fallback for old firmware (SKT pattern), `INFO?` queries,
 * `RECVCMPLT` downloads and `SENDCMPLT`/`SENDPROJ` uploads over XMODEM-1K.
 * The write path exists for the deploy flow (src/server/deploy/) and is
 * gated there — the session itself only speaks the protocol.
 *
 * Port of `fer_login` / `Canal` / `mode_info` / `mode_descarrega` /
 * `mode_puja` from temp/maps-cloud/sonda_maps.py (live-validated,
 * PROTOCOL.md §8/§10), with the documented fixes: `RECVCMPLT:ERR` is NOT
 * ignored, XMODEM duplicates are re-ACKed, and the received blob is
 * validated (length/CRC32/ZIP) via `parseCompleteBlob`.
 */

export type GatewayErrorCode =
  | "connect"
  | "auth"
  | "protocol"
  | "no-project"
  | "transfer"
  | "invalid-blob"
  | "busy"
  | "closed"
  | "timeout";

export class GatewayError extends Error {
  constructor(
    readonly code: GatewayErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export interface SessionEvents {
  /** Human-readable trace lines for the transfer log (never contains secrets). */
  log?: (line: string) => void;
  /** XMODEM progress. */
  progress?: (receivedBytes: number, totalBytes: number) => void;
}

export interface GatewaySessionOptions extends SessionEvents {
  /** Device password: held in memory only, never logged or persisted. */
  password: string;
  /** Optional `00 00` greeting window on TCP accept (default 500 ms). */
  greetingTimeoutMs?: number;
  /** Per-line/read timeout (default 10000 ms). */
  lineTimeoutMs?: number;
  /** Ready/XMODEM/validation phase timeout (default 15000 ms). */
  transferTimeoutMs?: number;
  /**
   * Keepalive event interval (default 80000 ms like MAPS MILISECONDS_KEEPALIVE;
   * 0 disables). Mirrors the desktop tool: it emits a local event, it does not
   * send bytes — TCP liveness is handled by the socket itself.
   */
  keepAliveIntervalMs?: number;
  /** Test hook: deterministic randomness for the DH handshake. */
  random?: RandomSource;
}

const CRLF = Uint8Array.of(0x0d, 0x0a);
const CR = 0x0d;
const LF = 0x0a;

/** Pre-commands pausing gateway activity during an upload (PROTOCOL.md §10.1). */
const SEND_PRE_COMMANDS = ["0:SPONS=0", "1:SPONS=0", "0:COMMS=0", "1:COMMS=0", "0:DEBUG=0", "1:DEBUG=0"];
/** The MAPS waits up to 20 s for `<TYPE>FILE:READY` (PROTOCOL.md §10.3). */
const SEND_READY_TIMEOUT_MS = 20_000;
/** The gateway can take a while to apply the received config (sonda: 60 s). */
const SEND_VALIDATION_TIMEOUT_MS = 60_000;

/** Buffered text/binary channel over a Duplex, decrypting on arrival (sonda's `Canal`). */
class Channel {
  private buf: number[] = [];
  private eof = false;

  constructor(
    private readonly link: Duplex,
    private readonly cipher?: ClientLogin,
  ) {}

  /** Prepend already-read bytes (SKT cleartext first message, decrypted chunk). */
  seed(bytes: Uint8Array): void {
    this.buf.unshift(...bytes);
  }

  private async fill(timeoutMs: number): Promise<boolean> {
    const chunk = await this.link.read(timeoutMs);
    if (chunk === null) {
      this.eof = true;
      return false;
    }
    if (chunk.length === 0) return false;
    const dec = this.cipher ? this.cipher.decryptRx(chunk) : chunk;
    for (const b of dec) this.buf.push(b);
    return true;
  }

  /** Reads one line including its CRLF; `null` on timeout or EOF. */
  async readLine(timeoutMs: number): Promise<Uint8Array | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = this.findCrlf();
      if (i >= 0) return Uint8Array.from(this.buf.splice(0, i + 2));
      if (this.eof) {
        if (this.buf.length === 0) return null;
        return Uint8Array.from(this.buf.splice(0));
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      await this.fill(Math.min(250, remaining));
    }
  }

  /** Reads all currently buffered bytes, waiting up to `timeoutMs` for the first. */
  async readAvailable(timeoutMs: number): Promise<Uint8Array | null> {
    if (this.buf.length === 0) {
      const got = await this.fill(timeoutMs);
      if (!got && this.buf.length === 0) return this.eof ? null : new Uint8Array(0);
    }
    return Uint8Array.from(this.buf.splice(0));
  }

  send(data: Uint8Array): void {    this.link.write(this.cipher ? this.cipher.encryptTx(data) : data);
  }

  sendLine(text: string): void {
    const bytes = new TextEncoder().encode(text);
    const out = new Uint8Array(bytes.length + 2);
    out.set(bytes);
    out.set(CRLF, bytes.length);
    this.send(out);
  }

  private findCrlf(): number {
    for (let i = 0; i < this.buf.length - 1; i++) {
      if (this.buf[i] === CR && this.buf[i + 1] === LF) return i;
    }
    return -1;
  }
}

export interface ConnectResult {
  info: GatewayInfo;
  /** False when the firmware answered with the SKT cleartext pattern. */
  encrypted: boolean;
}

export interface SendFileOptions {
  /** Project name argument (sanitized: no commas/CRLF, max 63 chars). */
  name?: string;
  /** Comments argument (sanitized: no commas/CRLF, max 255 chars). */
  comments?: string;
  /** Timestamp for the command argument (defaults to now; test hook). */
  now?: Date;
}

/** `dd/MM/yyyy HH:mm:ss` — the date format the SEND commands take (PROTOCOL.md §3.4). */
function formatSendDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/**
 * The command arguments are comma-separated, so commas and line breaks must
 * not survive (the desktop MAPS UrlEncodes them; stripping is equivalent for
 * the ASCII names/comments this app produces).
 */
function sanitizeSendArg(value: string, maxLength: number): string {
  return value.replace(/[,\r\n]+\s*/g, " ").trim().slice(0, maxLength);
}

export class GatewaySession {
  private readonly login: ClientLogin;
  private readonly events: SessionEvents;
  private readonly opts: Required<Omit<GatewaySessionOptions, "password" | "random" | "log" | "progress">>;
  private channel: Channel | undefined;
  private keepAliveTimer: ReturnType<typeof setInterval> | undefined;
  private busy = false;
  private closed = false;

  /** True after a successful LOGIN2 when the firmware encrypts the session. */
  encrypted = false;
  connected = false;

  constructor(
    private readonly link: Duplex,
    options: GatewaySessionOptions,
  ) {
    this.login = new ClientLogin(options.password, options.random);
    this.events = { log: options.log, progress: options.progress };
    this.opts = {
      greetingTimeoutMs: options.greetingTimeoutMs ?? 500,
      lineTimeoutMs: options.lineTimeoutMs ?? 10_000,
      transferTimeoutMs: options.transferTimeoutMs ?? 15_000,
      keepAliveIntervalMs: options.keepAliveIntervalMs ?? 80_000,
    };
  }

  /** LOGIN0/1/2 handshake, encryption decision and first INFO? (sonda `fer_login`). */
  async connect(): Promise<ConnectResult> {
    this.assertUsable();
    // Optional `00 00` greeting on TCP accept (PROTOCOL.md §7.4) — discarded.
    await this.link.read(this.opts.greetingTimeoutMs);

    this.link.write(new TextEncoder().encode(`LOGIN0=admin;${this.login.getLogin0()}\r\n\r\n`));
    this.events.log?.("LOGIN0 sent");

    const login1Line = await this.readCleartextLine((l) => l.includes("LOGIN1="));
    if (!login1Line) throw new GatewayError("protocol", "No LOGIN1 response from the gateway");
    this.login.processLogin1(login1Line.slice(login1Line.indexOf("LOGIN1=") + 7).trim());
    this.events.log?.("LOGIN1 received; session key derived");

    this.link.write(new TextEncoder().encode(`LOGIN2=${this.login.getLogin2()}\r\n\r\n`));
    this.events.log?.("LOGIN2 sent");

    // First message decides: cleartext SKT pattern = old firmware (PROTOCOL.md §3.1.5).
    const first = await this.link.read(this.opts.lineTimeoutMs);
    if (first === null || first.length === 0) {
      throw new GatewayError("timeout", "No response to LOGIN2");
    }
    let channel: Channel;
    if (isCleartextSkt(first)) {
      this.encrypted = false;
      channel = new Channel(this.link);
      channel.seed(first);
      this.events.log?.("Firmware without session encryption (SKT in cleartext)");
    } else {
      this.encrypted = true;
      channel = new Channel(this.link, this.login);
      const dec = this.login.decryptRx(first);
      channel.seed(dec);
      const text = new TextDecoder().decode(dec);
      if (text.includes("Client disconnected")) {
        throw new GatewayError("auth", "Gateway rejected the login (wrong password or busy session)");
      }
      if (!text.includes(" - OK")) {
        const extra = await channel.readLine(this.opts.lineTimeoutMs);
        const more = extra ? text + new TextDecoder().decode(extra) : text;
        if (more.includes("Client disconnected")) {
          throw new GatewayError("auth", "Gateway rejected the login (wrong password or busy session)");
        }
        if (!more.includes(" - OK")) {
          throw new GatewayError("auth", "LOGIN2 not acknowledged (wrong password?)");
        }
      }
      this.events.log?.("LOGIN OK (encrypted session)");
    }
    this.channel = channel;
    this.connected = true;

    const info = await this.queryInfo();
    this.startKeepAlive();
    return { info, encrypted: this.encrypted };
  }

  /** `INFO?` query: multiline `INFO:KEY:VALUE` closed by `INFO:END`. */
  async queryInfo(): Promise<GatewayInfo> {
    const channel = this.requireChannel();
    return this.withBusy(async () => {
      channel.sendLine("INFO?");
      const lines: string[] = [];
      const deadline = Date.now() + this.opts.lineTimeoutMs;
      for (;;) {
        const line = await channel.readLine(Math.max(1, deadline - Date.now()));
        if (line === null) break;
        const text = new TextDecoder().decode(line);
        lines.push(text);
        if (text.includes("INFO:END")) break;
        if (Date.now() >= deadline) break;
      }
      const joined = lines.join("");
      if (joined.includes("Client disconnected")) {
        throw new GatewayError("closed", "Gateway closed the session");
      }
      const info = parseInfoLines(joined);
      if (!info.complete) {
        throw new GatewayError("protocol", "INFO? response incomplete (missing INFO:END)");
      }
      this.events.log?.(`INFO? received (${info.entries.length} keys)`);
      return info;
    });
  }

  /**
   * `RECVCMPLT`: downloads the "complete" project blob via XMODEM-1K and
   * validates it (length header, CRC32, ZIP magic) before returning it.
   */
  async receiveComplete(): Promise<Uint8Array> {
    const channel = this.requireChannel();
    return this.withBusy(async () => {
      channel.sendLine("RECVCMPLT");
      this.events.log?.("RECVCMPLT sent");

      const ready = await this.readLineMatching(
        (l) => l.includes("RECVCMPLT:READY") || l.includes("INVALID"),
        this.opts.transferTimeoutMs,
      );
      if (!ready) throw new GatewayError("protocol", "No RECVCMPLT:READY response");
      if (ready.includes("INVALID")) {
        // Bare units answer RECVPROJ:INVALID to a RECVCMPLT (PROTOCOL.md §9).
        throw new GatewayError("no-project", "The gateway has no project stored");
      }
      const total = Number.parseInt(ready.split(":READY")[1].trim().replace(/^:/, ""), 10);
      if (!Number.isFinite(total) || total <= 0) {
        throw new GatewayError("protocol", `Malformed RECVCMPLT:READY line: ${ready.trim()}`);
      }
      this.events.log?.(`Gateway will send ${total} bytes; starting XMODEM-1K`);

      const rx = new XmodemReceiver();
      this.sendIfAny(channel, rx.begin());
      let received: Uint8Array | undefined;
      for (;;) {
        const chunk = await channel.readAvailable(5_000);
        if (chunk === null) throw new GatewayError("closed", "Connection lost during transfer");
        const step = chunk.length === 0 ? rx.onTimeout() : rx.push(chunk);
        this.sendIfAny(channel, step.send);
        this.events.progress?.(step.receivedBytes, total);
        if (step.status === "done") {
          received = step.data;
          // Bytes past the EOT (e.g. RECVCMPLT:OK) belong to the line channel.
          const leftover = rx.takePending();
          if (leftover.length > 0) channel.seed(leftover);
          break;
        }
        if (step.status === "cancelled") {
          throw new GatewayError("transfer", "Transfer cancelled by the gateway (CAN CAN)");
        }
        if (step.status === "failed") {
          throw new GatewayError("transfer", step.error ?? "XMODEM transfer failed");
        }
      }
      this.events.log?.(`XMODEM transfer complete (${rx.getReceivedBytes()} padded bytes)`);

      // Device-side validation: RECVCMPLT:OK or :ERR (the sonda ignored ERR;
      // this port does not — documented decision).
      const verdict = await this.readLineMatching(
        (l) => l.includes("RECVCMPLT:OK") || l.includes("RECVCMPLT:ERR"),
        this.opts.transferTimeoutMs,
      );
      if (verdict?.includes("RECVCMPLT:ERR")) {
        throw new GatewayError("transfer", "Gateway reported RECVCMPLT:ERR after the transfer");
      }
      if (!verdict) {
        this.events.log?.("Warning: no RECVCMPLT:OK within timeout; validating locally");
      }

      if (!received || received.length < total) {
        throw new GatewayError(
          "transfer",
          `Short transfer: got ${received?.length ?? 0}, expected ${total}`,
        );
      }
      const data = received.subarray(0, total);
      try {
        parseCompleteBlob(data);
      } catch (error) {
        throw new GatewayError(
          "invalid-blob",
          `Downloaded blob failed validation: ${error instanceof Error ? error.message : error}`,
        );
      }
      this.events.log?.(`Blob validated (${total} bytes, CRC32 OK)`);
      return data;
    });
  }

  /**
   * `SENDCMPLT`: uploads a "complete" blob (`[4B BE n][XBL][CRC32][ZIP]`) via
   * XMODEM-1K. **Writes configuration to the gateway** — the deploy flow
   * (src/server/deploy/) gates this behind family/capability/session checks.
   * Wire sequence per PROTOCOL.md §10 (live-validated round-trip).
   */
  async sendComplete(blob: Uint8Array, options: SendFileOptions = {}): Promise<void> {
    let zipLength: number;
    try {
      zipLength = parseCompleteBlob(blob).zip.length;
    } catch (error) {
      throw new GatewayError(
        "invalid-blob",
        `Refusing to upload a malformed blob: ${error instanceof Error ? error.message : error}`,
      );
    }
    // SENDCMPLT's length argument is the ZIP length only (PROTOCOL.md §10.2).
    await this.sendFile({
      command: "SENDCMPLT",
      filePrefix: "CMPLTFILE",
      // The sonda also accepts CONFIGFILE:OK as the final confirmation.
      okMarkers: ["CMPLTFILE:OK", "CONFIGFILE:OK"],
      payload: blob,
      lengthArg: zipLength,
      options,
    });
  }

  /**
   * `SENDPROJ`: uploads ONLY the project ZIP (no XBL). The firmware stores it
   * but does NOT recompile the running config from it (PROTOCOL.md §10,
   * SENDPROJ experiment) — deploys go through `sendComplete`.
   */
  async sendProject(zip: Uint8Array, options: SendFileOptions = {}): Promise<void> {
    if (zip.length < 2 || zip[0] !== 0x50 || zip[1] !== 0x4b) {
      throw new GatewayError("invalid-blob", "Refusing to upload: the payload is not a ZIP (no PK magic)");
    }
    await this.sendFile({
      command: "SENDPROJ",
      filePrefix: "PROJFILE",
      okMarkers: ["PROJFILE:OK"],
      payload: zip,
      lengthArg: zip.length,
      options,
    });
  }

  /** Shared SENDPROJ/SENDCMPLT flow (sonda `mode_puja` / `mode_pujaproy`). */
  private async sendFile(params: {
    command: string;
    /** Progress/verdict line prefix, e.g. `CMPLTFILE`. */
    filePrefix: string;
    okMarkers: string[];
    payload: Uint8Array;
    lengthArg: number;
    options: SendFileOptions;
  }): Promise<void> {
    const channel = this.requireChannel();
    const { command, filePrefix, okMarkers, payload, lengthArg, options } = params;
    return this.withBusy(async () => {
      // Pre-commands: pause comms/debug on both ports during the upload.
      for (const cmd of SEND_PRE_COMMANDS) {
        channel.sendLine(cmd);
        await this.readLineMatching(
          (l) => l.includes(" - OK") || l.includes("ERR") || l.includes("INVALID"),
          5_000,
        );
      }
      this.events.log?.("Gateway comms paused for the upload (SPONS/COMMS/DEBUG=0)");

      const name = sanitizeSendArg(options.name ?? "maps-cloud", 63);
      const comments = sanitizeSendArg(options.comments ?? "no_comments", 255);
      const date = formatSendDate(options.now ?? new Date());
      channel.sendLine(`${command},${name},${date},${comments},${lengthArg}`);
      this.events.log?.(`${command} sent (${payload.length} bytes to send)`);

      const ready = await this.readLineMatching(
        (l) => l.includes(`${filePrefix}:READY`) || l.includes("ERR") || l.includes("INVALID"),
        SEND_READY_TIMEOUT_MS,
      );
      if (!ready) throw new GatewayError("timeout", `No ${filePrefix}:READY response from the gateway`);
      if (ready.includes("ERR") || ready.includes("INVALID")) {
        throw new GatewayError("transfer", `Gateway refused the upload: ${ready.trim()}`);
      }
      this.events.log?.("Gateway ready; starting XMODEM-1K upload");

      const tx = new XmodemSender(payload);
      for (;;) {
        const chunk = await channel.readAvailable(5_000);
        if (chunk === null) throw new GatewayError("closed", "Connection lost during upload");
        const step = chunk.length === 0 ? tx.onTimeout() : tx.push(chunk);
        this.sendIfAny(channel, step.send);
        this.events.progress?.(step.sentBytes, payload.length);
        if (step.status === "done") break;
        if (step.status === "cancelled") {
          throw new GatewayError("transfer", "Upload cancelled by the gateway (CAN CAN)");
        }
        if (step.status === "failed") {
          throw new GatewayError("transfer", step.error ?? "XMODEM upload failed");
        }
      }
      this.events.log?.(`XMODEM upload complete (${payload.length} bytes); waiting for validation`);

      // Device-side validation: progress lines (logged), then OK/ERR.
      const deadline = Date.now() + SEND_VALIDATION_TIMEOUT_MS;
      for (;;) {
        const line = await channel.readLine(Math.max(1, deadline - Date.now()));
        if (line === null) break;
        const text = new TextDecoder().decode(line).trim();
        if (okMarkers.some((m) => text.includes(m))) {
          this.events.log?.(`Gateway accepted the upload (${text})`);
          return;
        }
        if (text.includes("ERR") || text.includes("INVALID")) {
          throw new GatewayError("transfer", `Gateway rejected the upload: ${text}`);
        }
        if (text.startsWith(`${filePrefix}:`)) this.events.log?.(`Gateway: ${text}`);
        if (Date.now() >= deadline) break;
      }
      throw new GatewayError("timeout", `No ${filePrefix}:OK within ${SEND_VALIDATION_TIMEOUT_MS / 1000} s`);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.link.close();
    this.events.log?.("Session closed");
  }

  private assertUsable(): void {
    if (this.closed) throw new GatewayError("closed", "Session is closed");
    if (this.connected) throw new GatewayError("busy", "Session is already connected");
  }

  private requireChannel(): Channel {
    if (this.closed || !this.connected || !this.channel) {
      throw new GatewayError("closed", "Session is not connected");
    }
    return this.channel;
  }

  private async withBusy<T>(op: () => Promise<T>): Promise<T> {
    if (this.busy) throw new GatewayError("busy", "Another operation is in progress");
    this.busy = true;
    try {
      return await op();
    } finally {
      this.busy = false;
    }
  }

  /** Cleartext line reader for the login phase (LOGIN1 arrives unencrypted). */
  private async readCleartextLine(match: (line: string) => boolean): Promise<string | undefined> {
    const channel = new Channel(this.link);
    const deadline = Date.now() + this.opts.lineTimeoutMs;
    for (;;) {
      const line = await channel.readLine(Math.max(1, deadline - Date.now()));
      if (line === null) return undefined;
      const text = new TextDecoder().decode(line);
      if (text.includes("Client disconnected")) {
        throw new GatewayError("auth", "Gateway rejected the login (wrong password or busy session)");
      }
      if (match(text)) return text;
      if (Date.now() >= deadline) return undefined;
    }
  }

  private async readLineMatching(
    match: (line: string) => boolean,
    timeoutMs: number,
  ): Promise<string | undefined> {
    const channel = this.requireChannel();
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const line = await channel.readLine(Math.max(1, deadline - Date.now()));
      if (line === null) return undefined;
      const text = new TextDecoder().decode(line);
      // `SKTn - OK` generic ACKs precede the real answer (PROTOCOL.md §8.2).
      if (match(text)) return text;
      if (Date.now() >= deadline) return undefined;
    }
  }

  private sendIfAny(channel: Channel, bytes: Uint8Array): void {
    if (bytes.length > 0) channel.send(bytes);
  }

  private startKeepAlive(): void {
    if (this.opts.keepAliveIntervalMs <= 0) return;
    this.keepAliveTimer = setInterval(() => {
      if (this.connected && !this.closed) this.events.log?.("keepalive");
    }, this.opts.keepAliveIntervalMs);
    this.keepAliveTimer.unref?.();
  }
}

/** `SKT<digit> -` first-message pattern: old firmware, session stays cleartext. */
function isCleartextSkt(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 6 &&
    bytes[0] === 0x53 && // S
    bytes[1] === 0x4b && // K
    bytes[2] === 0x54 && // T
    bytes[3] >= 0x30 &&
    bytes[3] <= 0x39 &&
    bytes[4] === 0x20 && // space
    bytes[5] === 0x2d // '-'
  );
}
