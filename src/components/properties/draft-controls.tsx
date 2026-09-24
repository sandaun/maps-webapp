"use client";

import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
      className={cn(props.className, disabled && "cursor-progress opacity-50")}
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
