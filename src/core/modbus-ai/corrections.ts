import {
  candidateSchema,
  type AIAnalysis,
  type CandidateSignal,
} from "./model";

type Correction = AIAnalysis["corrections"][number];
/** Accept aliases only when they have an unambiguous register byte order. */
export function normalizeCorrection(
  row: CandidateSignal,
  proposal: Correction,
): Correction | null {
  let value = proposal.value.trim();
  if (proposal.field === "byteOrder") {
    const aliases: Record<string, string> = {
      "big endian": "ABCD",
      "big-endian": "ABCD",
      "little endian": "DCBA",
      "little-endian": "DCBA",
    };
    value = aliases[value.toLowerCase()] ?? value.toUpperCase();
  }
  const numeric = ["address", "function", "scale", "offset"].includes(
    proposal.field,
  );
  if (numeric && (!value || !Number.isFinite(Number(value)))) return null;
  const candidate = candidateSchema.safeParse({
    ...row,
    [proposal.field]: numeric ? Number(value) : value,
  });
  return candidate.success ? { ...proposal, value } : null;
}
