import {
  buildPropertyPatches,
  fieldValue,
  propertyFields,
  validateField,
  type PropertyField,
  type PropertyScreen,
  type PropertyValue,
} from "./property-fields";
import type { FamilyId, ProjectPatchInput, ProjectView } from "./project-types";

export const DRAFT_STORAGE_PREFIX = "maps.propertyDrafts.v1:";
export interface PropertyEdit {
  id: string;
  group: string;
  screen: PropertyScreen;
  section: string;
  label: string;
  base: PropertyValue;
  value: PropertyValue;
  changedAt: string;
  /**
   * "value": the saved value changed under the edit (the user may keep it).
   * "entity": the positional entity may have been replaced; only discard is safe.
   */
  conflict?: "value" | "entity";
}
interface ProjectDraft {
  version: 1;
  projectId: string;
  family: FamilyId;
  /**
   * Project revision the positional edits were last verified against.
   * Absent on drafts saved before revisions existed (never verified).
   */
  revision?: number;
  edits: Record<string, PropertyEdit>;
}
export interface SaveState {
  saving?: boolean;
  error?: string;
  invalid?: Record<string, string>;
}
export interface DraftSnapshot {
  projects: Record<string, ProjectDraft>;
  states: Record<string, SaveState>;
  ready: boolean;
  /** Some pending drafts have no local recovery copy (storage closed or writes failing). */
  storageWarning?: string;
  /** Some drafts from an earlier session could not be read (and were ignored). */
  recoveryWarning?: string;
  toast?: string;
}
export const scopeKey = (projectId: string, screen: PropertyScreen) =>
  `${projectId}:${screen}`;
const isScalar = (v: unknown): v is PropertyValue =>
  typeof v === "string" ||
  typeof v === "boolean" ||
  (typeof v === "number" && Number.isFinite(v));

function decode(raw: string): ProjectDraft {
  const data = JSON.parse(raw) as ProjectDraft;
  if (
    data.version !== 1 ||
    typeof data.projectId !== "string" ||
    !["knx-mbm", "me-mbs"].includes(data.family) ||
    !data.edits ||
    typeof data.edits !== "object" ||
    (data.revision !== undefined && !Number.isInteger(data.revision))
  )
    throw new Error("Invalid recovery data");
  for (const [id, entry] of Object.entries(data.edits)) {
    if (
      !entry ||
      entry.id !== id ||
      !isScalar(entry.base) ||
      !isScalar(entry.value) ||
      typeof entry.group !== "string" ||
      typeof entry.label !== "string" ||
      typeof entry.section !== "string" ||
      typeof entry.changedAt !== "string" ||
      !["configuration", "devices"].includes(entry.screen) ||
      (entry.conflict !== undefined && !["value", "entity"].includes(entry.conflict))
    )
      throw new Error("Invalid recovery field");
    // Drafts from before revisions carried a node `anchor`; it is no longer used.
    delete (entry as { anchor?: unknown }).anchor;
  }
  return data;
}

/** Independent of React and mounted cards; all persisted data is serializable. */
export function createPropertyDraftStore() {
  let snapshot: DraftSnapshot = { projects: {}, states: {}, ready: false };
  const listeners = new Set<() => void>();
  let storage: Storage | undefined;
  /** Storage could not be opened: no draft can have a recovery copy. */
  let storageUnavailable = false;
  /** Projects whose current drafts are not (or not correctly) stored locally. */
  const uncopied = new Set<string>();
  const emit = (patch: Partial<DraftSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  };
  function syncStorageWarning() {
    const storageWarning =
      storageUnavailable || uncopied.size
        ? "Recovery copy unavailable. Keep this tab open until you save your changes."
        : undefined;
    if (storageWarning !== snapshot.storageWarning) emit({ storageWarning });
  }
  function writeCopy(project: ProjectDraft) {
    if (!storage) return;
    try {
      const key = DRAFT_STORAGE_PREFIX + encodeURIComponent(project.projectId);
      if (Object.keys(project.edits).length)
        storage.setItem(key, JSON.stringify(project));
      else storage.removeItem(key);
      uncopied.delete(project.projectId);
    } catch {
      uncopied.add(project.projectId);
    }
  }
  /**
   * Store this project's copy and retry the ones that failed before, so the
   * warning only clears once every pending draft really has a copy.
   */
  function persist(project: ProjectDraft) {
    writeCopy(project);
    for (const id of [...uncopied])
      if (id !== project.projectId && snapshot.projects[id])
        writeCopy(snapshot.projects[id]);
    syncStorageWarning();
  }
  function put(project: ProjectDraft) {
    emit({ projects: { ...snapshot.projects, [project.projectId]: project } });
    persist(project);
  }
  function state(projectId: string, screen: PropertyScreen, value: SaveState) {
    emit({
      states: { ...snapshot.states, [scopeKey(projectId, screen)]: value },
    });
  }
  /**
   * Re-verify every edit of a project against `view` and move the draft to its
   * revision. Positional entities keep their identity only while the project
   * stays at the verified revision (own mutations advance it in
   * `afterMutation`); any other change may have replaced a node at the same
   * position, so those edits become "entity" conflicts for good. Other fields
   * are compared value by value.
   */
  function reconcile(view: ProjectView) {
    const project = snapshot.projects[view.meta.id];
    if (!project) return;
    const fields = new Map(
      propertyFields(view).map((field) => [field.id, field]),
    );
    const identityKnown =
      project.revision !== undefined &&
      project.revision === view.meta.revision;
    const edits: Record<string, PropertyEdit> = {};
    for (const [id, entry] of Object.entries(project.edits)) {
      const field = fields.get(id);
      if (!field || field.immediate || view.family !== project.family) {
        edits[id] = { ...entry, conflict: "entity" };
      } else if (Object.is(fieldValue(field, entry.value), field.base)) {
        // Also handles a successful save whose response was lost before a reload.
        continue;
      } else if (
        entry.conflict === "entity" ||
        (field.positional && !identityKnown)
      ) {
        edits[id] = { ...entry, conflict: "entity" };
      } else {
        edits[id] = {
          ...entry,
          conflict: Object.is(entry.base, field.base) ? undefined : "value",
        };
      }
    }
    const next = { ...project, edits, revision: view.meta.revision };
    if (JSON.stringify(next) !== JSON.stringify(project)) put(next);
  }
  function editsFor(projectId: string, screen: PropertyScreen) {
    return Object.values(snapshot.projects[projectId]?.edits ?? {}).filter(
      (edit) => edit.screen === screen,
    );
  }
  function stage(
    view: ProjectView,
    field: PropertyField,
    value: PropertyValue,
  ) {
    if (
      !snapshot.ready ||
      snapshot.states[scopeKey(view.meta.id, field.screen)]?.saving
    )
      return;
    if (
      snapshot.projects[view.meta.id] &&
      snapshot.projects[view.meta.id].revision !== view.meta.revision
    )
      reconcile(view);
    const previous = snapshot.projects[view.meta.id];
    const project: ProjectDraft = previous ?? {
      version: 1,
      projectId: view.meta.id,
      family: view.family,
      revision: view.meta.revision,
      edits: {},
    };
    const edits = { ...project.edits };
    const existing = edits[field.id];
    if (Object.is(fieldValue(field, value), field.base)) delete edits[field.id];
    else
      edits[field.id] = {
        id: field.id,
        group: field.group,
        screen: field.screen,
        section: field.section,
        label: field.label,
        base: existing?.base ?? field.base,
        value,
        changedAt: new Date().toISOString(),
        conflict: existing?.conflict,
      };
    put({ ...project, edits });
    clearInvalid(view.meta.id, field.screen, field.id);
  }
  /** Editing or resolving one property only clears that property's message. */
  function clearInvalid(projectId: string, screen: PropertyScreen, id: string) {
    const current = snapshot.states[scopeKey(projectId, screen)];
    if (!current?.invalid?.[id]) return;
    const invalid = { ...current.invalid };
    delete invalid[id];
    state(projectId, screen, {
      ...current,
      invalid: Object.keys(invalid).length ? invalid : undefined,
    });
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    hydrate(getStorage: () => Storage) {
      if (snapshot.ready) return;
      const projects: Record<string, ProjectDraft> = {};
      let unreadable = false,
        unavailable = false;
      try {
        storage = getStorage();
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (!key?.startsWith(DRAFT_STORAGE_PREFIX)) continue;
          try {
            const project = decode(storage.getItem(key)!);
            if (
              key !==
              DRAFT_STORAGE_PREFIX + encodeURIComponent(project.projectId)
            )
              throw new Error("Wrong project");
            projects[project.projectId] = project;
          } catch {
            unreadable = true;
          }
        }
      } catch {
        storage = undefined;
        unavailable = true;
      }
      storageUnavailable = unavailable;
      emit({
        ready: true,
        projects,
        recoveryWarning: unreadable
          ? "Some unsaved changes from an earlier session could not be read and were ignored."
          : undefined,
      });
      syncStorageWarning();
    },
    reconcile,
    editsFor,
    stage,
    state,
    toast(message?: string) {
      emit({ toast: message });
    },
    dismissRecoveryWarning() {
      emit({ recoveryWarning: undefined });
    },
    discard(projectId: string, screen: PropertyScreen) {
      if (snapshot.states[scopeKey(projectId, screen)]?.saving) return;
      const project = snapshot.projects[projectId];
      if (!project) return;
      const count = editsFor(projectId, screen).length;
      put({
        ...project,
        edits: Object.fromEntries(
          Object.entries(project.edits).filter(
            ([, edit]) => edit.screen !== screen,
          ),
        ),
      });
      state(projectId, screen, {});
      emit({
        toast: `${count} ${count === 1 ? "change discarded — field restored" : "changes discarded — fields restored"} to the saved ${count === 1 ? "value" : "values"}`,
      });
    },
    resolve(view: ProjectView, id: string, keep: boolean) {
      const project = snapshot.projects[view.meta.id];
      const entry = project?.edits[id];
      if (
        !entry ||
        snapshot.states[scopeKey(view.meta.id, entry.screen)]?.saving
      )
        return;
      const field = propertyFields(view).find((field) => field.id === id);
      const edits = { ...project.edits };
      if (!keep) delete edits[id];
      // Keeping is only offered for value conflicts: an uncertain entity has
      // no reliable identity to keep the edit on.
      else if (field && entry.conflict === "value")
        edits[id] = { ...entry, base: field.base, conflict: undefined };
      put({ ...project, edits });
      clearInvalid(view.meta.id, entry.screen, id);
    },
    prepare(view: ProjectView, screen: PropertyScreen) {
      reconcile(view);
      const fields = propertyFields(view);
      // Catalog order follows the screens' layout, so the first invalid edit
      // is the first one the user would meet, not the first one typed.
      const order = new Map(fields.map((field, index) => [field.id, index]));
      const edits = editsFor(view.meta.id, screen).sort(
        (a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity),
      );
      const invalid: Record<string, string> = {};
      for (const entry of edits) {
        const field = fields.find((field) => field.id === entry.id);
        const message = entry.conflict
          ? "Resolve this recovered change before saving."
          : field
            ? validateField(field, entry.value)
            : "This property is no longer available.";
        if (message) invalid[entry.id] = message;
      }
      if (Object.keys(invalid).length)
        return { invalid, patches: [] as ProjectPatchInput[], edits };
      return {
        invalid,
        patches: buildPropertyPatches(
          fields,
          Object.fromEntries(edits.map((edit) => [edit.id, edit.value])),
          view,
        ),
        edits,
      };
    },
    complete(
      projectId: string,
      screen: PropertyScreen,
      submitted: PropertyEdit[],
      next: ProjectView,
    ) {
      const project = snapshot.projects[projectId];
      if (project) {
        const fields = new Map(
          propertyFields(next).map((field) => [field.id, field]),
        );
        const edits = { ...project.edits };
        for (const entry of submitted) {
          const field = fields.get(entry.id);
          if (
            field &&
            edits[entry.id]?.changedAt === entry.changedAt &&
            Object.is(fieldValue(field, entry.value), field.base)
          )
            delete edits[entry.id];
        }
        put({ ...project, edits });
      }
      reconcile(next);
      const remaining = editsFor(projectId, screen).length;
      state(
        projectId,
        screen,
        remaining
          ? {
              error:
                "Some properties were not confirmed by the project. Your edits are still here.",
            }
          : {},
      );
      const count = submitted.length - remaining;
      if (count > 0)
        emit({
          toast: `${count} ${count === 1 ? "change" : "changes"} saved to the project`,
        });
    },
    /**
     * A mutation this client confirmed: remap positional ids across known
     * removals and advance the verified revision. If the project had already
     * moved past the verified revision, that unknown change is reconciled
     * first (positional edits become uncertain).
     */
    afterMutation(
      before: ProjectView | null,
      next: ProjectView,
      patches: ProjectPatchInput[],
    ) {
      if (
        !snapshot.projects[next.meta.id] ||
        !before ||
        before.family !== next.family
      ) {
        reconcile(next);
        return;
      }
      if (snapshot.projects[next.meta.id].revision !== before.meta.revision)
        reconcile(before);
      const project = snapshot.projects[next.meta.id];
      const newFields = new Map(
        propertyFields(next).map((field) => [field.id, field]),
      );
      const edits: Record<string, PropertyEdit> = {};
      for (const entry of Object.values(project.edits)) {
        let id = entry.id;
        let removed = false;
        for (const patch of patches) {
          if (patch.type === "removeNode") {
            const match = id.match(/^(rtu|tcp)-(\d+)(-.*)$/);
            if (match && match[1] === patch.locator.kind) {
              const index = Number(match[2]);
              if (index === patch.locator.nodeIndex) removed = true;
              else if (index > patch.locator.nodeIndex)
                id = `${match[1]}-${index - 1}${match[3]}`;
            }
          } else if (patch.type === "removeDevice") {
            const match = id.match(/^(rtu|tcp)-(\d+)-device-(\d+)(-.*)$/);
            if (
              match &&
              match[1] === patch.locator.kind &&
              Number(match[2]) === patch.locator.nodeIndex
            ) {
              const index = Number(match[3]);
              if (index === patch.deviceIndex) removed = true;
              else if (index > patch.deviceIndex)
                id = `${match[1]}-${match[2]}-device-${index - 1}${match[4]}`;
            }
          } else if (
            patch.type === "updateMbsConfig" &&
            patch.patch.slaves &&
            before.family === "me-mbs"
          ) {
            const oldSlaves = before.project.mbs.slaves,
              newSlaves = patch.patch.slaves;
            const match = id.match(
              /^cfg-mbs-slaves-(\d+)-(address|description)$/,
            );
            if (match && newSlaves.length === oldSlaves.length - 1) {
              const removedIndex = oldSlaves.findIndex(
                (_, i) =>
                  JSON.stringify(oldSlaves.filter((_, j) => i !== j)) ===
                  JSON.stringify(newSlaves),
              );
              if (removedIndex >= 0) {
                const index = Number(match[1]);
                if (index === removedIndex) removed = true;
                else if (index > removedIndex)
                  id = `cfg-mbs-slaves-${index - 1}-${match[2]}`;
              }
            }
          }
        }
        if (removed) continue;
        const field = newFields.get(id);
        edits[id] = field
          ? { ...entry, id, group: field.group, section: field.section, label: field.label }
          : { ...entry, id };
      }
      put({ ...project, edits, revision: next.meta.revision });
      reconcile(next);
    },
  };
}

export type PropertyDraftStore = ReturnType<typeof createPropertyDraftStore>;
