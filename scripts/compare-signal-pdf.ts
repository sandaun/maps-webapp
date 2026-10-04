/** Manual, bounded paid comparison; never run by the test suite. Signal is read-only. */
import { loadEnvFile } from "node:process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { strict as assert } from "node:assert";
import { signalReference } from "./signal-reference";
import { ModbusAIService } from "../src/server/modbus-ai/service";
import { ModbusAIStore } from "../src/server/modbus-ai/store";
import {
  getProjectView,
  openCompleteBlob,
} from "../src/server/projects/service";
import {
  normalizeExtraction,
  rawExtractionSchema,
} from "../src/core/modbus-ai/extraction";
import { RawModbusExtractionSchema } from "../src/core/modbus-ai/signal/schema";

if (process.env.MAPS_ALLOW_PAID_AI_TEST !== "1")
  throw new Error(
    "Set MAPS_ALLOW_PAID_AI_TEST=1 after user approval; at most two extraction calls are allowed.",
  );
loadEnvFile(".env.local");
const [pdfPath, signalRoot, backupPath] = process.argv.slice(2);
assert(
  pdfPath && signalRoot && backupPath,
  "Usage: compare-signal-pdf.ts manual.pdf signal-repo received-backup.bin",
);
const bytes = new Uint8Array(await readFile(pdfPath));
const hash = createHash("sha256").update(bytes).digest("hex");
const output = path.join(".local-data/signal-comparison", hash.slice(0, 16));
await mkdir(output, { recursive: true });
const journalPath = path.join(output, "paid-requests.json");
let priorRequests = 0;
try {
  priorRequests = JSON.parse(await readFile(journalPath, "utf8")).requests;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  try {
    priorRequests = JSON.parse(
      await readFile(path.join(output, "comparison.json"), "utf8"),
    ).paidRequests;
  } catch (previousError) {
    if ((previousError as NodeJS.ErrnoException).code !== "ENOENT")
      throw previousError;
  }
}
const store = new ModbusAIStore();
const { extraction: profile } = await store.settings();
assert.equal(
  profile.provider,
  "openai",
  "This bounded comparison currently supports OpenAI only.",
);
const projectId = "signal-compare-" + hash.slice(0, 12);
try {
  await getProjectView(projectId);
} catch {
  await openCompleteBlob(new Uint8Array(await readFile(backupPath)), {
    id: projectId,
    name: `${path.basename(pdfPath, ".pdf")} — PDF comparison`,
    source: "gateway",
  });
}
const originalFetch = globalThis.fetch;
let paidRequests = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  assert.equal(
    url.hostname,
    "api.openai.com",
    "Unexpected external request blocked.",
  );
  if (priorRequests + paidRequests >= 2)
    throw new Error("Two-request comparison budget reached; retry blocked.");
  paidRequests++;
  // Durable before sending: failed requests must not reset the budget on restart.
  await writeFile(
    journalPath,
    JSON.stringify({ requests: priorRequests + paidRequests }),
  );
  console.log(
    JSON.stringify({
      phase: "paid-request",
      number: paidRequests,
      model: profile.model,
    }),
  );
  return originalFetch(input, init);
};
const reference = signalReference(signalRoot, profile.model, profile.effort);
const file = new File([bytes], path.basename(pdfPath), {
  type: "application/pdf",
});
const baselinePath = path.join(output, "signal-raw.json");
let baseline: ReturnType<typeof RawModbusExtractionSchema.parse>;
try {
  baseline = RawModbusExtractionSchema.parse(
    JSON.parse(await readFile(baselinePath, "utf8")),
  );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  const extract = reference.load("src/lib/ai/structured-modbus/extract.ts");
  const stream = extract.streamStructuredModbusPdf as (
    file: File,
    provider: string,
    meta: { truncated?: boolean },
  ) => AsyncGenerator<string>;
  const meta = { truncated: false };
  let text = "";
  for await (const delta of stream(file, "openai", meta)) text += delta;
  await writeFile(path.join(output, "signal-response.txt"), text);
  assert(
    !meta.truncated,
    "Signal response truncated; preserved for review without an automatic retry.",
  );
  baseline = RawModbusExtractionSchema.parse(
    JSON.parse(
      text
        .replace(/^```(?:json)?\s*/, "")
        .replace(/```\s*$/, "")
        .trim(),
    ),
  );
  await writeFile(baselinePath, JSON.stringify(baseline, null, 2));
}
const signalResult = reference.expand(
  reference.normalize(baseline).signals,
).signals;
console.log(JSON.stringify({ phase: "Signal", signals: signalResult.length }));
const service = new ModbusAIService(store);
const pointer = path.join(output, "maps-job.json");
let job;
try {
  job = await service.get(JSON.parse(await readFile(pointer, "utf8")).id);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  job = await service.start(projectId, file);
  await writeFile(
    pointer,
    JSON.stringify({ id: job.id, profile, sourceHash: hash }),
  );
  await service.settled(job.id);
}
console.log(
  JSON.stringify({
    phase: "MAPS",
    state: job.state,
    signals: job.signals.length,
    id: job.id,
    error: job.error,
  }),
);
assert.equal(job.state, "ready", job.error);
const rawChunks = JSON.parse(
  await readFile(path.join(store.root, job.id, "raw-extraction.json"), "utf8"),
);
const mapsRaw = rawExtractionSchema.parse(rawChunks[0]);
const mapsThroughSignal = reference.expand(
  reference.normalize(mapsRaw).signals,
).signals;
const signalThroughMaps = normalizeExtraction(
  rawExtractionSchema.parse(baseline),
  job.pages,
).signals;
const details = {
  sourceHash: hash,
  fileName: file.name,
  signalCommit: "ad9d60c6619bfab7a9186e96938bd0b20a4403cc",
  profile,
  paidRequests: priorRequests + paidRequests,
  method:
    "Actual Signal structured streaming extractor and actual MAPS service; Signal model/effort overridden in memory, retries disabled. Signal files unchanged.",
  projectId,
  jobId: job.id,
  signal: signalResult,
  maps: job.signals,
  sameRaw: {
    mapsRawThroughSignal: mapsThroughSignal,
    signalRawThroughMaps: signalThroughMaps,
  },
};
await writeFile(
  path.join(output, "comparison.json"),
  JSON.stringify(details, null, 2),
);
console.log(
  JSON.stringify({
    output,
    projectId,
    jobId: job.id,
    counts: {
      signal: signalResult.length,
      maps: job.signals.length,
      signalRawThroughMaps: signalThroughMaps.length,
      mapsRawThroughSignal: mapsThroughSignal.length,
    },
    paidRequests,
  }),
);
