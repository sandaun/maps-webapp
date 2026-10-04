// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { AIOutputTruncatedError, AIRequestTimeoutError } from "./providers";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { ModbusAIService } from "./service";
import { ModbusAIStore } from "./store";
import { rawRowSchema, type RawExtraction } from "@/core/modbus-ai/extraction";
import {
  getProjectView,
  loadDemoProject,
  addDocumentSignals,
} from "@/server/projects/service";
import { resetProjectStoreForTests } from "@/server/persistence";
import { temperature } from "@/core/modbus-ai/test-fixtures";
import {
  ModbusScanService,
  nodeFingerprint,
} from "@/server/modbus-scan/service";
import { scanInputSchema, type ScanJob } from "@/core/modbus-scan/model";
import { createServer } from "node:net";
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "maps-ai-"));
  vi.stubEnv("MAPS_DATA_DIR", dir);
  vi.stubEnv("OPENAI_API_KEY", "unit-test-placeholder");
  resetProjectStoreForTests();
  await loadDemoProject();
});
afterEach(async () => {
  resetProjectStoreForTests();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
async function pdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage().drawText("104 G01 Setpoint int16 x10 R/W", {
    x: 40,
    y: 700,
    font,
    size: 12,
  });
  return new File([new Uint8Array(await doc.save())], "map.pdf", {
    type: "application/pdf",
  });
}
const raw: RawExtraction = {
  manufacturer: "test",
  model: "model",
  globalNotes: [],
  tables: [
    {
      title: "Holding registers",
      applicableModels: null,
      registerTypeHint: "HoldingRegister",
      tableNotes: [],
      rows: [
        rawRowSchema.parse({
          sourceAddress: "104",
          normalizedAddress: null,
          name: "G01 Setpoint",
          groupText: null,
          registerTypeHint: "HoldingRegister",
          dataText: "int16 x10",
          sourceBit: null,
          descriptionText: "Temperature x10",
          modeText: "R/W",
          applicableModels: null,
          isReserved: false,
          addressBasis: "zero",
          dataType: "int16",
          byteOrder: null,
          scale: 0.1,
          offset: 0,
          unit: "°C",
          min: 0,
          max: 50,
          enumValues: [],
          sentinels: [],
          sourcePages: [1],
          sourceQuote: "104 G01 Setpoint int16 x10 R/W",
        }),
      ],
    },
  ],
};
async function manualPdf(count: number) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let page = 1; page <= count; page++)
    doc.addPage().drawText(`Page ${page} holding registers`, {
      x: 40,
      y: 700,
      font,
      size: 12,
    });
  return new File([new Uint8Array(await doc.save())], "dense-manual.pdf", {
    type: "application/pdf",
  });
}
function rawOnPage(page: number): RawExtraction {
  const result = structuredClone(raw);
  result.tables[0].rows[0].sourcePages = [page];
  result.tables[0].rows[0].sourceAddress = String(104 + page);
  result.tables[0].rows[0].name = `Temperature ${page}`;
  return result;
}

it("subdivides a timed-out group only on explicit resume", async () => {
  const generate = vi
    .fn()
    .mockRejectedValueOnce(new AIRequestTimeoutError())
    .mockResolvedValueOnce(rawOnPage(1))
    .mockResolvedValueOnce(rawOnPage(2));
  const service = new ModbusAIService(new ModbusAIStore(), undefined, generate);
  const job = await service.start("demo", await manualPdf(2));
  await service.settled(job.id);
  expect(job.extractionFailure?.kind).toBe("timeout");
  expect(generate).toHaveBeenCalledTimes(1);
  await service.resume(job.id, 0);
  await service.settled(job.id);
  expect(job.state).toBe("ready");
  expect(job.extractionChunks!.map((chunk) => chunk.state)).toEqual([
    "split",
    "complete",
    "complete",
  ]);
  expect(job.signals.map((row) => row.sourcePages)).toEqual([[1], [2]]);
});

it("allows one manual retry for a single-page timeout and then requires a changed profile", async () => {
  const generate = vi
    .fn()
    .mockRejectedValueOnce(new AIRequestTimeoutError())
    .mockRejectedValueOnce(new AIRequestTimeoutError())
    .mockResolvedValueOnce(raw);
  const service = new ModbusAIService(new ModbusAIStore(), undefined, generate);
  const job = await service.start("demo", await pdf());
  await service.settled(job.id);
  await service.resume(job.id, 0);
  await service.settled(job.id);
  await expect(service.resume(job.id, 0)).rejects.toThrow(
    "cannot be retried unchanged",
  );
  expect(generate).toHaveBeenCalledTimes(2);
  const { settings } = await service.settings();
  settings.extraction.model = "gpt-6-astra";
  await service.setSettings(settings);
  await service.resume(job.id, 0, true);
  await service.settled(job.id);
  expect(job.state).toBe("ready");
  expect(job.profile.model).toBe("gpt-6-astra");
});

it("blocks an unchanged truncated single page across restarts, but permits an explicitly changed profile", async () => {
  const generate = vi.fn().mockRejectedValueOnce(new AIOutputTruncatedError());
  const service = new ModbusAIService(new ModbusAIStore(), undefined, generate);
  const job = await service.start("demo", await pdf());
  await service.settled(job.id);
  const restartedGenerate = vi.fn().mockResolvedValue(raw);
  const restarted = new ModbusAIService(
    service.store,
    undefined,
    restartedGenerate,
  );
  const { settings } = await restarted.settings();
  settings.extraction.model = "gpt-6-astra";
  await restarted.setSettings(settings);
  await expect(restarted.resume(job.id, 0)).rejects.toThrow(
    "cannot be retried unchanged",
  );
  expect(restartedGenerate).not.toHaveBeenCalled();
  await restarted.resume(job.id, 0, true);
  await restarted.settled(job.id);
  expect((await restarted.get(job.id)).state).toBe("ready");
  expect(restartedGenerate.mock.calls[0][0].profile.model).toBe("gpt-6-astra");
});

it("keeps completed groups when explicitly resuming with current Settings", async () => {
  const generate = vi
    .fn()
    .mockResolvedValueOnce(rawOnPage(1))
    .mockRejectedValueOnce(new Error("Provider unavailable"))
    .mockResolvedValueOnce(rawOnPage(16));
  const service = new ModbusAIService(new ModbusAIStore(), undefined, generate);
  const job = await service.start("demo", await manualPdf(16));
  await service.settled(job.id);
  const original = structuredClone(job.profile);
  const { settings } = await service.settings();
  settings.extraction.model = "gpt-6-astra";
  await service.setSettings(settings);
  await service.resume(job.id, 0, true);
  await service.settled(job.id);
  expect(generate).toHaveBeenCalledTimes(3);
  expect(job.extractionChunks![0].profile).toEqual(original);
  expect(job.extractionChunks![1].profile?.model).toBe("gpt-6-astra");
  expect(generate.mock.calls[2][0].text).toContain(
    "Original document pages 16.",
  );
});

it.each([1, 2])(
  "handles a %i-page group exceeding 4096 streaming rows without repeating it unchanged",
  async (count) => {
    const generate = vi
      .fn()
      .mockImplementationOnce(async (input) => {
        await input.onTextDelta(
          '{"tables":[{"rows":[' +
            Array.from({ length: 4097 }, (_, index) =>
              JSON.stringify({
                ...raw.tables[0].rows[0],
                name: `Temperature ${index}`,
                sourceAddress: String(index),
              }),
            ).join(",") +
            "]}]}",
        );
        return raw;
      })
      .mockResolvedValueOnce(rawOnPage(1))
      .mockResolvedValueOnce(rawOnPage(2));
    const service = new ModbusAIService(
      new ModbusAIStore(),
      undefined,
      generate,
    );
    const job = await service.start("demo", await manualPdf(count));
    await service.settled(job.id);
    expect(job.extractionFailure?.kind).toBe("row-limit");
    if (count === 1) {
      await expect(service.resume(job.id, 0)).rejects.toThrow(
        "cannot be retried unchanged",
      );
      expect(generate).toHaveBeenCalledTimes(1);
    } else {
      await service.resume(job.id, 0);
      await service.settled(job.id);
      expect(job.state).toBe("ready");
      expect(job.extractionChunks![0].state).toBe("split");
      expect(generate).toHaveBeenCalledTimes(3);
    }
  },
);

it("resumes after a provider failure and restart without repeating successful paid groups", async () => {
  const generate = vi
    .fn()
    .mockResolvedValueOnce(rawOnPage(1))
    .mockRejectedValueOnce(new Error("Provider unavailable"));
  const service = new ModbusAIService(new ModbusAIStore(), undefined, generate);
  const job = await service.start("demo", await manualPdf(16));
  await service.settled(job.id);
  expect(job.state).toBe("failed");
  expect(job.extractionChunks![0].state).toBe("complete");
  expect(job.signals).toEqual([]);
  await expect(service.assertImport(job.id, 0, ["signal-1"])).rejects.toThrow(
    "finish",
  );
  const resumedGenerate = vi.fn().mockResolvedValue(rawOnPage(16));
  const restarted = new ModbusAIService(
    service.store,
    undefined,
    resumedGenerate,
  );
  await restarted.resume(job.id, 0);
  await restarted.settled(job.id);
  const ready = await restarted.get(job.id);
  expect(ready.state).toBe("ready");
  expect(ready.signals.map((row) => row.address)).toEqual([105, 120]);
  expect(resumedGenerate).toHaveBeenCalledTimes(1);
  expect(resumedGenerate.mock.calls[0][0].text).toContain(
    "Original document pages 16.",
  );
});

it("subdivides confirmed truncation and merges only complete groups in original page order", async () => {
  const generate = vi
    .fn()
    .mockRejectedValueOnce(new AIOutputTruncatedError())
    .mockResolvedValueOnce(rawOnPage(1))
    .mockResolvedValueOnce(rawOnPage(2));
  const service = new ModbusAIService(new ModbusAIStore(), undefined, generate);
  const job = await service.start("demo", await manualPdf(2));
  await service.settled(job.id);
  expect(job.state).toBe("ready");
  expect(job.extractionChunks!.map((chunk) => chunk.state)).toEqual([
    "split",
    "complete",
    "complete",
  ]);
  expect(job.signals.map((row) => row.sourcePages)).toEqual([[1], [2]]);
  expect(generate).toHaveBeenCalledTimes(3);
});

it("recovers the checkpoint-before-journal crash window without another provider request", async () => {
  const generate = vi.fn().mockRejectedValue(new Error("Interrupted"));
  const service = new ModbusAIService(new ModbusAIStore(), undefined, generate);
  const job = await service.start("demo", await pdf());
  await service.settled(job.id);
  await service.store.saveChunk(job.id, "pages-1-1", raw);
  job.state = "extracting";
  job.extractionChunks![0].state = "running";
  await service.store.save(job);
  const resumedGenerate = vi.fn();
  const restarted = new ModbusAIService(
    service.store,
    undefined,
    resumedGenerate,
  );
  const failed = await restarted.get(job.id);
  expect(failed.state).toBe("failed");
  await restarted.resume(job.id, 0);
  await restarted.settled(job.id);
  expect((await restarted.get(job.id)).state).toBe("ready");
  expect(resumedGenerate).not.toHaveBeenCalled();
});

it("preserves complete streaming rows after single-page truncation without accepting an incomplete map", async () => {
  const generate = vi.fn().mockImplementation(async (input) => {
    await input.onTextDelta(
      '{"tables":[{"rows":[' + JSON.stringify(raw.tables[0].rows[0]),
    );
    throw new AIOutputTruncatedError();
  });
  const service = new ModbusAIService(new ModbusAIStore(), undefined, generate);
  const job = await service.start("demo", await pdf());
  await service.settled(job.id);
  expect(job.state).toBe("failed");
  expect(job.signals).toEqual([]);
  expect(job.extractionPreview!.count).toBe(1);
  const saved = JSON.parse(
    await readFile(
      path.join(service.store.root, job.id, "stream-pages-1-1-attempt-1.json"),
      "utf8",
    ),
  );
  expect(saved.provisional).toBe(true);
  expect(saved.rows).toHaveLength(1);
  expect(generate).toHaveBeenCalledTimes(1);
});

it("permits reviewed PDF import without equipment and reports that live validation is absent", async () => {
  const scans = {
    get: vi.fn(),
    start: vi.fn(),
  } as unknown as ModbusScanService;
  const service = new ModbusAIService(
    new ModbusAIStore(),
    scans,
    vi.fn().mockResolvedValue(raw),
  );
  const job = await service.start("demo", await pdf());
  await service.settled(job.id);
  await service.update(job.id, 0, [temperature()]);
  expect((await service.report(job.id)).liveStatus).toBe("not-validated-live");
  expect(
    (await service.assertImport(job.id, 1, ["temperature"])).rows,
  ).toHaveLength(1);
  expect(scans.start).not.toHaveBeenCalled();
});

it("extracts actual PDF page evidence, persists the candidate and rejects stale edits", async () => {
  const generate = vi.fn().mockResolvedValue(raw);
  const service = new ModbusAIService(new ModbusAIStore(), undefined, generate);
  const job = await service.start("demo", await pdf());
  await service.settled(job.id);
  expect(job.state).toBe("ready");
  expect(job.pages[0].text).toContain("104 G01 Setpoint");
  expect(job.signals[0]).toMatchObject({
    address: 104,
    scale: 0.1,
    reviewed: false,
  });
  expect(generate.mock.calls[0][0].pdf).toBeInstanceOf(Uint8Array);
  expect((await service.store.list())[0].sourceHash).toMatch(/^[a-f0-9]{64}$/);
  await service.update(job.id, 0, [temperature()]);
  await expect(service.update(job.id, 0, [temperature()])).rejects.toThrow(
    "changed",
  );
  expect((await new ModbusAIService(service.store).get(job.id)).revision).toBe(
    1,
  );
});
it("does not expose invalid or truncated extraction as a ready map", async () => {
  const service = new ModbusAIService(
    new ModbusAIStore(),
    undefined,
    vi.fn().mockRejectedValue(new Error("Provider unavailable")),
  );
  const job = await service.start("demo", await pdf());
  await service.settled(job.id);
  expect(job.state).toBe("failed");
  expect(job.signals).toEqual([]);
  expect(job.error).toContain("Provider unavailable");
});
it("imports reviewed document signals under project revision and preserves read-only access", async () => {
  const view = await getProjectView("demo");
  const input = scanInputSchema.parse({
    projectId: "demo",
    locator: { kind: "rtu", nodeIndex: 0 },
    slave: 1,
  });
  const next = await addDocumentSignals(
    "demo",
    [temperature()],
    { ...input.locator, slave: 1, name: "existing", manufacturer: "" },
    view.meta.revision!,
    nodeFingerprint(view, input),
  );
  if (next.family !== "knx-mbm") throw new Error("wrong family");
  expect(next.project.signals.at(-1)!.modbus.writeFunc).toBe(-1);
  expect(next.project.signals.at(-1)!.description).toBe("G01 Setpoint");
  await expect(
    addDocumentSignals(
      "demo",
      [temperature({ address: 106 })],
      { ...input.locator, slave: 1, name: "existing", manufacturer: "" },
      view.meta.revision!,
      nodeFingerprint(view, input),
    ),
  ).rejects.toThrow("changed");
});
it("reserves one paid operation before another concurrent analysis or map edit can begin", async () => {
  let resolve!: (value: unknown) => void;
  const generate = vi
    .fn()
    .mockResolvedValueOnce(raw)
    .mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
  const service = new ModbusAIService(new ModbusAIStore(), undefined, generate);
  const job = await service.start("demo", await pdf());
  await service.settled(job.id);
  await service.analyze(job.id, 0, "review");
  await expect(service.analyze(job.id, 0, "review")).rejects.toThrow(
    "in progress",
  );
  await expect(service.update(job.id, 0, [temperature()])).rejects.toThrow(
    "finish",
  );
  expect(generate).toHaveBeenCalledTimes(2);
  resolve({
    summary: "Review",
    findings: [],
    corrections: [
      {
        signalId: job.signals[0].id,
        field: "byteOrder",
        value: "big endian",
        reason: "Source uses network order",
      },
    ],
  });
  await service.settled(job.id);
  expect(job.analyses[0].corrections[0].value).toBe("ABCD");
  await service.applyCorrection(job.id, 0, job.analyses[0].id, 0);
  expect(job.revision).toBe(1);
  expect(job.signals[0].reviewed).toBe(false);
});
it("persists the automatic analysis limit across failed requests and server restart", async () => {
  const scan = {
    id: "capture",
    state: "scanning",
    observations: [],
  } as unknown as ScanJob;
  const scans = {
    get: vi.fn().mockResolvedValue(scan),
  } as unknown as ModbusScanService;
  const generate = vi
    .fn()
    .mockResolvedValueOnce(raw)
    .mockRejectedValue(new Error("Provider unavailable"));
  const service = new ModbusAIService(new ModbusAIStore(), scans, generate);
  const job = await service.start("demo", await pdf());
  await service.settled(job.id);
  job.runs.push({
    scanId: "capture",
    revision: 0,
    signalIds: job.signals.map((r) => r.id),
    startedAt: new Date().toISOString(),
    fingerprint: "target",
  });
  for (let i = 0; i < 3; i++) {
    await service.analyze(job.id, 0, "diagnosis", true);
    await service.settled(job.id);
  }
  const restarted = new ModbusAIService(service.store, scans, generate);
  await expect(restarted.analyze(job.id, 0, "diagnosis", true)).rejects.toThrow(
    "limited to 3",
  );
  expect(generate).toHaveBeenCalledTimes(4);
});
it("validates a PDF candidate against a real local TCP socket without calling any AI provider", async () => {
  let temperatures = 0;
  const server = createServer((socket) =>
    socket.on("data", (request) => {
      const fn = request[7];
      const address = request.readUInt16BE(8);
      const quantity = request.readUInt16BE(10);
      expect(request[6]).toBe(1);
      expect([3, 4]).toContain(fn);
      const values =
        address === 104 ? [++temperatures === 1 ? 230 : 250] : [0x41c8, 0];
      expect(quantity).toBe(values.length);
      const bytes = Buffer.alloc(9 + values.length * 2);
      request.copy(bytes, 0, 0, 7);
      bytes.writeUInt16BE(3 + values.length * 2, 4);
      bytes[7] = fn;
      bytes[8] = values.length * 2;
      values.forEach((v, i) => bytes.writeUInt16BE(v, 9 + i * 2));
      setTimeout(
        () => socket.write(bytes),
        address === 104 && temperatures === 2 ? 20 : 0,
      );
    }),
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const view = await getProjectView("demo");
    if (view.family !== "knx-mbm") throw new Error("Wrong family");
    view.project.mbm.tcpNodes.push({
      nodeIndex: 0,
      description: "Local validation simulator",
      ip: "127.0.0.1",
      port: (server.address() as { port: number }).port,
      rxTimeout: 1000,
      connTimeout: 1000,
      retryTimeout: 1000,
      timeInterFrame: 0,
      timeInterFrameSlaveChange: 100,
      devices: view.project.mbm.rtuNodes[0].devices,
    });
    const scans = new ModbusScanService(undefined, undefined, async () => view);
    const generate = vi.fn().mockResolvedValue(raw);
    const service = new ModbusAIService(
      new ModbusAIStore(),
      scans,
      generate,
      async () => view,
    );
    const job = await service.start("demo", await pdf());
    await service.settled(job.id);
    await service.update(job.id, 0, [
      temperature(),
      temperature({
        id: "power",
        name: "Power",
        function: 4,
        address: 300,
        dataType: "float32",
        byteOrder: "ABCD",
        scale: 1,
      }),
    ]);
    const { scan } = await service.startValidation(
      job.id,
      1,
      scanInputSchema.parse({
        projectId: "demo",
        locator: { kind: "tcp", nodeIndex: 0 },
        slave: 1,
        ranges: [],
      }),
    );
    await scans.settled(scan.id);
    expect(scan.state).toBe("completed");
    expect(scan.observations).toHaveLength(4);
    const at = new Date(Date.parse(scan.observations![0].at) + 1).toISOString();
    await service.addExperiment(job.id, 1, {
      signalId: "temperature",
      before: 23,
      after: 25,
      description: "Changed simulator setpoint",
      at,
    });
    const report = await service.report(job.id);
    expect(report.validation[0].checks.meaning.state).toBe("supported");
    expect(report.validation[0].checks.access.state).toBe("untested");
    expect(report.validation[1].lastValue).toBe(25);
    const reopened = await new ModbusAIService(service.store, scans).report(
      job.id,
    );
    expect(reopened.validation[0].lastRaw).toEqual([250]);
    expect(generate).toHaveBeenCalledTimes(1);
    const other = scanInputSchema.parse({ ...scan.input, slave: 2 });
    await expect(service.verifyTarget(job, other)).rejects.toThrow(
      "different connection or slave",
    );
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});
