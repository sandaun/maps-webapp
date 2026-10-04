/** Paid opt-in check: requires MAPS_ALLOW_PAID_AI_TEST=1; never in the test suite. */
import { strict as assert } from "node:assert";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { ModbusAIService } from "../src/server/modbus-ai/service";
import { loadDemoProject } from "../src/server/projects/service";
import { generateJSON } from "../src/server/modbus-ai/providers";
import {
  analysisSchema,
  DEFAULT_AI_SETTINGS,
} from "../src/core/modbus-ai/model";
import { DIAGNOSIS_PROMPT } from "../src/server/modbus-ai/prompt";

if (process.env.MAPS_ALLOW_PAID_AI_TEST !== "1")
  throw new Error(
    "Live AI checks are disabled. Explicitly set MAPS_ALLOW_PAID_AI_TEST=1 to permit the two paid requests.",
  );

const root = await mkdtemp(path.join(tmpdir(), "maps-live-ai-"));
process.env.MAPS_DATA_DIR = root;
await loadDemoProject();
const doc = await PDFDocument.create();
const page = doc.addPage();
const font = await doc.embedFont(StandardFonts.Helvetica);
const lines = [
  "Test Controls - TEST-01 Modbus register map",
  "All addresses are zero-based PDU offsets. Unit ID 1.",
  "Address | Function | Name | Datatype | Scale | Unit | Access | Range | Byte order",
  "100 | FC03 | G01 On/Off | uint16 | 1 | state | R/W | 0=Off,1=On | big endian",
  "104 | FC03 | G01 Setpoint | int16 | 0.1 | degrees C | R/W | 0 to 50 | big endian",
  "300 | FC04 | Active Power | float32 | 1 | kW | R | 0 to 100 | ABCD",
  "111 | FC03 | Reset error | uint16 | 1 | state | Trigger | 1=Reset | big endian",
  "Engineering value = decoded raw * scale. Only FC01-FC04 reads are allowed in validation.",
];
lines.forEach((line, index) =>
  page.drawText(line, { x: 25, y: 760 - index * 30, font, size: 9 }),
);
const pdf = new Uint8Array(await doc.save());
await writeFile(path.join(root, "validation-source.pdf"), pdf);
const service = new ModbusAIService();
const started = Date.now();
const job = await service.start(
  "demo",
  new File([pdf], "validation-source.pdf", { type: "application/pdf" }),
);
await service.settled(job.id);
console.log(
  JSON.stringify({
    phase: "PDF",
    state: job.state,
    model: job.profile.model,
    elapsedMs: Date.now() - started,
    signals: job.signals.map(
      ({ name, address, function: fn, dataType, scale, access, warnings }) => ({
        name,
        address,
        function: fn,
        dataType,
        scale,
        access,
        warnings,
      }),
    ),
    error: job.error,
  }),
);
assert.equal(job.state, "ready", job.error);
assert.equal(job.signals.find((s) => s.address === 104)?.scale, 0.1);
assert.equal(job.signals.find((s) => s.address === 300)?.dataType, "float32");
const diagnosisStarted = Date.now();
const analysis = await generateJSON({
  profile: DEFAULT_AI_SETTINGS.diagnosis,
  schema: analysisSchema,
  system: DIAGNOSIS_PROMPT,
  text: JSON.stringify({
    signals: job.signals,
    observations: [
      {
        function: 3,
        address: 104,
        quantity: 1,
        values: [230],
        at: "2026-10-03T10:00:00Z",
      },
      {
        function: 3,
        address: 104,
        quantity: 1,
        values: [250],
        at: "2026-10-03T10:00:02Z",
      },
    ],
    guidedTest: {
      before: 23,
      after: 25,
      changedAt: "2026-10-03T10:00:01Z",
      description: "User changed G01 setpoint externally",
    },
    scope: "No writes, no KNX delivery test.",
  }),
});
console.log(
  JSON.stringify({
    phase: "diagnosis",
    model: DEFAULT_AI_SETTINGS.diagnosis.model,
    elapsedMs: Date.now() - diagnosisStarted,
    ...analysis,
  }),
);
await writeFile(
  path.join(root, "verification.json"),
  JSON.stringify({ extraction: job, diagnosis: analysis }, null, 2),
);
console.log(JSON.stringify({ evidenceDirectory: root }));
