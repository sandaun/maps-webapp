import "server-only";
import { mkdir, open, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import type { DiagnosticArchiveInfo, DiagnosticEntry, DiagnosticHistoryPage } from "@/lib/diagnostics-history";

interface Block { file: number; offset: number; bytes: number; first: number; last: number }
interface Manifest { info: DiagnosticArchiveInfo; blocks: Block[] }
const ROTATE_BYTES = 20 * 1024 * 1024; // IntesisCommLog.ApplyRestrictions: 20 MB.
const MAX_PENDING_BYTES = 8 * 1024 * 1024;
const INDEX_BLOCK_BYTES = 256 * 1024;
const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

export const diagnosticsRoot = () => path.join(process.env.MAPS_DATA_DIR ?? path.join(process.cwd(), ".local-data"), "diagnostics");
export function archiveDirectory(id: string): string {
  if (!UUID.test(id)) throw new Error("Invalid diagnostic capture ID");
  return path.join(diagnosticsRoot(), id);
}
const partName = (file: number) => `traffic-${String(file).padStart(5, "0")}.jsonl`;

/** Append-only disk capture. Sparse byte indexes let pages read only their
 * blocks; the browser never needs the entire recording in memory. */
export class DiagnosticsArchive {
  private pending: { entry: DiagnosticEntry; text: string; bytes: number }[] = [];
  private pendingBytes = 0;
  private writing: Promise<void> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly manifest: Manifest;
  private readonly directory: string;
  private sealed = false;
  private sealing: Promise<void> | undefined;

  constructor(id: string, host: string, private readonly rotateBytes = ROTATE_BYTES) {
    this.directory = archiveDirectory(id);
    this.manifest = { info: { id, host, startedAt: new Date().toISOString(), count: 0, bytes: 0, dropped: 0 }, blocks: [] };
  }

  info(): DiagnosticArchiveInfo { return { ...this.manifest.info }; }

  append(entry: DiagnosticEntry): void {
    if (this.sealed) return;
    const text = JSON.stringify(entry) + "\n";
    const bytes = Buffer.byteLength(text);
    if (this.manifest.info.error || this.pendingBytes + bytes > MAX_PENDING_BYTES) {
      this.manifest.info.dropped++;
      this.manifest.info.error ??= "Capture storage could not keep up; some lines were not recorded.";
      return;
    }
    this.pending.push({ entry, text, bytes });
    this.pendingBytes += bytes;
    if (!this.timer) {
      this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, 200);
      this.timer.unref?.();
    }
  }

  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    if (this.writing) {
      await this.writing;
      if (this.pending.length) return this.flush();
      return;
    }
    this.writing = this.drain().catch((error: unknown) => {
      this.manifest.info.error = `Capture storage failed: ${error instanceof Error ? error.message : "unknown error"}`;
      this.manifest.info.dropped += this.pending.length;
      this.pending = [];
      this.pendingBytes = 0;
      // Preserve the failure marker if storage is still writable; never leak
      // a disk exception back into the transport pump.
      return this.checkpoint().catch(() => {});
    });
    await this.writing;
    this.writing = undefined;
  }

  seal(): Promise<void> {
    if (this.sealing) return this.sealing;
    this.sealed = true;
    this.manifest.info.closedAt = new Date().toISOString();
    this.sealing = (async () => {
      await this.flush();
      await this.checkpoint().catch(() => {});
    })();
    return this.sealing;
  }

  private async drain(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    while (this.pending.length) {
      const batch = this.pending.splice(0, 512);
      const bytes = batch.reduce((sum, item) => sum + item.bytes, 0);
      this.pendingBytes -= bytes;
      const previous = this.manifest.blocks.at(-1);
      const end = previous ? previous.offset + previous.bytes : 0;
      const file = previous ? previous.file + (end + bytes > this.rotateBytes ? 1 : 0) : 0;
      const offset = previous?.file === file ? end : 0;
      try {
        const handle = await open(path.join(this.directory, partName(file)), "a");
        try { await handle.writeFile(batch.map((item) => item.text).join("")); }
        finally { await handle.close(); }
      } catch (error) {
        this.manifest.info.dropped += batch.length;
        throw error;
      }
      // Coalesce small timer flushes so a long recording does not accumulate
      // an index record (and rewrite a growing manifest) for every few lines.
      if (previous?.file === file && previous.bytes + bytes <= INDEX_BLOCK_BYTES) {
        previous.bytes += bytes;
        previous.last = batch.at(-1)!.entry.seq;
      } else {
        this.manifest.blocks.push({ file, offset, bytes, first: batch[0].entry.seq, last: batch.at(-1)!.entry.seq });
      }
      this.manifest.info.count += batch.length;
      this.manifest.info.bytes += bytes;
      // Atomic checkpoint: a reader cannot observe offsets for unwritten data.
      await this.checkpoint();
    }
    await this.checkpoint();
  }

  private async checkpoint(): Promise<void> {
    await writeFile(path.join(this.directory, "index.json.tmp"), JSON.stringify(this.manifest));
    await rename(path.join(this.directory, "index.json.tmp"), path.join(this.directory, "index.json"));
  }
}

export async function readDiagnosticHistory(id: string, before = Number.MAX_SAFE_INTEGER, limit = 1000): Promise<DiagnosticHistoryPage> {
  const directory = archiveDirectory(id);
  const manifest: Manifest = JSON.parse(await readFile(path.join(directory, "index.json"), "utf8"));
  const entries: DiagnosticEntry[] = [];
  for (let i = manifest.blocks.length - 1; i >= 0 && entries.length < limit; i--) {
    const block = manifest.blocks[i];
    if (block.first >= before) continue;
    const handle = await open(path.join(directory, partName(block.file)), "r");
    const buffer = Buffer.alloc(block.bytes);
    try { await handle.read(buffer, 0, buffer.length, block.offset); }
    finally { await handle.close(); }
    const chunk = buffer.toString("utf8").trimEnd().split("\n")
      .map((line) => JSON.parse(line) as DiagnosticEntry).filter((entry) => entry.seq < before);
    entries.unshift(...chunk.slice(-(limit - entries.length)));
  }
  return { entries, hasMore: manifest.blocks.some((block) => block.first < (entries[0]?.seq ?? before)), archive: manifest.info };
}

/** Streaming text export, bounded to the checkpoint at download time. */
export async function* downloadDiagnosticLog(id: string): AsyncGenerator<Uint8Array> {
  const directory = archiveDirectory(id);
  const manifest: Manifest = JSON.parse(await readFile(path.join(directory, "index.json"), "utf8"));
  yield Buffer.from(`# MAPS diagnostic capture · ${manifest.info.host} · ${manifest.info.startedAt}\n# ${manifest.info.count} lines · ${manifest.info.dropped} missing${manifest.info.error ? ` · ${manifest.info.error}` : ""}\n`);
  const ends = new Map<number, number>();
  for (const block of manifest.blocks) ends.set(block.file, block.offset + block.bytes);
  let output: string[] = [];
  let outputBytes = 0;
  for (const [file, end] of ends) {
    const input = createReadStream(path.join(directory, partName(file)), { end: end - 1 });
    const lines = createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        const entry = JSON.parse(line) as DiagnosticEntry;
        const text = `${entry.at} #${entry.seq} ${entry.line}\n`;
        output.push(text);
        outputBytes += Buffer.byteLength(text);
        if (outputBytes >= 64 * 1024) {
          yield Buffer.from(output.join(""));
          output = [];
          outputBytes = 0;
        }
      }
    } finally { lines.close(); input.destroy(); }
  }
  if (output.length) yield Buffer.from(output.join(""));
}

export async function listDiagnosticArchives(): Promise<DiagnosticArchiveInfo[]> {
  const root = diagnosticsRoot();
  const folders = await readdir(root, { withFileTypes: true }).catch(() => []);
  const manifests = await Promise.all(folders.filter((folder) => folder.isDirectory() && UUID.test(folder.name)).map(async (folder) => {
    try { return (JSON.parse(await readFile(path.join(root, folder.name, "index.json"), "utf8")) as Manifest).info; }
    catch { return null; }
  }));
  return manifests.filter((info): info is DiagnosticArchiveInfo => info !== null).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
