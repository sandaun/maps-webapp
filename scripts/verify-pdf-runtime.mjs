/** Offline smoke test of PDF preprocessing through the production Next build.
 * Run after pnpm build: node scripts/verify-pdf-runtime.mjs [source.pdf]
 * Uses an isolated synthetic project and blocks every network request.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";

const require = createRequire(import.meta.url);
const isolatedData = await mkdtemp(path.join(tmpdir(), "maps-pdf-runtime-"));
const networkBlocked = "Offline verification: network blocked";
const originalFetch = globalThis.fetch;
const originalConnect = Socket.prototype.connect;
let blockedProviderRequests = 0;

process.env.MAPS_DATA_DIR = isolatedData;
process.env.OPENAI_API_KEY = "offline-verification-placeholder";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.MOONSHOT_API_KEY;
delete process.env.KIMI_API_KEY;
globalThis.fetch = async () => {
  blockedProviderRequests++;
  throw new Error(networkBlocked);
};
Socket.prototype.connect = function () {
  throw new Error(networkBlocked);
};

try {
  let bytes;
  if (process.argv[2]) {
    bytes = await readFile(process.argv[2]);
  } else {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText("104 Setpoint int16 x0.1 degrees C", {
      x: 40,
      y: 700,
      font,
      size: 12,
    });
    bytes = await pdf.save();
  }

  const demoRoute = require("../.next/server/app/api/projects/demo/route.js");
  const created = await demoRoute.routeModule.userland.POST();
  assert.equal(created.status, 201, "Synthetic project initialization failed");

  const jobsRoute = require("../.next/server/app/api/modbus-ai/jobs/route.js");
  const form = new FormData();
  form.set("projectId", "demo");
  form.set(
    "file",
    new File([bytes], "offline-check.pdf", {
      type: "application/pdf",
    }),
  );
  const response = await jobsRoute.routeModule.userland.POST(
    new Request("http://localhost/api/modbus-ai/jobs", {
      method: "POST",
      body: form,
    }),
  );
  assert.equal(response.status, 202, "PDF upload was rejected");
  const { job: started } = await response.json();
  const journal = path.join(isolatedData, "modbus-ai", started.id, "job.json");
  const deadline = Date.now() + 30_000;
  let job;
  do {
    await delay(50);
    job = JSON.parse(await readFile(journal, "utf8"));
  } while (job.state === "extracting" && Date.now() < deadline);

  assert.ok(job.pages.length > 0, `PDF preprocessing failed: ${job.error}`);
  assert.equal(job.state, "failed", "Expected the network guard to stop AI");
  assert.equal(job.error, networkBlocked);
  assert.equal(blockedProviderRequests, 1);
  console.log(
    JSON.stringify(
      {
        result: "PDF preprocessing passed in the production build",
        pages: job.pages.length,
        pagesWithText: job.pages.filter((page) => page.text.trim()).length,
        providerRequestsBlocked: blockedProviderRequests,
        networkRequestsSent: 0,
      },
      null,
      2,
    ),
  );
} finally {
  globalThis.fetch = originalFetch;
  Socket.prototype.connect = originalConnect;
  await rm(isolatedData, { recursive: true, force: true });
}
