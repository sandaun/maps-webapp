import type { ProjectPatchInput, ProjectView } from "./project-types";

/** Dispatched on `window` after every confirmed project mutation. */
export const PROJECT_PATCHED_EVENT = "maps:project-patched";
export interface ProjectPatchedDetail {
  before: ProjectView | null;
  next: ProjectView;
  patches: ProjectPatchInput[];
}
