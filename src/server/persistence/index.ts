import "server-only";
import path from "node:path";
import { LocalProjectStore } from "./local-store";
import type { ProjectFileStore, ProjectRepository } from "./types";

export interface ProjectStore extends ProjectRepository, ProjectFileStore {}

let instance: LocalProjectStore | undefined;

/**
 * Singleton store rooted at `MAPS_DATA_DIR` or `.local-data/` (gitignored).
 * Limitation: single-process, single-instance — documented for the MVP.
 */
export function getProjectStore(): LocalProjectStore {
  instance ??= new LocalProjectStore(
    process.env.MAPS_DATA_DIR ?? path.join(process.cwd(), ".local-data"),
  );
  return instance;
}

/** Test hook: drop the singleton so a fresh MAPS_DATA_DIR is picked up. */
export function resetProjectStoreForTests(): void {
  instance = undefined;
}
