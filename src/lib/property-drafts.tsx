"use client";

import * as React from "react";
import { getProjectView } from "./api";
import { useCurrentProject } from "./current-project";
import { PROJECT_PATCHED_EVENT, type ProjectPatchedDetail } from "./project-events";
import {
  createPropertyDraftStore,
  scopeKey,
  type PropertyDraftStore,
  type DraftSnapshot,
} from "./property-draft-store";
import {
  fieldValue,
  propertyFields,
  type PropertyField,
  type PropertyScreen,
  type PropertyValue,
} from "./property-fields";
import type { ProjectView } from "./project-types";

interface DraftContextValue {
  store: PropertyDraftStore;
  snapshot: DraftSnapshot;
  fields: PropertyField[];
  view: ProjectView | null;
  change: (id: string, value: PropertyValue) => void;
  save: (screen: PropertyScreen) => Promise<void>;
  immediateErrors: Record<string, string>;
  immediateBusy: Record<string, boolean>;
}
const DraftContext = React.createContext<DraftContextValue | null>(null);

export function PropertyDraftProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const current = useCurrentProject();
  const [store] = React.useState(createPropertyDraftStore);
  const snapshot = React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const fields = React.useMemo(
    () => (current.view ? propertyFields(current.view) : []),
    [current.view],
  );
  const [immediateErrors, setImmediateErrors] = React.useState<
    Record<string, string>
  >({});
  const [immediateBusy, setImmediateBusy] = React.useState<
    Record<string, boolean>
  >({});
  const inFlight = React.useRef(new Set<string>());
  const restored = React.useRef(new Set<string>());

  React.useEffect(() => {
    store.hydrate(() => window.localStorage);
  }, [store]);
  React.useEffect(() => {
    if (!current.view || !snapshot.ready) return;
    store.reconcile(current.view);
    const id = current.view.meta.id;
    if (!restored.current.has(id)) {
      restored.current.add(id);
      const count = Object.keys(
        store.getSnapshot().projects[id]?.edits ?? {},
      ).length;
      if (count)
        store.toast(
          `${count} unsaved ${count === 1 ? "change" : "changes"} recovered for ${current.view.project.name}`,
        );
    }
  }, [current.view, snapshot.ready, store]);
  React.useEffect(() => {
    const onPatch = (event: Event) => {
      const { before, next, patches } = (
        event as CustomEvent<ProjectPatchedDetail>
      ).detail;
      store.afterMutation(before, next, patches);
    };
    window.addEventListener(PROJECT_PATCHED_EVENT, onPatch);
    return () => window.removeEventListener(PROJECT_PATCHED_EVENT, onPatch);
  }, [store]);
  React.useEffect(() => {
    if (!snapshot.toast) return;
    const timeout = window.setTimeout(() => store.toast(), 5000);
    return () => window.clearTimeout(timeout);
  }, [snapshot.toast, store]);
  const hasPending = Object.values(snapshot.projects).some(
    (project) => Object.keys(project.edits).length,
  );
  const saving = Object.values(snapshot.states).some((state) => state.saving);
  React.useEffect(() => {
    if (!saving && !(hasPending && snapshot.storageWarning)) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saving, hasPending, snapshot.storageWarning]);

  const change = (id: string, value: PropertyValue) => {
    const view = current.view,
      field = fields.find((candidate) => candidate.id === id);
    if (
      !view ||
      !field ||
      !snapshot.ready ||
      snapshot.states[scopeKey(view.meta.id, field.screen)]?.saving
    )
      return;
    if (!field.immediate) {
      store.stage(view, field, value);
      if (
        field.group.startsWith("dev-cc-") &&
        field.key === "model" &&
        Number(value) === 0
      ) {
        const compatibility = fields.find(
          (candidate) =>
            candidate.group === field.group &&
            candidate.key === "compatibility",
        );
        if (compatibility) store.stage(view, compatibility, 1);
      }
      return;
    }
    const key = `${view.meta.id}:${id}`;
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setImmediateBusy((previous) => ({ ...previous, [key]: true }));
    setImmediateErrors((previous) => ({ ...previous, [key]: "" }));
    void current
      .applyPatches([field.patch(fieldValue(field, value))])
      .catch((error: unknown) => {
        setImmediateErrors((previous) => ({
          ...previous,
          [key]:
            error instanceof Error
              ? error.message
              : "Could not save this property.",
        }));
      })
      .finally(() => {
        inFlight.current.delete(key);
        setImmediateBusy((previous) => ({ ...previous, [key]: false }));
      });
  };
  const save = async (screen: PropertyScreen) => {
    const view = current.view;
    if (!view) return;
    const key = scopeKey(view.meta.id, screen);
    if (
      current.mutating ||
      store.getSnapshot().states[key]?.saving ||
      !store.editsFor(view.meta.id, screen).length ||
      inFlight.current.size
    )
      return;
    store.state(view.meta.id, screen, { saving: true });
    try {
      const latest = await getProjectView(view.meta.id);
      current.acceptView?.(latest);
      const prepared = store.prepare(latest, screen);
      if (Object.keys(prepared.invalid).length) {
        store.state(view.meta.id, screen, { invalid: prepared.invalid });
        window.dispatchEvent(
          new CustomEvent("maps:reveal-property", {
            detail: prepared.edits.find((entry) => prepared.invalid[entry.id]),
          }),
        );
        return;
      }
      if (!prepared.patches.length) {
        store.state(view.meta.id, screen, {});
        store.toast("Your changes are already saved to the project");
        return;
      }
      const next = await current.applyPatches(prepared.patches);
      store.complete(view.meta.id, screen, prepared.edits, next);
    } catch (error) {
      store.state(view.meta.id, screen, {
        error: `Could not save to the project. Your edits are still here. ${error instanceof Error ? error.message : "Please retry."}`,
      });
    }
  };
  return (
    <DraftContext.Provider
      value={{
        store,
        snapshot,
        fields,
        view: current.view,
        change,
        save,
        immediateErrors,
        immediateBusy,
      }}
    >
      {children}
      {snapshot.toast && (
        <div
          role="status"
          style={{ bottom: hasPending ? 100 : 20 }}
          className="fixed left-1/2 z-50 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-4 rounded-lg border border-border bg-white px-4 py-3 text-[12.5px] text-hms-blue shadow-lg"
        >
          <span>{snapshot.toast}</span>
          <button
            type="button"
            aria-label="Dismiss notification"
            className="cursor-pointer text-fg-muted"
            onClick={() => store.toast()}
          >
            ×
          </button>
        </div>
      )}
    </DraftContext.Provider>
  );
}

export function usePropertyDrafts() {
  const context = React.useContext(DraftContext);
  if (!context) throw new Error("PropertyDraftProvider is required");
  return context;
}

export function usePropertyField(id?: string) {
  const context = usePropertyDrafts();
  const field = context.fields.find((candidate) => candidate.id === id);
  const projectId = context.view?.meta.id ?? "";
  const entry = id
    ? context.snapshot.projects[projectId]?.edits[id]
    : undefined;
  const state = field
    ? context.snapshot.states[scopeKey(projectId, field.screen)]
    : undefined;
  return {
    ...context,
    field,
    entry,
    disabled:
      !context.snapshot.ready ||
      !!state?.saving ||
      !!context.immediateBusy[`${projectId}:${id}`],
    error:
      (id && state?.invalid?.[id]) ||
      context.immediateErrors[`${projectId}:${id}`] ||
      undefined,
  };
}

/** Project drafts overlay saved values, without creating card-local copies. */
export function useDraftForm<T extends object>(group: string, baseline: T) {
  const context = usePropertyDrafts();
  const form = structuredClone(baseline);
  const fields = context.fields.filter((field) => field.group === group);
  for (const field of fields) {
    const entry =
      context.snapshot.projects[context.view?.meta.id ?? ""]?.edits[field.id];
    if (!entry || entry.conflict === "entity") continue;
    const parts = field.key.split(".");
    let target = form as Record<string, unknown>;
    for (const part of parts.slice(0, -1)) {
      if (!target[part] || typeof target[part] !== "object") break;
      target = target[part] as Record<string, unknown>;
    }
    target[parts.at(-1)!] = fieldValue(field, entry.value);
  }
  const set = (key: string, value: PropertyValue) => {
    const field = fields.find((field) => field.key === key);
    if (field) context.change(field.id, value);
  };
  const dirtyKeys = new Set(
    fields
      .filter(
        (field) =>
          context.snapshot.projects[context.view?.meta.id ?? ""]?.edits[
            field.id
          ],
      )
      .map((field) => field.key),
  );
  return { form, set, dirtyKeys };
}

export function useRevealProperty(reveal: (section: string) => void) {
  React.useEffect(() => {
    const onReveal = (event: Event) => {
      const entry = (event as CustomEvent<{ id: string; section: string }>)
        .detail;
      if (!entry) return;
      reveal(entry.section);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const input = document.getElementById(entry.id);
          input?.scrollIntoView?.({ block: "center" });
          input?.focus();
        }),
      );
    };
    window.addEventListener("maps:reveal-property", onReveal);
    return () => window.removeEventListener("maps:reveal-property", onReveal);
  }, [reveal]);
}
