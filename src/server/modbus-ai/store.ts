import "server-only";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_AI_SETTINGS,
  settingsSchema,
  type AISettings,
  type ModbusAIJob,
} from "@/core/modbus-ai/model";
import { ScanStore } from "@/server/modbus-scan/store";
import {
  rawExtractionSchema,
  type RawExtraction,
} from "@/core/modbus-ai/extraction";

export class ModbusAIStore {
  async saveChunk(id: string, chunkId: string, raw: RawExtraction) {
    await this.writer.write(id, `${chunkId}.json`, JSON.stringify(raw));
  }
  async chunk(id: string, chunkId: string): Promise<RawExtraction | undefined> {
    if (!/^[a-z0-9-]+$/i.test(id) || !/^pages-\d+-\d+$/.test(chunkId))
      throw new Error("Invalid extraction checkpoint ID");
    try {
      return rawExtractionSchema.parse(
        JSON.parse(
          await readFile(path.join(this.root, id, `${chunkId}.json`), "utf8"),
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  readonly writer: ScanStore;
  constructor(
    readonly root = path.join(
      process.env.MAPS_DATA_DIR ?? path.join(process.cwd(), ".local-data"),
      "modbus-ai",
    ),
  ) {
    this.writer = new ScanStore(root);
  }
  async save(job: ModbusAIJob) {
    job.updatedAt = new Date().toISOString();
    await this.writer.write(job.id, "job.json", JSON.stringify(job));
  }
  async savePdf(id: string, pdf: Uint8Array) {
    await this.writer.write(id, "source.pdf", pdf);
  }
  async pdf(id: string) {
    if (!/^[a-z0-9-]+$/i.test(id)) throw new Error("Invalid job ID");
    return new Uint8Array(
      await readFile(path.join(this.root, id, "source.pdf")),
    );
  }
  async list(): Promise<ModbusAIJob[]> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(
      (error) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    const jobs: ModbusAIJob[] = [];
    for (const entry of entries)
      if (entry.isDirectory() && entry.name !== "settings") {
        try {
          jobs.push(
            JSON.parse(
              await readFile(
                path.join(this.root, entry.name, "job.json"),
                "utf8",
              ),
            ),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        } // PDF saved before its job journal; no operation started yet.
      }
    return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async settings(): Promise<AISettings> {
    try {
      return settingsSchema.parse(
        JSON.parse(
          await readFile(
            path.join(this.root, "settings", "profiles.json"),
            "utf8",
          ),
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return structuredClone(DEFAULT_AI_SETTINGS);
      throw error;
    }
  }
  async setSettings(settings: AISettings) {
    await this.writer.write(
      "settings",
      "profiles.json",
      JSON.stringify(settings),
    );
  }
}
