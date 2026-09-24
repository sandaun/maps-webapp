import type { ProjectPatchInput, ProjectView } from "./project-types";

/** Dispatched on `window` after every confirmed project mutation. */
export const PROJECT_PATCHED_EVENT = "maps:project-patched";
export interface ProjectPatchedDetail {
  before: ProjectView | null;
  next: ProjectView;
  patches: ProjectPatchInput[];
}

/**
 * Dispatched on `window` when the client adopts a view that did not come from
 * one of its own mutations: another project was selected, or the project was
 * changed elsewhere (a newer revision was loaded, or a patch hit a revision
 * conflict). Anything keyed by the previous state, such as the signal IDs of
 * an undo entry, is stale.
 */
export const PROJECT_REPLACED_EVENT = "maps:project-replaced";
export interface ProjectReplacedDetail {
  projectId: string | null;
  reason: "selected" | "external";
}
