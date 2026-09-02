/**
 * Pure helpers for the Diagnostics screen: parsing the gateway monitor stream
 * (SPONS/COMMS console pushes) into traffic frames, console signal-id mapping
 * and rolling traffic rates. No React here so the logic is unit-testable.
 *
 * Console protocol reference: docs/reference/console-protocol.md.
 */

export type MonitorProto = "KNX" | "MODBUS" | "SYS";
export type MonitorDir = "TX" | "RX" | "—";

export interface MonitorFrame {
  /** Monotonically increasing index assigned by the screen (stable row key). */
  i: number;
  /** ISO timestamp of when the gateway pushed the line. */
  at: string;
  proto: MonitorProto;
  dir: MonitorDir;
  /** Hex bytes after `[Tx]`/`[Rx]`; "" for spontaneous pushes and SYS lines. */
  frame: string;
  /** Decoded text — the raw console line, unmodified. */
  dec: string;
  /** Object id for spontaneous pushes (`0KX:00020003=…` → `00020003`); "" otherwise. */
  obj: string;
}

/** `0KX:<objIdx1based hex4><GA hex4>=<value>;<flags>` spontaneous push / read answer. */
export interface KnxPush {
  /** 1-based config object index (signal.id + 1). */
  objIdx: number;
  /** Numeric 16-bit KNX group address. */
  groupAddress: number;
  value: string;
}

/** `1MM:<extId hex8>=<value>;<flags>` spontaneous push / read answer. */
export interface MbmPush {
  /** External Modbus id (best-effort: index among active signals, 0-based). */
  extId: number;
  value: string;
}

const TX_RX_RE = /\[(Tx|Rx)\]\s*(.*)$/i;
const PUSH_ID_RE = /^[0-9A-Za-z]{3}:([0-9A-Fa-f]+)=/;
const KNX_PUSH_RE = /^0KX:([0-9A-Fa-f]{4})([0-9A-Fa-f]{4})=([^;]*)/;
const MBM_PUSH_RE = /^1MM:([0-9A-Fa-f]{8})=([^;]*)/;
const FAILURE_RE = /NO RESPONSE|failure|Blocked|Timeout|No ACK/;
const TIMEOUT_RE = /Timeout|NO RESPONSE/;

/** Parse one raw monitor line (SPONS/COMMS push) into a traffic frame. */
export function parseMonitorLine(line: string, i: number, at: string): MonitorFrame {
  const proto: MonitorProto = line.startsWith("1MM:")
    ? "MODBUS"
    : line.startsWith("0KX:")
      ? "KNX"
      : "SYS";

  const txrx = TX_RX_RE.exec(line);
  if (txrx) {
    return {
      i,
      at,
      proto,
      dir: txrx[1].toUpperCase() === "TX" ? "TX" : "RX",
      frame: txrx[2].trim(),
      dec: line,
      obj: "",
    };
  }

  const push = PUSH_ID_RE.exec(line);
  if (push) {
    return { i, at, proto, dir: "—", frame: "", dec: line, obj: push[1] };
  }

  return { i, at, proto, dir: "—", frame: "", dec: line, obj: "" };
}

/** Parse a `0KX:<objIdx><GA>=<value>` push/answer; null when the line is not one. */
export function parseKnxPush(line: string): KnxPush | null {
  const match = KNX_PUSH_RE.exec(line);
  if (!match) return null;
  return {
    objIdx: parseInt(match[1], 16),
    groupAddress: parseInt(match[2], 16),
    value: match[3],
  };
}

/** Parse a `1MM:<extId>=<value>` push/answer; null when the line is not one. */
export function parseMbmPush(line: string): MbmPush | null {
  const match = MBM_PUSH_RE.exec(line);
  if (!match) return null;
  return { extId: parseInt(match[1], 16), value: match[2] };
}

/** Console object id for a KNX-side signal: objIdx (1-based hex4) + GA (hex4). */
export function knxConsoleId(objIdx1based: number, groupAddress: number): string {
  return (
    objIdx1based.toString(16).padStart(4, "0") +
    Math.max(0, groupAddress).toString(16).padStart(4, "0")
  );
}

/** Console external id for a Modbus-side signal: active-signal index (hex8). */
export function mbmConsoleId(activeIndex: number): string {
  return activeIndex.toString(16).padStart(8, "0");
}

/** `<id>=<value>;<flags>` read answer → the value text; null when invalid/absent. */
export function parseReadValue(line: string): string | null {
  const match = /=([^;]*);/.exec(line);
  if (!match) return null;
  const value = match[1].trim();
  // Per console-protocol.md §4: `f` or empty means invalid/255.
  return value === "" || value === "f" ? null : value;
}

/** True for decoded texts the monitor paints red (NO RESPONSE, failure, …). */
export function isFailureText(text: string): boolean {
  return FAILURE_RE.test(text);
}

/** True for lines counted as timeouts in the Communication stats. */
export function isTimeoutText(text: string): boolean {
  return TIMEOUT_RE.test(text);
}

export interface RollingRates {
  /** KNX frames inside the window (≈ telegrams/min for a 60 s window). */
  knxPerMin: number;
  /** Modbus frames inside the window. */
  modbusPerMin: number;
  /** Modbus frames per second inside the window. */
  modbusPerSec: number;
}

/** Rolling-window rates over the received frames (client-side, honest). */
export function rollingRates(
  frames: { at: string; proto: MonitorProto }[],
  nowMs: number,
  windowMs = 60_000,
): RollingRates {
  let knx = 0;
  let modbus = 0;
  for (const frame of frames) {
    const t = Date.parse(frame.at);
    if (Number.isNaN(t) || t > nowMs || nowMs - t > windowMs) continue;
    if (frame.proto === "KNX") knx += 1;
    else if (frame.proto === "MODBUS") modbus += 1;
  }
  return { knxPerMin: knx, modbusPerMin: modbus, modbusPerSec: modbus / (windowMs / 1000) };
}

/** Footer label, e.g. `KNX 24 tg/min · Modbus 0.4 req/s`. */
export function formatRates(rates: RollingRates): string {
  return `KNX ${rates.knxPerMin} tg/min · Modbus ${rates.modbusPerSec.toFixed(1)} req/s`;
}

/** `HH:MM:SS.mmm` for traffic rows; "" when the timestamp is invalid. */
export function formatFrameTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

/** `[HH:MM:SS.mmm]` console timestamp. */
export function formatConsoleStamp(date: Date): string {
  return `[${date.toTimeString().slice(0, 8)}.${String(date.getMilliseconds()).padStart(3, "0")}]`;
}

/** `HH:MM:SS` for the LAST OPERATION column. */
export function formatClock(date: Date): string {
  return date.toTimeString().slice(0, 8);
}

/** Compact session uptime: `2d 4h 12m`, `3h 5m`, `12m 30s`. */
export function formatUptime(connectedAtIso: string, nowMs: number): string {
  const start = Date.parse(connectedAtIso);
  if (Number.isNaN(start) || nowMs < start) return "—";
  const s = Math.floor((nowMs - start) / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}
