import { describe, expect, it } from "vitest";
import { temperature } from "./test-fixtures";
import { decodeValue, validateSignals, validationTargets } from "./validation";
import { inferDataType, normalizeExtraction, rawRowSchema, type RawExtraction } from "./extraction";
import { scanInputSchema, scanPoints, type ScanJob } from "@/core/modbus-scan/model";


const rawRow = () => rawRowSchema.parse({ sourceAddress: "40105", normalizedAddress: null, name: "Setpoint", groupText: null, registerTypeHint: "HoldingRegister", dataText: "signed 16", sourceBit: null, descriptionText: "x10", modeText: "R/W", applicableModels: null, isReserved: false, addressBasis: "plc", dataType: "int16", byteOrder: null, scale: 0.1, offset: 0, unit: "°C", min: 0, max: 50, enumValues: [], sentinels: [], sourcePages: [1], sourceQuote: "40105 Setpoint signed 16 x10 R/W" });
describe("source and atomic Modbus interpretation", () => {
  it("keeps printed PLC addresses while explicitly converting to PDU offsets", () => {
    const raw: RawExtraction = { manufacturer: "test", model: "model", globalNotes: [], tables: [{ title: "Holding", applicableModels: null, registerTypeHint: "HoldingRegister", tableNotes: [], rows: [rawRow()] }] };
    const result = normalizeExtraction(raw, [{ page: 1, text: rawRow().sourceQuote, lines: [rawRow().sourceQuote] }]);
    expect(result.signals[0]).toMatchObject({ address: 104, sourceAddress: "40105", function: 3, scale: 0.1, reviewed: false, access: "R/W" });
    raw.tables[0].rows[0].normalizedAddress = 105;
    expect(normalizeExtraction(raw, []).signals[0].address).toBe(105);
  });
  it("does not silently resolve missing bases, access or unknown formulas", () => {
    const row = rawRow(); row.sourceAddress = "104"; row.addressBasis = "unknown"; row.modeText = null;
    const raw: RawExtraction = { manufacturer: null, model: null, globalNotes: [], tables: [{ title: null, applicableModels: null, registerTypeHint: null, tableNotes: [], rows: [row, { ...row, sourceAddress: "100*N+4" }] }] };
    const normalized = normalizeExtraction(raw, []);
    expect(normalized.signals).toHaveLength(1); expect(normalized.signals[0].access).toBe("unknown"); expect(normalized.signals[0].warnings.join(" ")).toContain("base is unknown"); expect(normalized.warnings.join(" ")).toContain("Unresolved");
  });
  it.each([['uint32', 'uint32'], ['unsigned 16', 'uint16'], ['INT32', 'int32'], ['float32 IEEE754', 'float32'], ['s64', 'int64']] as const)("recognizes documented %s", (text, expected) => expect(inferDataType(text)).toBe(expected));
  it.each([['ABCD', [0x41c8, 0]], ['BADC', [0xc841, 0]], ['CDAB', [0, 0x41c8]], ['DCBA', [0, 0xc841]]] as const)("decodes float32 with %s order", (order, words) => expect(decodeValue(temperature({ dataType: "float32", byteOrder: order, scale: 1 }), [...words])).toBe(25));
  it("refuses torn values and missing byte order; preserves 64-bit precision", () => {
    expect(() => decodeValue(temperature({ dataType: "float32" }), [0x41c8, 0])).toThrow("order");
    expect(() => decodeValue(temperature({ dataType: "float32", byteOrder: "ABCD" }), [0x41c8])).toThrow("atomic");
    expect(decodeValue(temperature({ dataType: "uint64", byteOrder: "ABCD", scale: 1 }), [65535, 65535, 65535, 65535])).toBe("18446744073709551615");
  });
  it("builds sparse targets instead of reading the gaps and excludes write-only/trigger rows", () => {
    const targets = validationTargets([temperature(), temperature({ id: "wide", address: 300, dataType: "float32", byteOrder: "CDAB" }), temperature({ id: "reset", address: 111, access: "Trigger" })]);
    expect(targets).toEqual([{ function: 3, address: 104, quantity: 1 }, { function: 3, address: 300, quantity: 2 }]);
    expect(scanPoints(scanInputSchema.parse({ projectId: "test", locator: { kind: "tcp", nodeIndex: 0 }, slave: 1, targets }))).toEqual(targets);
  });
  it("normalizes PLC ranges and keeps a printed float32 span as one value", () => {
    const make = (row: ReturnType<typeof rawRow>): RawExtraction => ({ manufacturer: null, model: null, globalNotes: [], tables: [{ title: null, applicableModels: null, registerTypeHint: null, tableNotes: [], rows: [row] }] });
    expect(normalizeExtraction(make({ ...rawRow(), sourceAddress: "40105-40106" }), []).signals.map((r) => r.address)).toEqual([104, 105]);
    expect(normalizeExtraction(make({ ...rawRow(), sourceAddress: "400105" }), []).signals[0].address).toBe(104);
    const wide = normalizeExtraction(make({ ...rawRow(), sourceAddress: "40105-40106", dataType: "float32", byteOrder: "ABCD" }), []).signals;
    expect(wide).toHaveLength(1); expect(wide[0].address).toBe(104);
  });
  it("shares an atomic wide request with a narrower interpretation at the same address", () => {
    const rows = [temperature({ scale: 1 }), temperature({ id: "wide", dataType: "uint32", byteOrder: "ABCD", scale: 1 })];
    const targets = validationTargets(rows);
    expect(targets).toEqual([{ function: 3, address: 104, quantity: 2 }]);
    expect(scanPoints(scanInputSchema.parse({ projectId: "test", locator: { kind: "tcp", nodeIndex: 0 }, slave: 1, targets }))).toEqual(targets);
    const job = { id: "wide-scan", observations: [{ function: 3, address: 104, quantity: 2, values: [1, 2], at: "2026-10-03T10:00:00.000Z" }] } as ScanJob;
    expect(validateSignals(rows, job, [], 0).map((r) => r.lastValue)).toEqual([1, 65538]);
  });
});

describe("claims, not blanket validation", () => {
  const scan = (values = [230, 250]) => ({ id: "scan-1", state: "completed", observations: values.map((value, index) => ({ function: 3, address: 104, quantity: 1, values: [value], at: `2026-10-03T10:00:0${index * 2}.000Z` })) }) as ScanJob;
  it("readability and plausible temperature do not establish meaning, scale or access", () => {
    const result = validateSignals([temperature()], scan(), [], 0)[0];
    expect(result.lastValue).toBe(25); expect(result.checks.address.state).toBe("supported"); expect(result.checks.meaning.state).toBe("pending"); expect(result.checks.scale.state).toBe("pending"); expect(result.checks.access.state).toBe("untested");
  });
  it("supports the 23→25 guided test only with before and after evidence for this revision/run", () => {
    const experiment = { id: "exp", signalId: "temperature", scanId: "scan-1", revision: 0, at: "2026-10-03T10:00:01.000Z", before: 23, after: 25, tolerance: 0.1, description: "Changed G01 setpoint externally" };
    expect(validateSignals([temperature()], scan(), [experiment], 0)[0].checks.scale.state).toBe("supported");
    expect(validateSignals([temperature({ scale: 1 })], scan(), [experiment], 0)[0].checks.scale.state).toBe("contradicted");
    expect(validateSignals([temperature()], scan(), [experiment], 1)[0].checks.scale.state).toBe("pending");
  });
  it("ignores documented sentinels and does not merge independently read words", () => {
    expect(validateSignals([temperature()], scan([65535]), [], 0)[0].lastValue).toBeUndefined();
    expect(validateSignals([temperature()], scan([230, 65535]), [], 0)[0].lastValue).toBeUndefined();
    const fragmented = scan(); fragmented.observations!.push({ function: 3, address: 105, quantity: 1, values: [0], at: "2026-10-03T10:00:03.000Z" });
    expect(validateSignals([temperature({ dataType: "float32", byteOrder: "ABCD" })], fragmented, [], 0)[0].samples).toBe(0);
  });
  it("allows polling delay but does not use a later user change as corroboration", () => {
    const experiment = { id: "exp", signalId: "temperature", scanId: "scan-1", revision: 0, at: "2026-10-03T10:00:01.000Z", before: 23, after: 25, tolerance: 0.1, description: "External change" };
    expect(validateSignals([temperature()], scan([230, 230, 250]), [experiment], 0)[0].checks.meaning.state).toBe("supported");
    const second = { ...experiment, id: "next", before: 23, after: 26, at: "2026-10-03T10:00:03.000Z" };
    const result = validateSignals([temperature()], scan([230, 230, 250]), [experiment, second], 0)[0];
    expect(result.checks.meaning.state).toBe("contradicted");
  });
  it("retains contradictory guided tests when a later experiment fits", () => {
    const first = { id: "first", signalId: "temperature", scanId: "scan-1", revision: 0, at: "2026-10-03T10:00:01.000Z", before: 23, after: 24, tolerance: 0.1, description: "First change" };
    const second = { ...first, id: "second", at: "2026-10-03T10:00:03.000Z", before: 25, after: 26, description: "Second change" };
    const result = validateSignals([temperature()], scan([230, 250, 260]), [first, second], 0)[0];
    expect(result.checks.scale.state).toBe("contradicted"); expect(result.checks.scale.evidence).toHaveLength(2);
  });
});
