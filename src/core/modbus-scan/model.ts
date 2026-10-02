import { z } from "zod";

export const SCAN_FUNCTIONS = [1, 2, 3, 4] as const;
export type ScanFunction = typeof SCAN_FUNCTIONS[number];
export const SCAN_FUNCTION_LABELS = { 1: "Coils", 2: "Discrete inputs", 3: "Holding registers", 4: "Input registers" };
export const scanInputSchema = z.object({
  projectId: z.string().min(1),
  locator: z.object({ kind: z.enum(["rtu", "tcp"]), nodeIndex: z.number().int().min(0) }),
  slave: z.number().int().min(1).max(247),
  sessionId: z.string().optional(),
  ranges: z.array(z.object({ function: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), start: z.number().int().min(0).max(65535), end: z.number().int().min(0).max(65535) })).min(1).max(4),
  batchSize: z.number().int().min(1).max(512).default(256),
  maxPoints: z.number().int().min(1).max(4096).default(1024),
  maxDurationSeconds: z.number().int().min(30).max(1800).default(600),
});
export type ScanInput = z.infer<typeof scanInputSchema>;
export type ScanPoint = { function: ScanFunction; address: number };
export type ScanState = "preparing" | "scanning" | "restoring" | "restore-pending" | "completed" | "cancelled" | "failed";
export type ScanResult = ScanPoint & {
  status: "unconfirmed" | "readable" | "exception" | "timeout";
  samples: number; attempts: number; values: number[]; lastValue?: number; changed: boolean;
  exceptionCodes: number[]; timeouts: number; lastAt?: string;
};
export interface ScanJob {
  id: string; input: ScanInput; host: string; controlPort?: number; serial?: string; mac?: string;
  state: ScanState; createdAt: string; updatedAt: string; cancelRequested: boolean;
  needsRestore: boolean; backupHash?: string; restoredHash?: string;
  batch: number; batches: number; points: number; processed: number; results: ScanResult[];
  error?: string; recoveryError?: string; imported?: boolean;
  targetFingerprint?: string;
}
export function scanPoints(input: ScanInput): ScanPoint[] {
  const seen = new Set<string>(); const points: ScanPoint[] = [];
  for (const range of input.ranges) {
    if (range.end < range.start) throw new Error("The end address must be at least the start address.");
    if (range.end - range.start + 1 > input.maxPoints) throw new Error("Selected ranges exceed the total point limit.");
    for (let address = range.start; address <= range.end; address++) {
      const key = `${range.function}:${address}`;
      if (!seen.has(key)) { seen.add(key); points.push({ function: range.function, address }); }
    }
  }
  if (points.length > input.maxPoints) throw new Error("Selected ranges exceed the total point limit.");
  return points;
}
export function estimateScan(input: ScanInput) {
  const points = scanPoints(input).length; const batches = Math.ceil(points / input.batchSize);
  return { points, batches, minimumReads: points * 2, seconds: Math.ceil(points * 0.19 + (input.locator.kind === "rtu" ? batches * 15 + 15 : 0)) };
}
export const isScanTerminal = (state: ScanState) => state === "completed" || state === "cancelled" || state === "failed";
export const pointKey = (point: ScanPoint) => `${point.function}:${point.address}`;
export function emptyScanResult(point: ScanPoint): ScanResult { return { ...point, status: "unconfirmed", samples: 0, attempts: 0, values: [], changed: false, exceptionCodes: [], timeouts: 0 }; }
export function interpretations(row: ScanResult): string[] {
  if (row.lastValue === undefined) return [];
  if (row.function <= 2) return ["Bit (read on bus); meaning unknown"];
  const value = row.lastValue;
  const options = [`uint16 ${value}`, `int16 ${value >= 32768 ? value - 65536 : value}`];
  if (row.values.every((v) => v === 0 || v === 1)) options.push("Possible state / enum; unconfirmed");
  if (row.values.includes(65535)) options.push("Possible sentinel / bitmask; unconfirmed");
  return options;
}
export function floatInterpretations(first: number, second: number): string[] {
  const bytes = [first >>> 8, first & 255, second >>> 8, second & 255];
  return [[0,1,2,3], [2,3,0,1], [1,0,3,2], [3,2,1,0]].map((order, index) => {
    const buffer = new Uint8Array(order.map((i) => bytes[i]));
    return `${["ABCD", "CDAB", "BADC", "DCBA"][index]}: ${new DataView(buffer.buffer).getFloat32(0)}`;
  });
}
