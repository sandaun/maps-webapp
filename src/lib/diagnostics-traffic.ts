import type { ProjectView } from "./project-types";
import { diagnosticSignals, type DiagnosticSignal } from "./diagnostics-signals";
import { isTimeoutText, type MonitorFrame } from "./diagnostics-parsing";

export interface TrafficSignalMatch {
  label: string;
  detail: string;
}

interface Request {
  bytes: number[];
  at: number;
  timeout: number;
  signals: DiagnosticSignal[];
}

function hexBytes(text: string): number[] | null {
  if (!/^[\da-f]{2}(?:\s+[\da-f]{2})*$/i.test(text)) return null;
  return text.split(/\s+/).map((byte) => Number.parseInt(byte, 16));
}

/** Modbus serial-line CRC, including the trailing low/high bytes. */
function validRtu(bytes: number[]): boolean {
  if (bytes.length < 5 || bytes.length > 256) return false;
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xa001 : 0);
  }
  return crc === 0;
}

function word(bytes: number[], offset: number): number {
  return bytes[offset] * 256 + bytes[offset + 1];
}

function requestRange(bytes: number[]): { address: number; count: number } | null {
  const fn = bytes[1];
  if ([1, 2, 3, 4, 5, 6].includes(fn)) {
    if (bytes.length !== 8) return null;
    if (fn === 5 && ![0, 0xff00].includes(word(bytes, 4))) return null;
    const count = fn <= 4 ? word(bytes, 4) : 1;
    if (count < 1 || count > (fn <= 2 ? 2000 : 125) || word(bytes, 2) + count > 65536) return null;
    return { address: word(bytes, 2), count };
  }
  if (fn === 15 || fn === 16) {
    if (bytes.length < 10) return null;
    const count = word(bytes, 4);
    const size = fn === 15 ? Math.ceil(count / 8) : count * 2;
    if (count < 1 || count > (fn === 15 ? 1968 : 123) || word(bytes, 2) + count > 65536
      || bytes[6] !== size || bytes.length !== size + 9) return null;
    return { address: word(bytes, 2), count };
  }
  return null;
}

function validResponse(bytes: number[], request: number[]): boolean {
  if (bytes[0] !== request[0]) return false;
  if (bytes[1] === (request[1] | 0x80)) return bytes.length === 5;
  if (bytes[1] !== request[1]) return false;
  if (request[1] <= 4) {
    const size = request[1] <= 2 ? Math.ceil(word(request, 4) / 8) : word(request, 4) * 2;
    return bytes[2] === size && bytes.length === size + 5;
  }
  return bytes.length === 8 && bytes.slice(2, 6).every((byte, i) => byte === request[i + 2]);
}

function matchLabel(signals: DiagnosticSignal[], fallback: string): TrafficSignalMatch {
  if (signals.length === 0) return { label: fallback || "—", detail: fallback
    ? `Runtime signal ID ${fallback}; no matching signal in the current project.`
    : "No signal could be identified from this frame and the current project." };
  const names = signals.map((signal) => signal.description || `Signal ${signal.id + 1}`);
  return {
    label: signals.length === 1 ? names[0] : `${signals.length} signals`,
    detail: signals.map((signal, i) => `${names[i]} · ${signal.mapping}`).join("\n"),
  };
}

/**
 * Resolve traffic against the current project, never by arrival order alone.
 * RTU replies need a valid preceding request on the same bus, CRC, matching
 * function/length and the device's response deadline. TCP and unsupported
 * telegram formats remain unassigned rather than guessing a signal.
 */
export function diagnosticTrafficSignals(view: ProjectView | null, frames: MonitorFrame[]): Map<number, TrafficSignalMatch> {
  const resolver = createDiagnosticTrafficResolver(view);
  return new Map(frames.map((frame) => [frame.i, resolver.resolve(frame)]));
}

/** Pending RTU requests survive batches. Each retained frame is decoded once,
 * while WeakMap keys allow discarded history to be garbage-collected. */
export function createDiagnosticTrafficResolver(view: ProjectView | null) {
  const cache = new WeakMap<MonitorFrame, TrafficSignalMatch>();
  let lastSequence: number | undefined;
  const signals = diagnosticSignals(view)?.filter((signal) => signal.active) ?? [];
  const pending = new Map<string, Request>();
  const endpoints = new Map<string, DiagnosticSignal[]>();
  for (const signal of signals) {
    for (const endpoint of Object.values(signal.endpoints)) {
      if (!endpoint) continue;
      const key = endpoint.toUpperCase();
      endpoints.set(key, [...(endpoints.get(key) ?? []), signal]);
    }
  }
  return {
    resolve(frame: MonitorFrame): TrafficSignalMatch {
      const cached = cache.get(frame);
      if (cached) return cached;
      if (lastSequence !== undefined && frame.i !== lastSequence + 1) pending.clear();
      lastSequence = frame.i;
      let matched: DiagnosticSignal[] = [];
      if (frame.obj) matched = endpoints.get(frame.dec.slice(0, frame.dec.indexOf("=")).toUpperCase()) ?? [];
      const supported = view !== null;
      const rtu = /^([012](?:MM|MS):RTU[AB])\b/i.exec(frame.dec)?.[1].toUpperCase();
      if (rtu && isTimeoutText(frame.dec)) pending.delete(rtu);
      const bytes = hexBytes(frame.frame);
      if (view && view.family !== "me-mbs" && bytes && frame.proto === "KNX") {
        const head = view.family === "knx-mbm" ? "0KX:" : "1KX:";
        // Standard TP1 frame: group destination, length nibble and checksum.
        if (frame.dec.startsWith(head) && bytes.length >= 9 && (bytes[0] & 0xd0) === 0x90
          && (bytes[5] & 0x80) !== 0 && bytes.length === (bytes[5] & 0x0f) + 8
          && bytes.reduce((checksum, byte) => checksum ^ byte, 0) === 0xff) {
          const ga = word(bytes, 3);
          const ids = new Set(view.project.signals.filter((signal) => signal.active
            && (signal.knx.groupAddress === ga || (frame.dir === "RX" && signal.knx.additionalAddresses.includes(ga))))
            .map((signal) => signal.id));
          matched = signals.filter((signal) => ids.has(signal.id));
        }
      }
      if (supported && rtu && frame.proto === "MODBUS" && frame.dir !== "—") {
        const head = view.family === "knx-mbm" ? "1MM:" : "0MS:";
        const isRequest = frame.dir === (view.family === "knx-mbm" ? "TX" : "RX");
        if (frame.dec.startsWith(head)) {
          // A new request supersedes the old one even when it cannot be parsed.
          const previous = pending.get(rtu);
          if (isRequest || !bytes || !validRtu(bytes)) pending.delete(rtu);
          if (bytes && validRtu(bytes)) {
            if (isRequest) {
              const range = requestRange(bytes);
              let timeout = 0;
              if (range) {
                const ids = new Set<number>();
                if (view.family === "knx-mbm" && view.project.mbm.enabled && view.project.mbm.media !== 1) {
                  for (const signal of view.project.signals) {
                    const mb = signal.modbus;
                    const node = view.project.mbm.rtuNodes[mb.port];
                    const device = node?.devices[mb.deviceIndex];
                    // Broadcasts can reach devices with different register bases.
                    if (!signal.active || signal.modbusVirtual || mb.isBroadcast || !node
                      || `RTU${node.physicalPort === 0 ? "A" : "B"}` !== rtu.slice(-4)
                      || !device?.enabled || device.slave !== bytes[0]) continue;
                    const fn = bytes[1];
                    if ((fn <= 4 ? mb.readFunc : mb.writeFunc) !== fn) continue;
                    const address = mb.address - device.baseRegister;
                    const width = fn <= 2 || fn === 5 || fn === 15 ? 1 : Math.max(1, Math.ceil(mb.lenBits / 16));
                    if (address >= 0 && address < range.address + range.count && address + width > range.address) {
                      ids.add(signal.id);
                      timeout = Math.max(timeout, device.timeout);
                    }
                  }
                } else if (view.family !== "knx-mbm" && view.project.mbs.media !== 1 && [3, 6, 16].includes(bytes[1])) {
                  const config = view.project.mbs;
                  for (const signal of view.project.signals) {
                    const slave = config.slaveAddressMode === 1 && config.slaves.length > 0
                      ? config.slaves[signal.modbus.slaveIndex]?.address : config.rtu.slaveNumber;
                    const address = signal.modbus.address - config.registerBase;
                    // For strings only the starting register is unambiguous here.
                    const width = signal.modbus.format === 5 ? 1 : Math.max(1, Math.ceil(signal.modbus.lenBits / 16));
                    if (signal.active && slave === bytes[0] && address >= 0
                      && address < range.address + range.count && address + width > range.address) ids.add(signal.id);
                  }
                }
                matched = signals.filter((signal) => ids.has(signal.id));
                if (bytes[0] !== 0) pending.set(rtu, { bytes, at: Date.parse(frame.at), timeout: timeout || 1000, signals: matched });
              }
            } else {
              pending.delete(rtu);
              const elapsed = Date.parse(frame.at) - (previous?.at ?? NaN);
              if (previous && elapsed >= 0 && elapsed <= previous.timeout && validResponse(bytes, previous.bytes)) matched = previous.signals;
            }
          }
        }
      }
      const match = matchLabel(matched, frame.obj);
      cache.set(frame, match);
      return match;
    },
  };
}
