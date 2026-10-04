import "server-only";
import { mkdir, open, readFile, readdir, rename } from "node:fs/promises";
import path from "node:path";
import type { ScanJob } from "@/core/modbus-scan/model";
import { scanRoot } from "./guard";

export class ScanStore {
  private queues = new Map<string, Promise<void>>();
  constructor(readonly root = scanRoot()) {}
  private file(id: string, name: string) {
    if (!/^[a-z0-9-]+$/i.test(id)) throw new Error("Invalid scan ID");
    return path.join(this.root, id, name);
  }
  async write(id: string, name: string, data: string | Uint8Array) {
    const key = `${id}/${name}`;
    const next = (this.queues.get(key) ?? Promise.resolve()).catch(() => {}).then(() => this.atomicWrite(id, name, data));
    this.queues.set(key, next); try { await next; } finally { if (this.queues.get(key) === next) this.queues.delete(key); }
  }
  private async atomicWrite(id: string, name: string, data: string | Uint8Array) {
    const target = this.file(id, name); const dir = path.dirname(target);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = target + ".tmp";
    const handle = await open(tmp, "w", 0o600);
    try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
    await rename(tmp, target);
    // Persist the directory entry as well as file contents before gateway writes.
    if (process.platform !== "win32") { const directory = await open(dir, "r"); try { await directory.sync(); } finally { await directory.close(); } }
  }
  async save(job: ScanJob) { job.updatedAt = new Date().toISOString(); await this.write(job.id, "job.json", JSON.stringify(job)); }
  async backup(id: string, bytes: Uint8Array) { await this.write(id, "backup.bin", bytes); }
  async readBackup(id: string) { return new Uint8Array(await readFile(this.file(id, "backup.bin"))); }
  async read(id: string): Promise<ScanJob> { return JSON.parse(await readFile(this.file(id, "job.json"), "utf8")); }
  async list(): Promise<ScanJob[]> {
    let entries; try { entries = await readdir(this.root, { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const result: ScanJob[] = [];
    for (const entry of entries) if (entry.isDirectory() && entry.name !== "locks") result.push(await this.read(entry.name));
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
