import "server-only";
import { strict as assert } from "node:assert";
import { unzipSync, zipSync } from "fflate";
import { XmlDocument, parseCompleteBlob, buildCompleteBlob } from "@/core/project-format";
import { decodeElements, childByTag } from "@/core/xbl/decode";
import { generateKnxMbmXbl } from "@/gateway-families/knx-mbm/xbl/generate";
import { projectFromXml } from "@/gateway-families/knx-mbm/from-xml";
import { addSignal, updateSignal, updateMbmConfig, addDevice, updateDevice } from "@/gateway-families/knx-mbm/xml-ops";
import { validateProject } from "@/gateway-families/knx-mbm/validate";
import { detectFamily } from "@/server/projects/families";
import { runXblPipeline } from "@/gateway-families/knx-mbm/xbl/pipeline";
import { MAX_ACTIVE_SIGNALS, MAX_TOTAL_SIGNAL_ROWS } from "@/core/signals/model";
import type { ScanInput, ScanPoint, ScanFunction } from "@/core/modbus-scan/model";

export function buildScanBatch(backup: Uint8Array, input: ScanInput, points: ScanPoint[]) {
  const parsed = parseCompleteBlob(backup); const archive = unzipSync(parsed.zip);
  const name = Object.keys(archive).find((entry) => entry.endsWith(".ibmaps")); assert(name, "Backup contains no project");
  const doc = XmlDocument.parse(new TextDecoder().decode(archive[name]));
  assert.equal(detectFamily(doc)?.id, "knx-mbm", "Live project must be KNX–MBM");
  const before = projectFromXml(doc); const node = before.mbm.rtuNodes[input.locator.nodeIndex];
  assert(node && before.mbm.media !== 1, "Requested RTU node is not active in the live gateway configuration");
  assert(before.signals.filter((s) => s.active).length + points.length <= MAX_ACTIVE_SIGNALS && before.signals.length + points.length <= MAX_TOTAL_SIGNAL_ROWS, "Batch exceeds the available project capacity; reduce points per batch");
  let deviceIndex = node.devices.findIndex((device) => device.slave === input.slave);
  if (deviceIndex < 0) { deviceIndex = addDevice(doc, input.locator); updateDevice(doc, { ...input.locator, deviceIndex }, { slave: input.slave, name: `Scan slave ${input.slave}`, enabled: true, baseRegister: 0 }); }
  else assert(node.devices[deviceIndex].enabled, "The target device is disabled in the live configuration");
  const base = deviceIndex < node.devices.length ? node.devices[deviceIndex].baseRegister : 0;
  updateMbmConfig(doc, { pollRecords: { enabled: false } });
  const used = new Set(before.signals.map((signal) => signal.knx.groupAddress)); let ga = 1;
  for (const point of points) {
    while (used.has(ga)) ga++; assert(ga <= 0x7fff, "No free KNX group address available"); used.add(ga);
    const id = addSignal(doc); const bit = point.function <= 2;
    updateSignal(doc, id, { active: true, description: `Scan FC${point.function} PDU ${point.address}`, knx: { dpt: bit ? 0x0101 : 0x0701, groupAddress: ga, additionalAddresses: [], flags: { r: true, t: false, ri: false, w: false, u: false } }, modbus: { port: input.locator.nodeIndex, deviceIndex, isBroadcast: false, readFunc: point.function, writeFunc: -1, lenBits: bit ? 1 : 16, format: bit ? -1 : 0, byteOrder: bit ? -1 : 0, bit: -1, numOfBits: -1, address: point.address + base, deadband: 0 } });
  }
  const after = projectFromXml(doc); assert.deepEqual(after.signals.slice(0, before.signals.length), before.signals);
  const errors = validateProject(after).filter((issue) => issue.severity === "error"); assert.equal(errors.length, 0, errors.map((issue) => issue.message).join("; "));
  const header = decodeElements(parsed.xbl).find((element) => element.tag === 1)!;
  const bytes = (tag: number) => { const child = childByTag(header, tag); return parsed.xbl.subarray(child.contentOffset, child.contentOffset + child.contentLength); };
  const t = bytes(4); const options = { now: new Date(2000 + t[2], t[1] - 1, t[0], t[3], t[4], t[5]), swVersion: Array.from(bytes(2)) as [number, number, number, number], appId: 4 };
  // Refuse hardware writes when this live backup cannot round-trip exactly.
  assert(Buffer.from(generateKnxMbmXbl(new TextDecoder().decode(archive[name]), options)).equals(Buffer.from(parsed.xbl)), "Live XBL cannot be reproduced exactly; scan is unavailable for this configuration");
  const xml = doc.serialize(); archive[name] = new TextEncoder().encode(xml);
  const enabled = runXblPipeline(doc).mbm.rtuNodes;
  // The single-node KNX XBL format omits the port and uses physical Port B.
  const bus = enabled.length === 1 ? "B" as const : input.locator.nodeIndex === 0 ? "A" as const : "B" as const;
  return { blob: buildCompleteBlob(generateKnxMbmXbl(xml, options), zipSync(archive)), bus };
}

export type BusObservation = ScanPoint & { quantity: number; at: string; values?: number[]; exceptionCode?: number; timeout?: boolean };
export function crc16(bytes: number[]): number { let crc = 0xffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1; } return crc; }
export class RtuScanDecoder {
  private pending?: { unit: number; function: ScanFunction; address: number; quantity: number };
  badFrames = 0;
  constructor(private readonly slave: number, private readonly bus: "A" | "B", private readonly emit: (observation: BusObservation) => void) {}
  feed(line: string, at: string) {
    if (!line.startsWith(`1MM:RTU${this.bus}`)) return;
    if (line.includes("Timeout")) { if (this.pending?.unit === this.slave) this.emit({ ...this.pending, at, timeout: true }); this.pending = undefined; return; }
    const match = /\[(Tx|Rx)\]\s+((?:[0-9a-f]{2}(?:\s+|$))+)/i.exec(line); if (!match) return;
    const bytes = match[2].trim().split(/\s+/).map((byte) => parseInt(byte, 16));
    if (bytes.length < 5 || crc16(bytes.slice(0, -2)) !== (bytes.at(-2)! | bytes.at(-1)! << 8)) { this.badFrames++; return; }
    if (match[1] === "Tx") {
      if ([5,6,15,16].includes(bytes[1]) && bytes[0] === this.slave) throw new Error("A Modbus write was observed; the read-only scan was stopped.");
      this.pending = bytes.length === 8 && bytes[1] >= 1 && bytes[1] <= 4 ? { unit: bytes[0], function: bytes[1] as ScanFunction, address: bytes[2] << 8 | bytes[3], quantity: bytes[4] << 8 | bytes[5] } : undefined; return;
    }
    const p = this.pending; if (!p || p.unit !== this.slave || bytes[0] !== p.unit || (bytes[1] & 127) !== p.function) return;
    if (bytes[1] & 128) { if (bytes.length === 5) { this.pending = undefined; this.emit({ ...p, at, exceptionCode: bytes[2] }); } return; }
    const bit = p.function <= 2; const count = bit ? Math.ceil(p.quantity / 8) : p.quantity * 2;
    if (bytes[2] !== count || bytes.length !== count + 5) { this.badFrames++; return; }
    this.pending = undefined;
    this.emit({ ...p, at, values: Array.from({ length: p.quantity }, (_, i) => bit ? bytes[3 + Math.floor(i / 8)] >>> (i % 8) & 1 : bytes[3 + i * 2] << 8 | bytes[4 + i * 2]) });
  }
}
