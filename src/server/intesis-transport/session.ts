import "server-only";
import { parseCompleteBlob } from "@/core/project-format/complete-blob";
import { ClientLogin, type RandomSource } from "./crypto/dh";
import { consolePrefixesFor, type ConsolePrefixes } from "./console-prefixes";
import { parseInfoLines, summarizeInfo, type GatewayInfo } from "./info";
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
 * Diagnostics (docs/reference/console-protocol.md, live-validated): free-text
 * console commands (`runConsoleCommand` — responses close on an idle gap
 * because unknown commands are answered with silence) and the live monitor
 * (`setMonitor` — `<port><PREFIX>:SPONS=1`/`COMMS=1` on both ports, pushed lines are routed
 * to a listener). A single pump loop owns channel reads while diagnostics is
 * active; transfers suspend it (`withPumpSuspended`).
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

/** The MAPS waits up to 20 s for `<TYPE>FILE:READY` (PROTOCOL.md §10.3). */
const SEND_READY_TIMEOUT_MS = 20_000;
/** The gateway can take a while to apply the received config (sonda: 60 s). */
const SEND_VALIDATION_TIMEOUT_MS = 60_000;
/** Fast close for SPONS/COMMS/DEBUG toggles: the ACK is a single `<port><PREFIX>:OK` line. */
const TOGGLE_OPTS: ConsoleCommandOptions = {
  idleMs: 80,
  timeoutMs: 3_000,
  doneWhen: (line) => /^[0-2][A-Z]{2}:OK$/.test(line) || line.includes("ERR"),
};

/** `<port><PREFIX>:` head of a protocol console line (`0KX:`, `1MM:`). */
const PROTOCOL_HEAD_RE = /^([0-2][A-Z]{2}):/;

/**
 * True when `line` answers `command`: same `<port><PREFIX>` and either an
 * ACK/error or the value of the signal the command addressed. Any other
 * protocol line is a push (SPONS/COMMS/DEBUG) that only coincides in time.
 */
export function isCommandAnswer(command: string, line: string): boolean {
  const head = PROTOCOL_HEAD_RE.exec(line)?.[1];
  if (!head) return true;
  if (PROTOCOL_HEAD_RE.exec(command)?.[1] !== head) return false;
  const rest = line.slice(head.length + 1);
  if (rest === "OK" || rest.startsWith("Unknown") || rest.includes("ERR")) return true;
  const id = /^([0-9A-Fa-f]+)[?=]/.exec(command.slice(head.length + 1))?.[1];
  return id !== undefined && rest.toUpperCase().startsWith(`${id.toUpperCase()}=`);
}

/** Monitor toggles, in the MAPS order (frmMain.cs:2153-2181). */
const MONITOR_TOGGLES = ["SPONS", "COMMS", "DEBUG"] as const;

export interface MonitorOptions {
  /**
   * `DEBUG=1` on both ports. Off by default like the MAPS "Debug" checkbox:
   * it adds bus timeouts (`1MM:RTUB Timeout!`) but also firmware internals
   * (`0KX:DB_MSG …`) and a second decoded `[Tx]` line per Modbus request.
   */
  debug?: boolean;
}

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

  /** True when the remote end closed and the buffer is drained. */
  isEof(): boolean {
    return this.eof && this.buf.length === 0;
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

export interface ConsoleResult {
  /** Response lines (CRLF stripped; SKT ACKs included). Empty = silent command. */
  lines: string[];
  /** True when the overall deadline hit (the idle gap never completed). */
  timedOut: boolean;
}

export interface ConsoleCommandOptions {
  /** Idle gap after the last received line that closes the response (default 600 ms). */
  idleMs?: number;
  /** Overall deadline (default 10000 ms). Unknown commands are answered with
   *  silence by the firmware, so callers must rely on timeouts, not errors. */
  timeoutMs?: number;
  /** Early completion when a line matches (e.g. `INFO:END`): on a chatty bus
   *  SPONS/COMMS pushes keep resetting the idle gap, so known terminators
   *  must close the response without waiting for silence. */
  doneWhen?: (line: string) => boolean;
}

/** Pending console-command response collector, fed by the pump loop. */
interface ConsoleCollector {
  command: string;
  lines: string[];
  lastLineAt: number;
  deadline: number;
  idleMs: number;
  doneWhen?: (line: string) => boolean;
  resolve: (result: ConsoleResult) => void;
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
  // Diagnostics console/monitor: a single pump loop owns the channel reads and
  // routes lines either to the pending console collector or to the monitor
  // listener (SPONS/COMMS pushes). Transfers suspend the pump to regain raw
  // channel access (see withPumpSuspended).
  private pumpDesired = false;
  private pumpRunning = false;
  private collector: ConsoleCollector | null = null;
  private monitorOn = false;
  private monitorListener: ((line: string) => void) | undefined;
  private monitorDebug = false;
  /** Console prefixes of the connected application (from INFO? APPID). */
  private prefixes: ConsolePrefixes | undefined;

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
    this.prefixes = consolePrefixesFor(summarizeInfo(info).appId);
    this.startKeepAlive();
    return { info, encrypted: this.encrypted };
  }

  /** `INFO?` query: multiline `INFO:KEY:VALUE` closed by `INFO:END`. */
  async queryInfo(): Promise<GatewayInfo> {
    const channel = this.requireChannel();
    return this.withBusy(async () => {
      // With the diagnostics pump running, the channel is owned by the pump:
      // go through the console collector instead of reading directly.
      const lines = this.pumpRunning
        ? (
            await this.commandLocked("INFO?", {
              timeoutMs: this.opts.lineTimeoutMs,
              doneWhen: (line) => line.includes("INFO:END"),
            })
          ).lines
        : await this.readInfoLines(channel);
      const joined = lines.join("\n");
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

  private async readInfoLines(channel: Channel): Promise<string[]> {
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
    return lines;
  }

  /**
   * `RECVCMPLT`: downloads the "complete" project blob via XMODEM-1K and
   * validates it (length header, CRC32, ZIP magic) before returning it.
   */
  async receiveComplete(): Promise<Uint8Array> {
    const channel = this.requireChannel();
    return this.withBusy(() =>
      this.withPumpSuspended(async () => {
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
      }),
    );
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
    return this.withBusy(() =>
      this.withPumpSuspended(async () => {
      // Pre-commands: pause comms/debug on both ports during the upload, with
      // the application's prefix like the MAPS (frmSendSingle.cs:303,
      // `0KX:SPONS=0`); an unknown application keeps the MAPS empty prefix.
      const prefixes = this.prefixes ?? ["", ""];
      for (const toggle of MONITOR_TOGGLES) {
        for (const [port, prefix] of prefixes.entries()) {
          channel.sendLine(`${port}${prefix}:${toggle}=0`);
          await this.readLineMatching(
            (l) =>
              /^[0-2][A-Z]{2}:OK\b/.test(l) ||
              l.includes(" - OK") ||
              l.includes("ERR") ||
              l.includes("INVALID"),
            5_000,
          );
        }
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
      }),
    );
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    this.pumpDesired = false;
    this.monitorOn = false;
    if (this.collector) {
      this.collector.resolve({ lines: this.collector.lines, timedOut: false });
      this.collector = null;
    }
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.link.close();
    this.events.log?.("Session closed");
  }

  /** True while the live monitor (SPONS/COMMS pushes) is enabled. */
  get monitoring(): boolean {
    return this.monitorOn;
  }

  /** True while the live monitor also has `DEBUG=1` on. */
  get monitoringDebug(): boolean {
    return this.monitorOn && this.monitorDebug;
  }

  /**
   * Free-text console command (docs/reference/console-protocol.md). Sends the
   * line and collects response lines until an idle gap (`idleMs`) or the
   * overall deadline (`timeoutMs`): the firmware answers unknown commands
   * with silence, so the idle gap is the universal terminator.
   */
  async runConsoleCommand(command: string, options: ConsoleCommandOptions = {}): Promise<ConsoleResult> {
    this.requireChannel();
    if (/[\r\n]/.test(command)) {
      throw new GatewayError("protocol", "Console commands must be a single line");
    }
    return this.withBusy(() => this.commandLocked(command.trim(), options));
  }

  /**
   * Enables/disables the live monitor: `SPONS=1` + `COMMS=1` (+ `DEBUG=1`
   * with `options.debug`) on both ports, with the application's prefix
   * (`0KX:SPONS=1`, `1MM:SPONS=1`; docs/reference/console-protocol.md §2).
   * While enabled, every pushed line is routed to `listener`. Toggling ACKs
   * are consumed internally.
   */
  async setMonitor(
    enabled: boolean,
    listener?: (line: string) => void,
    options: MonitorOptions = {},
  ): Promise<void> {
    this.requireChannel();
    const prefixes = this.prefixes;
    if (!prefixes) {
      // Unknown application: nothing was enabled, so only enabling is an error.
      if (!enabled) return;
      throw new GatewayError("protocol", "The live monitor does not support this gateway application");
    }
    return this.withBusy(async () => {
      this.ensurePump();
      // Disable first so a re-subscribe never stacks pushes on the gateway.
      await this.toggleMonitor(prefixes, false, true);
      this.monitorOn = false;
      this.monitorListener = undefined;
      if (!enabled) {
        // Nothing left to read for: let the pump wind down (a later console
        // command or monitor enable restarts it via ensurePump).
        this.pumpDesired = false;
        return;
      }
      const debug = options.debug ?? false;
      await this.toggleMonitor(prefixes, true, debug);
      this.monitorListener = listener;
      this.monitorDebug = debug;
      this.monitorOn = true;
      this.events.log?.(
        `Diagnostics monitor enabled (SPONS/COMMS${debug ? "/DEBUG" : ""} on both ports)`,
      );
    });
  }

  /**
   * `SPONS`/`COMMS` (and `DEBUG` when `debug`) on both ports, busy lock held.
   * Disabling always includes DEBUG so no stale debug stream survives.
   */
  private async toggleMonitor(prefixes: ConsolePrefixes, on: boolean, debug: boolean): Promise<void> {
    const value = on ? 1 : 0;
    for (const toggle of MONITOR_TOGGLES) {
      if (toggle === "DEBUG" && !debug) continue;
      for (const [port, prefix] of prefixes.entries()) {
        await this.commandLocked(`${port}${prefix}:${toggle}=${value}`, TOGGLE_OPTS);
      }
    }
  }

  /** Console command with the busy lock already held (collector round-trip). */
  private async commandLocked(command: string, options: ConsoleCommandOptions = {}): Promise<ConsoleResult> {
    const channel = this.requireChannel();
    this.ensurePump();
    const idleMs = options.idleMs ?? 600;
    const timeoutMs = options.timeoutMs ?? 10_000;
    const result = new Promise<ConsoleResult>((resolve) => {
      const now = Date.now();
      this.collector = {
        command,
        lines: [],
        lastLineAt: now,
        deadline: now + timeoutMs,
        idleMs,
        doneWhen: options.doneWhen,
        resolve,
      };
    });
    channel.sendLine(command);
    return result;
  }

  /** Starts the pump loop if it is not running yet. */
  private ensurePump(): void {
    this.pumpDesired = true;
    if (!this.pumpRunning) void this.pumpLoop();
  }

  /**
   * Single reader of the channel while diagnostics is active. Routes each line
   * to the pending console collector or, when the monitor is on, to the
   * monitor listener. A collector closes after `idleMs` without new lines.
   */
  private async pumpLoop(): Promise<void> {
    if (this.pumpRunning) return;
    this.pumpRunning = true;
    const channel = this.requireChannel();
    try {
      while (!this.closed && this.pumpDesired) {
        const line = await channel.readLine(250);
        const now = Date.now();
        if (line !== null) {
          const text = new TextDecoder().decode(line).replace(/\r\n$/, "");
          // Like the MAPS (ManageConsoleViewers, frmMain.cs:3274), pushes are
          // routed by line type, not by the command that happens to be pending.
          if (this.collector && this.monitorOn && !isCommandAnswer(this.collector.command, text)) {
            this.monitorListener?.(text);
          } else if (this.collector) {
            this.collector.lines.push(text);
            this.collector.lastLineAt = now;
            if (this.collector.doneWhen?.(text)) {
              const done = this.collector;
              this.collector = null;
              done.resolve({ lines: done.lines, timedOut: false });
            }
          } else if (this.monitorOn) {
            this.monitorListener?.(text);
          } else {
            this.events.log?.(`Unsolicited line: ${text}`);
          }
        }
        const collector = this.collector;
        if (collector && (now - collector.lastLineAt >= collector.idleMs || now >= collector.deadline)) {
          this.collector = null;
          collector.resolve({ lines: collector.lines, timedOut: now >= collector.deadline });
        }
        if (channel.isEof()) {
          this.connected = false;
          this.events.log?.("Connection lost (gateway closed the session)");
          break;
        }
      }
    } finally {
      this.pumpRunning = false;
      const collector = this.collector;
      if (collector) {
        this.collector = null;
        collector.resolve({ lines: collector.lines, timedOut: false });
      }
    }
  }

  /** Stops the pump so transfers regain raw channel access (XMODEM is binary). */
  private async suspendPump(): Promise<void> {
    this.pumpDesired = false;
    const deadline = Date.now() + 2_000;
    while (this.pumpRunning && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (this.pumpRunning) {
      throw new GatewayError("busy", "Could not pause the diagnostics monitor");
    }
  }

  /**
   * Runs a transfer with the diagnostics pump suspended and the gateway pushes
   * off; restores the monitor afterwards when it was enabled. The gateway-side
   * re-enable goes through console commands so the toggling ACKs never reach
   * the monitor listener.
   */
  private async withPumpSuspended<T>(op: () => Promise<T>): Promise<T> {
    const resume = this.monitorOn;
    const listener = this.monitorListener;
    // monitorOn implies known prefixes (setMonitor refuses to enable without).
    const prefixes = this.prefixes;
    if (resume && prefixes) {
      await this.toggleMonitor(prefixes, false, true);
      this.monitorOn = false;
    }
    await this.suspendPump();
    try {
      return await op();
    } finally {
      if (resume && prefixes && this.connected && !this.closed) {
        try {
          this.ensurePump();
          await this.toggleMonitor(prefixes, true, this.monitorDebug);
          this.monitorListener = listener;
          this.monitorOn = true;
        } catch {
          this.events.log?.("Could not resume the diagnostics monitor after the transfer");
        }
      }
    }
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
