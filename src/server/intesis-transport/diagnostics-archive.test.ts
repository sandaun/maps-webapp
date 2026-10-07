// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DiagnosticsArchive, archiveDirectory, downloadDiagnosticLog, listDiagnosticArchives, readDiagnosticHistory } from "./diagnostics-archive";

const id = "12345678-1234-1234-1234-123456789abc";
let directory: string;
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), "maps-diagnostics-")); process.env.MAPS_DATA_DIR = directory; });
afterEach(async () => { delete process.env.MAPS_DATA_DIR; await rm(directory, { recursive: true, force: true }); });

describe("persistent diagnostic capture", () => {
  it("records 30,000 entries in order, rotates files, pages backwards and survives the writer", async () => {
    const archive = new DiagnosticsArchive(id, "192.0.2.1", 64 * 1024);
    for (let seq = 1; seq <= 30_000; seq++) {
      archive.append({ seq, at: "2026-10-05T10:00:00.000Z", line: `1MM:RTUB frame ${seq}` });
      if (seq % 1000 === 0) await archive.flush();
    }
    await archive.seal();
    expect(archive.info()).toMatchObject({ count: 30_000, dropped: 0 });
    expect(archive.info().error).toBeUndefined();
    expect((await readdir(archiveDirectory(id))).filter((file) => file.endsWith(".jsonl")).length).toBeGreaterThan(1);
    const recent = await readDiagnosticHistory(id);
    expect(recent.entries).toHaveLength(1000);
    expect([recent.entries[0].seq, recent.entries.at(-1)!.seq]).toEqual([29_001, 30_000]);
    const older = await readDiagnosticHistory(id, recent.entries[0].seq);
    expect([older.entries[0].seq, older.entries.at(-1)!.seq]).toEqual([28_001, 29_000]);
    expect(older.hasMore).toBe(true);
    const first = await readDiagnosticHistory(id, 501);
    expect(first.entries).toHaveLength(500);
    expect(first.hasMore).toBe(false);
    let downloaded = "";
    let chunks = 0;
    for await (const chunk of downloadDiagnosticLog(id)) { downloaded += Buffer.from(chunk).toString(); chunks++; }
    expect(chunks).toBeLessThan(100); // Exports must batch, not send one HTTP chunk per line.
    const lines = downloaded.trimEnd().split("\n").slice(2);
    expect(lines).toHaveLength(30_000);
    expect(lines[0]).toContain("#1 1MM:RTUB frame 1");
    expect(lines.at(-1)).toContain("#30000 1MM:RTUB frame 30000");
    expect((await listDiagnosticArchives())[0]).toMatchObject({ id, count: 30_000, dropped: 0 });
    expect(JSON.parse(await readFile(path.join(archiveDirectory(id), "index.json"), "utf8")).info.closedAt).toBeDefined();
  }, 15_000);

  it("reports bounded capture overflow instead of claiming a complete log", async () => {
    const archive = new DiagnosticsArchive(id, "192.0.2.1");
    const huge = "X".repeat(1024 * 1024);
    for (let seq = 1; seq <= 12; seq++) archive.append({ seq, at: "now", line: huge });
    await archive.seal();
    const info = archive.info();
    expect(info.count + info.dropped).toBe(12);
    expect(info.dropped).toBeGreaterThan(0);
    expect(info.error).toMatch(/could not keep up/);
    expect((await listDiagnosticArchives())[0].dropped).toBe(info.dropped);
  });

  it("pages across repeated small flushes and seals only once", async () => {
    const archive = new DiagnosticsArchive(id, "192.0.2.1");
    for (let seq = 1; seq <= 6000; seq++) {
      archive.append({ seq, at: "2026-10-05T10:00:00Z", line: `line ${seq}` });
      if (seq % 1000 === 0) await archive.flush();
    }
    const finishing = archive.seal();
    expect(archive.seal()).toBe(finishing);
    await finishing;
    const page = await readDiagnosticHistory(id, 2501);
    expect(page.entries.map((entry) => entry.seq)).toEqual(Array.from({ length: 1000 }, (_, i) => 1501 + i));
    expect(page.hasMore).toBe(true);
  });

  it("contains storage failures and reports the missing capture", async () => {
    await writeFile(path.join(directory, "diagnostics"), "not a directory");
    const archive = new DiagnosticsArchive(id, "192.0.2.1");
    archive.append({ seq: 1, at: "now", line: "received" });
    await expect(archive.seal()).resolves.toBeUndefined();
    expect(archive.info()).toMatchObject({ count: 0, dropped: 1, error: expect.stringContaining("Capture storage failed") });
  });

  it("rejects filesystem traversal through capture ids", () => {
    expect(() => archiveDirectory("../../outside")).toThrow(/Invalid/);
  });
});
