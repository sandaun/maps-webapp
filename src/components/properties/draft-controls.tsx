"use client";

import type { InputHTMLAttributes } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, type InputProps } from "@/components/ui/input";
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

/**
 * Pending dot for table cells without a per-field label: it sits in the cell's
 * left padding so the field never moves when it appears.
 */
function InlineDot() {
  return <span aria-hidden className="pending-dot absolute -left-[9px] top-1/2 -translate-y-1/2" />;
}

export function DraftInput({ inlineDot, ...props }: InputProps & DraftControlProps) {
  const { field, entry, change, disabled, error } = usePropertyField(props.id);
  if (!field) return <Input {...props} />;
  return (
    <div className="min-w-0">
      <div className={cn(inlineDot && "relative")}>
        {inlineDot && entry && <InlineDot />}
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
        />
      </div>
      {entry && <UnsavedNote fieldId={field.id} />}
      {error && (
        <p
          id={`${field.id}-error`}
          role="alert"
          className="mt-[5px] text-[11px] text-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/** V14: a pending field keeps its normal look; the dot by its label marks it. */
export function DraftSelect({ inlineDot, ...props }: SelectProps & DraftControlProps) {
  const { field, entry, change, disabled, error } = usePropertyField(props.id);
  if (!field) return <Select {...props} />;
  const value = entry && entry.conflict !== "entity" ? entry.value : field.base;
  return (
    <div className="min-w-0">
      <div className={cn(inlineDot && "relative")}>
        {inlineDot && entry && <InlineDot />}
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
          className="mt-[5px] text-[11px] text-error"
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
