import { z } from "zod";

export const PROVIDERS = ["openai", "anthropic", "kimi"] as const;
export type AIProvider = (typeof PROVIDERS)[number];
export const TASKS = ["extraction", "diagnosis", "review"] as const;
export const MAX_AUTOMATIC_ANALYSES = 3;
export type AITask = (typeof TASKS)[number];
export const MODELS = {
  openai: ["gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra"],
  anthropic: [
    "claude-sonnet-5-5",
    "claude-opus-5-5",
    "claude-haiku-4-5",
    "claude-fable-5-1",
  ],
  kimi: ["kimi-k2.6", "kimi-k3"],
} as const;
export const profileSchema = z.object({
  provider: z.enum(PROVIDERS),
  model: z.string().min(1).max(100),
  effort: z.enum(["none", "low", "medium", "high", "max"]).default("low"),
});
export type AIProfile = z.infer<typeof profileSchema>;
export const settingsSchema = z.object({
  extraction: profileSchema,
  diagnosis: profileSchema,
  review: profileSchema,
});
export type AISettings = z.infer<typeof settingsSchema>;
export const DEFAULT_AI_SETTINGS: AISettings = {
  extraction: { provider: "openai", model: "gpt-6.1-sol", effort: "medium" },
  diagnosis: { provider: "openai", model: "gpt-6-luna", effort: "none" },
  review: { provider: "openai", model: "gpt-6.1-sol", effort: "medium" },
};
export const DATA_TYPES = [
  "bit",
  "uint16",
  "int16",
  "uint32",
  "int32",
  "float32",
  "uint64",
  "int64",
  "float64",
] as const;
export const BYTE_ORDERS = ["ABCD", "BADC", "CDAB", "DCBA"] as const;
export const candidateSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(200),
    description: z.string().max(4000),
    function: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    address: z.number().int().min(0).max(65535),
    addressNeedsConfirmation: z.boolean().optional(),
    sourceAddress: z.string().max(200),
    addressBasis: z.enum(["zero", "one", "plc", "explicit", "unknown"]),
    dataType: z.enum(DATA_TYPES),
    byteOrder: z.enum(BYTE_ORDERS).nullable(),
    bit: z.number().int().min(0).max(15).nullable(),
    scale: z.number().finite().nullable(),
    offset: z.number().finite().nullable(),
    unit: z.string().max(80).nullable(),
    access: z.enum(["R", "W", "R/W", "Trigger", "unknown"]),
    min: z.number().finite().nullable(),
    max: z.number().finite().nullable(),
    enumValues: z.array(z.number().finite()).max(256),
    sentinels: z.array(z.number().finite()).max(32),
    sourcePages: z.array(z.number().int().positive()).max(200),
    sourceQuote: z.string().max(2000),
    applicableModels: z.array(z.string().max(128)).max(100),
    warnings: z.array(z.string().max(1000)).max(50),
    reviewed: z.boolean(),
    enabled: z.boolean(),
  })
  .superRefine((row, context) => {
    const quantity = /64/.test(row.dataType)
      ? 4
      : /32/.test(row.dataType)
        ? 2
        : 1;
    if (row.address + quantity > 65536)
      context.addIssue({
        code: "custom",
        path: ["address"],
        message: "Value extends beyond the Modbus address space.",
      });
    if (row.function <= 2 && (row.dataType !== "bit" || row.bit !== null))
      context.addIssue({
        code: "custom",
        path: ["dataType"],
        message:
          "FC01/02 values are individual bits; register bit offsets do not apply.",
      });
    if (row.function >= 3 && row.dataType === "bit" && row.bit === null)
      context.addIssue({
        code: "custom",
        path: ["bit"],
        message: "Choose a bit offset within this register.",
      });
    if (row.bit !== null && quantity > 1)
      context.addIssue({
        code: "custom",
        path: ["bit"],
        message: "Bit extraction requires a single register.",
      });
    if (row.min !== null && row.max !== null && row.min > row.max)
      context.addIssue({
        code: "custom",
        path: ["min"],
        message: "Minimum must not exceed maximum.",
      });
  });
export type CandidateSignal = z.infer<typeof candidateSchema>;
export const wordCount = (row: Pick<CandidateSignal, "dataType">) =>
  /64/.test(row.dataType) ? 4 : /32/.test(row.dataType) ? 2 : 1;
export type EvidencePage = { page: number; text: string; lines: string[] };
export type CheckState = "pending" | "supported" | "contradicted" | "untested";
export type ClaimCheck = { state: CheckState; evidence: string[] };
export type ValidationResult = {
  signalId: string;
  samples: number;
  lastRaw?: number[];
  lastValue?: string | number;
  lastAt?: string;
  checks: Record<
    "address" | "type" | "scale" | "meaning" | "access",
    ClaimCheck
  >;
  warnings: string[];
};
export const experimentSchema = z.object({
  signalId: z.string(),
  at: z.string().datetime(),
  before: z.number().finite(),
  after: z.number().finite(),
  description: z.string().min(1).max(1000),
  tolerance: z.number().min(0).max(1000).default(0.1),
});
export type GuidedExperiment = z.infer<typeof experimentSchema> & {
  id: string;
  revision: number;
  scanId: string;
};
export type AIFinding = {
  signalId: string | null;
  severity: "info" | "warning" | "error";
  claim: string;
  evidence: string[];
  confidence: "low" | "medium" | "high";
  nextCheck: string | null;
};
export const analysisSchema = z.object({
  summary: z.string().max(4000),
  findings: z
    .array(
      z.object({
        signalId: z.string().nullable(),
        severity: z.enum(["info", "warning", "error"]),
        claim: z.string().max(2000),
        evidence: z.array(z.string().max(1000)).max(20),
        confidence: z.enum(["low", "medium", "high"]),
        nextCheck: z.string().max(2000).nullable(),
      }),
    )
    .max(100),
  corrections: z
    .array(
      z.object({
        signalId: z.string(),
        field: z.enum([
          "address",
          "function",
          "dataType",
          "byteOrder",
          "scale",
          "offset",
          "unit",
          "name",
        ]),
        value: z.string(),
        reason: z.string(),
      }),
    )
    .max(100),
});
export type AIAnalysis = z.infer<typeof analysisSchema> & {
  id: string;
  task: AITask;
  profile: AIProfile;
  at: string;
  revision: number;
  scanId?: string;
  latencyMs: number;
  automatic?: boolean;
};
export type ValidationRun = {
  scanId: string;
  revision: number;
  signalIds: string[];
  startedAt: string;
  fingerprint: string;
};
export interface ExtractionChunk {
  id: string;
  startPage: number;
  endPage: number;
  state: "pending" | "running" | "complete" | "split";
  attempts: number;
  rows: number;
  profile?: AIProfile;
}

export interface ModbusAIJob {
  id: string;
  projectId: string;
  revision: number;
  state: "extracting" | "ready" | "failed";
  createdAt: string;
  updatedAt: string;
  fileName: string;
  sourceHash: string;
  manufacturer: string;
  model: string;
  profile: AIProfile;
  pages: EvidencePage[];
  signals: CandidateSignal[];
  warnings: string[];
  error?: string;
  progress: string;
  runs: ValidationRun[];
  experiments: GuidedExperiment[];
  analyses: AIAnalysis[];
  busy?: "review" | "diagnosis";
  automaticAttempts?: Record<string, number>;
  extractionChunks?: ExtractionChunk[];
  extractionFailure?: {
    kind: "timeout" | "truncated" | "row-limit";
    chunkId: string;
    profile: AIProfile;
  };
  extractionPreview?: {
    chunkId: string;
    count: number;
    rows: Array<{ name: string; sourceAddress: string; sourcePages: number[] }>;
  };
}

export function extractionResumePlan(job: ModbusAIJob, profile: AIProfile) {
  const failure = job.extractionFailure;
  const chunk = job.extractionChunks?.find(
    (part) => part.id === failure?.chunkId,
  );
  if (!failure || !chunk) return "retry";
  if (chunk.startPage < chunk.endPage) return "split";
  if (JSON.stringify(profile) !== JSON.stringify(failure.profile))
    return "retry";
  return failure.kind !== "timeout" || chunk.attempts >= 2
    ? "change-required"
    : "retry";
}
