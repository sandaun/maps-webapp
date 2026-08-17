/**
 * Persistence boundaries for the local single-user MVP. The domain and UI
 * depend on these interfaces only; the filesystem adapters live in
 * `local-store.ts`. A future cloud phase can swap the adapters without
 * touching the domain.
 */

export type ProjectSource = "gateway" | "file" | "demo";

export interface ProjectMeta {
  /** Filesystem-safe id (slug or uuid). */
  id: string;
  name: string;
  description: string;
  source: ProjectSource;
  /** Original `.ibmaps` entry name inside the ZIP, when known. */
  fileName?: string;
  updatedAt: string; // ISO
}

export interface ProjectRepository {
  list(): Promise<ProjectMeta[]>;
  get(id: string): Promise<ProjectMeta | undefined>;
  upsert(meta: ProjectMeta): Promise<void>;
  delete(id: string): Promise<void>;
}

/**
 * Binary/XML payloads stay on the filesystem — never in React state and
 * never shipped to the browser.
 */
export interface ProjectFileStore {
  writeXml(projectId: string, xml: string): Promise<void>;
  readXml(projectId: string): Promise<string>;
  /** Original "complete" blob as received from the gateway, when available. */
  writeCompleteBlob(projectId: string, data: Uint8Array): Promise<void>;
  readCompleteBlob(projectId: string): Promise<Uint8Array>;
  hasCompleteBlob(projectId: string): Promise<boolean>;
  deleteProject(projectId: string): Promise<void>;
}
