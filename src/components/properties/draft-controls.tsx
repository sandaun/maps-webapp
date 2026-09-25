"use client";

import type { InputHTMLAttributes } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, type SelectProps } from "@/components/ui/select";
import { Switch, type SwitchProps } from "@/components/ui/switch";
import { usePropertyField } from "@/lib/property-drafts";
import { cn } from "@/lib/utils";

/** Checkbox for an immediate property: stays focusable while its own save runs. */
export function PropertyCheckbox({
  id,
  onChange,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { id: string }) {
  const { disabled } = usePropertyField(id);
  return (
    <Checkbox
      {...props}
      aria-disabled={disabled || undefined}
      aria-busy={disabled || undefined}
      className={cn(props.className, disabled && "opacity-50 [&>input]:cursor-progress")}
      onChange={(event) => {
        if (!disabled) onChange?.(event);
      }}
    />
  );
}

/** Switch for an immediate property: stays focusable while its own save runs. */
export function PropertySwitch({ id, ...props }: SwitchProps & { id: string }) {
  const { disabled } = usePropertyField(id);
  return <Switch {...props} busy={disabled} />;
}

interface DraftControlProps {
  /** No per-row label (table cells): show the pending dot before the control. */
  inlineDot?: boolean;
}

/** Ids for aria-describedby: the error, the "(unsaved)" note, then the caller's. */
function describedBy(fieldId: string, error: unknown, dirty: boolean, own?: string) {
  return (
    [error ? `${fieldId}-error` : undefined, dirty ? `${fieldId}-unsaved` : undefined, own]
      .filter(Boolean)
      .join(" ") || undefined
  );
}

/** Announced with the control while it holds an unsaved draft. */
function UnsavedNote({ fieldId }: { fieldId: string }) {
  return (
    <span id={`${fieldId}-unsaved`} className="sr-only">
      (unsaved)
    </span>
  );
}

export function DraftInput({ inlineDot, ...props }: InputHTMLAttributes<HTMLInputElement> & DraftControlProps) {
  const { field, entry, change, disabled, error } = usePropertyField(props.id);
  if (!field) return <Input {...props} />;
  return (
    <div className="min-w-0" style={{ width: props.style?.width }}>
      <div className={cn(inlineDot && "flex items-center gap-1.5")}>
        {inlineDot && entry && <span aria-hidden className="pending-dot shrink-0" />}
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
          aria-describedby={describedBy(field.id, error, !!entry, props["aria-describedby"])}
          onChange={(event) => change(field.id, event.target.value)}
          step={props.step ?? (field.integer ? 1 : "any")}
          data-dirty={!!entry}
          className={cn(
            props.className,
            entry && "border-hms-accent bg-[#F4FAFE]",
          )}
        />
      </div>
      {entry && <UnsavedNote fieldId={field.id} />}
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

/** V12: a pending select keeps its normal border and background (the dot marks it). */
export function DraftSelect({ inlineDot, ...props }: SelectProps & DraftControlProps) {
  const { field, entry, change, disabled, error } = usePropertyField(props.id);
  if (!field) return <Select {...props} />;
  const value = entry && entry.conflict !== "entity" ? entry.value : field.base;
  return (
    <div className="min-w-0">
      <div className={cn(inlineDot && "flex items-center gap-1.5")}>
        {inlineDot && entry && <span aria-hidden className="pending-dot shrink-0" />}
        <Select
          {...props}
          value={typeof value === "boolean" ? Number(value) : String(value)}
          aria-label={props["aria-label"] ?? field.label}
          disabled={props.disabled || disabled}
          aria-invalid={!!error || !!entry?.conflict}
          aria-describedby={describedBy(field.id, error, !!entry, props["aria-describedby"])}
          onValueChange={(next) => change(field.id, next)}
          data-dirty={!!entry}
        />
      </div>
      {entry && <UnsavedNote fieldId={field.id} />}
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
