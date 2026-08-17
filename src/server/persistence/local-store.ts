import "server-only";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  ProjectFileStore,
  ProjectMeta,
  ProjectRepository,
} from "./types";

/**
 * Local filesystem adapter. Data lives under `.local-data/` (gitignored),
 * one folder per project: `meta.json`, `project.ibmaps`, `complete.bin`.
 * All writes are atomic (write tmp + rename) and project ids are sanitized.
 */
export class LocalProjectStore implements ProjectRepository, ProjectFileStore {
  constructor(private readonly rootDir: string) {}

  // --- ProjectRepository ---------------------------------------------------

  async list(): Promise<ProjectMeta[]> {
    const projectsDir = path.join(this.rootDir, "projects");
    if (!existsSync(projectsDir)) return [];
    const dirs = await readdir(projectsDir, { withFileTypes: true });
    const metas: ProjectMeta[] = [];
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const meta = await this.get(dir.name).catch(() => undefined);
      if (meta) metas.push(meta);
    }
    return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<ProjectMeta | undefined> {
    const file = this.metaPath(id);
    if (!existsSync(file)) return undefined;
    return JSON.parse(await readFile(file, "utf8")) as ProjectMeta;
  }

  async upsert(meta: ProjectMeta): Promise<void> {
    await this.atomicWrite(this.metaPath(meta.id), JSON.stringify(meta, null, 2));
  }

  async delete(id: string): Promise<void> {
    await this.deleteProject(id);
  }

  // --- ProjectFileStore ----------------------------------------------------

  async writeXml(projectId: string, xml: string): Promise<void> {
    await this.atomicWrite(this.projectFile(projectId, "project.ibmaps"), xml);
  }

  async readXml(projectId: string): Promise<string> {
    return readFile(this.projectFile(projectId, "project.ibmaps"), "utf8");
  }

  async writeCompleteBlob(projectId: string, data: Uint8Array): Promise<void> {
    await this.atomicWrite(this.projectFile(projectId, "complete.bin"), Buffer.from(data));
  }

  async readCompleteBlob(projectId: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.projectFile(projectId, "complete.bin")));
  }

  async hasCompleteBlob(projectId: string): Promise<boolean> {
    return existsSync(this.projectFile(projectId, "complete.bin"));
  }

  async deleteProject(projectId: string): Promise<void> {
    await rm(this.projectDir(projectId), { recursive: true, force: true });
  }

  // --- internals -----------------------------------------------------------

  /** Ids are reduced to a safe charset before touching the filesystem. */
  private safeId(id: string): string {
    const safe = id.toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/^\.+/, "");
    if (!safe || safe === "." || safe === "..") {
      throw new Error(`Unsafe project id: ${JSON.stringify(id)}`);
    }
    return safe;
  }

  private projectDir(id: string): string {
    return path.join(this.rootDir, "projects", this.safeId(id));
  }

  private projectFile(id: string, name: string): string {
    return path.join(this.projectDir(id), name);
  }

  private metaPath(id: string): string {
    return this.projectFile(id, "meta.json");
  }

  private async atomicWrite(file: string, content: string | Buffer): Promise<void> {
    const dir = path.dirname(file);
    await mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}-${Date.now()}`);
    await writeFile(tmp, content);
    await rename(tmp, file);
  }
}
