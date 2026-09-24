"use client";

import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  ReactNode,
} from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { usePropertyField, usePropertyDrafts } from "@/lib/property-drafts";
import { useCurrentProject } from "@/lib/current-project";
import { scopeKey } from "@/lib/property-draft-store";
import type { PropertyScreen } from "@/lib/property-fields";
import { cn } from "@/lib/utils";

export function PropertyScreenBoundary({
  screen,
  children,
}: {
  screen: PropertyScreen;
  children: ReactNode;
}) {
  const { snapshot, view } = usePropertyDrafts();
  const { mutating } = useCurrentProject();
  return (
    <fieldset
      className="m-0 contents min-w-0 border-0 p-0"
      disabled={
        !snapshot.ready ||
        mutating ||
        !!snapshot.states[scopeKey(view?.meta.id ?? "", screen)]?.saving
      }
    >
      {children}
    </fieldset>
  );
}

export function DraftInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { field, entry, change, disabled, error } = usePropertyField(props.id);
  if (!field) return <Input {...props} />;
  return (
    <div className="min-w-0" style={{ width: props.style?.width }}>
      <Input
        {...props}
        value={
          entry && entry.conflict !== "entity"
            ? String(entry.value)
            : String(field.base)
        }
        aria-label={props["aria-label"] ?? field.label}
        disabled={props.disabled || disabled}
        aria-invalid={!!error || !!entry?.conflict}
        aria-describedby={
          error ? `${field.id}-error` : props["aria-describedby"]
        }
        onChange={(event) => change(field.id, event.target.value)}
        step={props.step ?? (field.integer ? 1 : "any")}
        data-dirty={!!entry}
        className={cn(
          props.className,
          entry && "border-hms-accent bg-[#F4FAFE]",
        )}
      />
      {error && (
        <p
          id={`${field.id}-error`}
          role="alert"
          className="mt-1 text-[11.5px] text-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}

export function DraftSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { field, entry, change, disabled, error } = usePropertyField(props.id);
  if (!field) return <Select {...props} />;
  const value = entry && entry.conflict !== "entity" ? entry.value : field.base;
  return (
    <div className="min-w-0">
      <Select
        {...props}
        value={typeof value === "boolean" ? Number(value) : String(value)}
        aria-label={props["aria-label"] ?? field.label}
        disabled={props.disabled || disabled}
        aria-invalid={!!error || !!entry?.conflict}
        aria-describedby={
          error ? `${field.id}-error` : props["aria-describedby"]
        }
        onChange={(event) => change(field.id, event.target.value)}
        data-dirty={!!entry}
        className={cn(
          props.className,
          entry && "border-hms-accent bg-[#F4FAFE]",
        )}
      />
      {error && (
        <p
          id={`${field.id}-error`}
          role="alert"
          className="mt-1 text-[11.5px] text-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}

export function ImmediatePropertyError({ id }: { id: string }) {
  const { error } = usePropertyField(id);
  return error ? (
    <p role="alert" className="mt-1 text-[11.5px] text-error">
      {error}
    </p>
  ) : null;
}
