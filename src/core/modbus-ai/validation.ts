import { isScanTerminal, type ScanInput, type ScanJob } from "@/core/modbus-scan/model";
import { wordCount, type CandidateSignal, type GuidedExperiment, type ValidationResult } from "./model";

export function decodeValue(row: CandidateSignal, words: number[]): number | string {
  if (words.length !== wordCount(row)) throw new Error("Incomplete atomic value");
  if (row.function <= 2) return words[0] & 1;
  if (row.bit !== null) return words[0] >>> row.bit & 1;
  if (words.length > 1 && row.byteOrder === null) throw new Error("Byte/word order needs review");
  let ordered = [...words]; const order = row.byteOrder ?? "ABCD";
  if (order === "CDAB" || order === "DCBA") ordered = ordered.reverse();
  const bytes = new Uint8Array(ordered.flatMap((word) => order === "BADC" || order === "DCBA" ? [word & 255, word >>> 8] : [word >>> 8, word & 255]));
  const view = new DataView(bytes.buffer);
  let raw: number | bigint;
  switch (row.dataType) {
    case "float32": raw = view.getFloat32(0); break;
    case "float64": raw = view.getFloat64(0); break;
    case "int64": raw = view.getBigInt64(0); break;
    case "uint64": raw = view.getBigUint64(0); break;
    case "int32": raw = view.getInt32(0); break;
    case "uint32": raw = view.getUint32(0); break;
    case "int16": raw = view.getInt16(0); break;
    default: raw = view.getUint16(0);
  }
  if (typeof raw === "bigint") {
    if (raw > BigInt(Number.MAX_SAFE_INTEGER) || raw < BigInt(Number.MIN_SAFE_INTEGER)) {
      if ((row.scale ?? 1) !== 1 || (row.offset ?? 0) !== 0) throw new Error("64-bit value exceeds safe numeric precision for scaling");
      return raw.toString();
    }
    raw = Number(raw);
  }
  if (!Number.isFinite(raw)) throw new Error("Decoded value is NaN or infinity");
  return raw * (row.scale ?? 1) + (row.offset ?? 0);
}
export function validationTargets(rows: CandidateSignal[]): NonNullable<ScanInput["targets"]> {
  const targets = new Map<string, NonNullable<ScanInput["targets"]>[number]>();
  for (const row of rows.filter((row) => row.enabled && row.access !== "W" && row.access !== "Trigger")) {
    const quantity = wordCount(row); const key = `${row.function}:${row.address}`;
    if (row.address + quantity > 65536) throw new Error(`${row.name} extends beyond the Modbus address space`);
    if ((targets.get(key)?.quantity ?? 0) < quantity) targets.set(key, { function: row.function, address: row.address, quantity });
  }
  return [...targets.values()];
}
export function validateSignals(rows: CandidateSignal[], job: ScanJob, experiments: GuidedExperiment[], revision: number): ValidationResult[] {
  return rows.map((row) => {
    const pending = () => ({ state: "pending" as const, evidence: [] as string[] });
    const result: ValidationResult = { signalId: row.id, samples: 0, checks: { address: pending(), type: pending(), scale: pending(), meaning: pending(), access: { state: "untested", evidence: ["No Modbus writes were performed. Documented access is not verified by reads."] } }, warnings: [] };
    const observed = (job.observations ?? []).filter((obs) => obs.function === row.function && obs.address === row.address && (obs.values ? obs.quantity >= wordCount(row) : obs.quantity === wordCount(row)));
    const valid: Array<{ at: string; value: number | string }> = [];
    for (const obs of observed) {
      if (!obs.values) continue;
      const words = obs.values.slice(0, wordCount(row));
      result.samples++; result.lastRaw = words; result.lastAt = obs.at; delete result.lastValue;
      try {
        const decodedRaw = decodeValue({ ...row, scale: 1, offset: 0 }, words);
        if (row.sentinels.includes(Number(decodedRaw)) || (words.length === 1 && row.sentinels.includes(words[0]))) { result.warnings.push(`Documented sentinel at ${obs.at}; excluded from value checks.`); continue; }
        const value = decodeValue(row, words); result.lastValue = value; valid.push({ at: obs.at, value });
      }
      catch (error) { result.warnings.push(error instanceof Error ? error.message : "Decoding failed"); }
    }
    if (result.samples) result.checks.address = { state: "supported", evidence: [`${result.samples} successful FC0${row.function} responses at PDU ${row.address}, quantity ${wordCount(row)}.`] };
    else if (observed.some((obs) => obs.exceptionCode !== undefined)) result.checks.address = { state: "contradicted", evidence: [...new Set(observed.flatMap((obs) => obs.exceptionCode === undefined ? [] : [`Exception ${obs.exceptionCode} at ${obs.at}`]))] };
    else if (observed.some((obs) => obs.timeout)) result.checks.address.evidence.push("No reply. A timeout does not distinguish wiring, slave, settings or address errors.");
    if (valid.length) {
      if (row.scale === null) result.warnings.push("Scale is undocumented. Displayed values use a candidate identity scale; review before interpreting engineering units.");
      const outOfRange = valid.filter(({ value }) => typeof value === "number" && ((row.min !== null && value < row.min) || (row.max !== null && value > row.max) || (row.enumValues.length > 0 && !row.enumValues.includes(value))));
      result.checks.type = { state: outOfRange.length ? "contradicted" : "supported", evidence: [outOfRange.length ? `${outOfRange.length} decoded samples fall outside documented constraints.` : "The proposed encoding decodes the observed payloads. Other encodings may also fit; this does not prove signedness or meaning."] };
      if (valid.every(({ value }) => value === 0)) result.warnings.push("All decoded samples are zero; evidence for type, scale and meaning is weak.");
    }
    for (const experiment of experiments.filter((e) => e.signalId === row.id && e.scanId === job.id && e.revision === revision)) {
      const before = valid.filter((sample) => sample.at < experiment.at).at(-1);
      // Allow for polling/physical propagation after the recorded user change.
      // A later experiment bounds this window; never correlate arbitrary history.
      const nextChange = experiments.filter((e) => e.signalId === row.id && e.scanId === job.id && e.revision === revision && e.at > experiment.at).sort((a, b) => a.at.localeCompare(b.at))[0]?.at;
      const afterSamples = valid.filter((sample) => sample.at >= experiment.at && Date.parse(sample.at) <= Date.parse(experiment.at) + 30000 && (!nextChange || sample.at < nextChange));
      const after = afterSamples.find((sample) => typeof sample.value === "number" && Math.abs(sample.value - experiment.after) <= experiment.tolerance) ?? afterSamples.at(-1);
      if (!before || !after || typeof before.value !== "number" || typeof after.value !== "number") { result.warnings.push("Guided test needs decoded samples both before and after the recorded change."); continue; }
      const matches = Math.abs(before.value - experiment.before) <= experiment.tolerance && Math.abs(after.value - experiment.after) <= experiment.tolerance && experiment.before !== experiment.after;
      const evidence = [`User test: ${experiment.description}. Expected ${experiment.before} → ${experiment.after}; observed ${before.value} (${before.at}) → ${after.value} (${after.at}).`];
      if (!matches && !isScanTerminal(job.state) && Date.parse(after.at) < Date.parse(experiment.at) + 30000) { result.warnings.push("Waiting for the guided change to propagate within the 30-second comparison window."); continue; }
      const state = matches && result.checks.scale.state !== "contradicted" ? "supported" : "contradicted";
      result.checks.scale = { state, evidence: [...result.checks.scale.evidence, ...evidence] };
      result.checks.meaning = { state, evidence: [...new Set([...result.checks.meaning.evidence, ...evidence, "Guided changes support this association only for their observed conditions; unrelated correlated values are still possible."])] };
    }
    result.warnings = [...new Set(result.warnings)].slice(0, 20);
    return result;
  });
}
