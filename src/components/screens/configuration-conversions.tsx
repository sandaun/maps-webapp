"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import {
  applyConversion,
  conversionExplanation,
  conversionInverseExplanation,
  conversionSummary,
  FILTER_TYPE_HINTS,
  formatConversionValue,
} from "@/core/conversions/formulas";
import {
  CONVERSION_TYPE,
  conversionErrors,
  filterValueParams,
  FILTER_DESCRIPTION_MAX,
  isEditableConversionType,
  OPERATION_DESCRIPTION_MAX,
  parseConversionNumber,
  type ConversionErrors,
  type ConversionField,
  type ConversionList,
  type ConversionValues,
} from "@/core/conversions/rules";
import { signalsUsingConversion } from "@/core/conversions/usage";
import { useRouter } from "next/navigation";
import type { ProjectView } from "@/lib/project-types";
import { signalsHref } from "@/lib/signals-tabs";
import {
  conversionFieldId,
  conversionParamLabels,
  FILTER_CONDITION_LABELS,
  FILTER_TYPE_LABELS,
  OPERATION_TYPE_LABELS,
} from "@/lib/property-fields";
import { useDraftForm, usePropertyDrafts, usePropertyField } from "@/lib/property-drafts";
import { useSave } from "@/lib/use-save";
import { cn } from "@/lib/utils";
import { DraftInput } from "@/components/properties/draft-controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { SectionHeader } from "./configuration-blocks";

type KnxMbmView = Extract<ProjectView, { family: "knx-mbm" }>;
type Conversion = KnxMbmView["project"]["conversions"][number];
type Signal = KnxMbmView["project"]["signals"][number];

/** A library entry addressed as signal refs and the API address it: list + position. */
interface Entry {
  conv: Conversion;
  list: ConversionList;
  index: number;
  editable: boolean;
}
type Selection = Pick<Entry, "list" | "index">;

function libraryEntries(conversions: Conversion[]): Entry[] {
  const positions = { filters: 0, operations: 0 };
  return conversions.map((conv) => {
    const list: ConversionList = conv.type === CONVERSION_TYPE.FILTER ? "filters" : "operations";
    return { conv, list, index: positions[list]++, editable: isEditableConversionType(conv.type) };
  });
}

const draftGroup = ({ list, index }: Selection) => `conv-${list === "filters" ? "f" : "o"}-${index}`;
const sameEntry = (a: Selection | null, b: Selection) => !!a && a.list === b.list && a.index === b.index;

const TYPE_TAGS: Record<number, string> = { 0: "FILTER", 1: "SCALE", 2: "ARITH", 3: "LOGIC", 4: "LUT" };

function entryName(conv: Pick<Conversion, "type" | "description">): string {
  return conv.description || (conv.type === CONVERSION_TYPE.FILTER ? "Untitled filter" : "Untitled operation");
}

/** Draft baseline with the same value types as the draft fields (filter type and condition are numbers). */
function baselineOf(conv: Conversion) {
  const filter = conv.type === CONVERSION_TYPE.FILTER;
  return {
    description: conv.description,
    type: conv.type,
    param1: filter ? Number(conv.params[0]) : conv.params[0],
    param2: filter ? Number(conv.params[1]) : conv.params[1],
    param3: conv.params[2],
    param4: conv.params[3],
  } as Record<ConversionField, string | number>;
}

/** The entry with its pending drafts, and the MAPS rules checked on the pending fields. */
function useEntryDraft(entry: Entry) {
  const { form, dirtyKeys } = useDraftForm(draftGroup(entry), baselineOf(entry.conv));
  const values: ConversionValues = {
    type: Number(form.type),
    description: String(form.description),
    params: [String(form.param1), String(form.param2), String(form.param3), String(form.param4)],
  };
  const errors: ConversionErrors = entry.editable
    ? conversionErrors(values, dirtyKeys as ReadonlySet<ConversionField>)
    : {};
  return { values, errors, dirty: dirtyKeys.size > 0 };
}

/** Configuration → Conversions: the project's filters and operations (MAPS Conversions Manager). */
export function ConversionsSection({ view, reveal }: { view: KnxMbmView; reveal?: { id: string; seq: number } }) {
  const entries = React.useMemo(() => libraryEntries(view.project.conversions), [view.project.conversions]);
  const [selected, setSelected] = React.useState<Selection | null>(null);
  const [query, setQuery] = React.useState("");
  const [deleting, setDeleting] = React.useState<Entry | null>(null);
  const { save, busy, error } = useSave();

  // The save bar reveals the first invalid draft: select its entry so the field is rendered.
  const [revealed, setRevealed] = React.useState(reveal?.seq);
  if (reveal && reveal.seq !== revealed) {
    setRevealed(reveal.seq);
    const match = reveal.id.match(/^cfg-conv-(f|o)-(\d+)-/);
    if (match) setSelected({ list: match[1] === "f" ? "filters" : "operations", index: Number(match[2]) });
  }

  const current =
    entries.find((entry) => sameEntry(selected, entry)) ?? entries.find((entry) => entry.editable) ?? entries[0];

  const add = async (type: 0 | 1 | 2) => {
    const list: ConversionList = type === CONVERSION_TYPE.FILTER ? "filters" : "operations";
    const index = entries.filter((entry) => entry.list === list).length;
    if (await save([{ type: "addConversion", conversionType: type }])) setSelected({ list, index });
  };
  const duplicate = async (entry: Entry, values: ConversionValues) => {
    const max = entry.list === "filters" ? FILTER_DESCRIPTION_MAX : OPERATION_DESCRIPTION_MAX;
    const suffix = " copy";
    const description = `${values.description.slice(0, max - suffix.length)}${suffix}`;
    const params = values.params.map((p) => parseConversionNumber(p) ?? 0) as [number, number, number, number];
    const index = entries.filter((other) => other.list === entry.list).length;
    const conversionType = values.type as 0 | 1 | 2;
    if (await save([{ type: "addConversion", conversionType, values: { description, params } }]))
      setSelected({ list: entry.list, index });
  };
  const remove = async (entry: Entry) => {
    if (await save([{ type: "removeConversion", list: entry.list, index: entry.index }])) {
      setDeleting(null);
      // Like the manager: select the previous entry of the same list, or the first one.
      setSelected({ list: entry.list, index: Math.max(0, entry.index - 1) });
    }
  };

  const q = query.trim().toLowerCase();
  const matches = (entry: Entry) =>
    !q || `${entryName(entry.conv)} ${conversionSummary(entry.conv)}`.toLowerCase().includes(q);
  const groups: { label: string; items: Entry[]; action?: React.ReactNode; empty: string }[] = [
    {
      label: "Filters",
      items: entries.filter((e) => e.list === "filters"),
      action: (
        <AddButton label="Add filter" disabled={busy} onClick={() => void add(0)}>
          Add
        </AddButton>
      ),
      empty: "No filters yet",
    },
    {
      label: "Operations",
      items: entries.filter((e) => e.list === "operations" && e.editable),
      action: <AddOperationMenu disabled={busy} onAdd={(type) => void add(type)} />,
      empty: "No operations yet",
    },
    { label: "System · read only", items: entries.filter((e) => !e.editable), empty: "" },
  ];

  return (
    <>
      <SectionHeader
        title="Conversions"
        desc="The filters and operations signals can use between KNX and Modbus. Every signal has four slots: a filter on the KNX side, two operations and a filter on the Modbus side. Edits are saved with the bar below; adding and deleting apply at once."
      />
      {error && (
        <p role="alert" className="mb-3 rounded-lg border border-error/30 bg-error-bg px-4 py-2 text-[12.5px] text-error">
          {error}
        </p>
      )}
      <div className="@container">
      <div className="flex flex-col gap-[14px] @min-[680px]:flex-row @min-[680px]:items-start">
        <div className="w-full shrink-0 rounded-lg border border-border bg-white @min-[680px]:w-[260px]">
          {entries.length > 8 && (
            <div className="border-b border-border p-[10px]">
              <Input
                search
                size="sm"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search conversions"
                aria-label="Search conversions"
              />
            </div>
          )}
          <div className="pb-2">
            {groups.map((group) => {
              const shown = group.items.filter(matches);
              if (!group.action && group.items.length === 0) return null;
              return (
                <div key={group.label}>
                  <div className="flex flex-wrap items-center gap-2 px-[14px] pb-[5px] pt-3 font-mono text-[10px] font-semibold uppercase tracking-[.08em] text-fg-subtle">
                    <span className="flex-1">{group.label}</span>
                    <span>{shown.length}</span>
                    {group.action}
                  </div>
                  {shown.length === 0 && (
                    <div className="px-[14px] pb-2 pt-[3px] text-[12px] text-fg-subtle">{q ? "No matches" : group.empty}</div>
                  )}
                  {shown.map((entry) => (
                    <EntryRow
                      key={`${entry.list}-${entry.index}`}
                      entry={entry}
                      used={signalsUsingConversion(view.project.signals, entry.list, entry.index).length}
                      selected={!!current && sameEntry(current, entry)}
                      onSelect={() => setSelected({ list: entry.list, index: entry.index })}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {!current ? (
            <EmptyLibrary busy={busy} onAdd={(type) => void add(type)} />
          ) : current.editable ? (
            <EntryEditor
              key={`${current.list}-${current.index}`}
              entry={current}
              signals={signalsUsingConversion(view.project.signals, current.list, current.index)}
              busy={busy}
              onDuplicate={(values) => void duplicate(current, values)}
              onDelete={() => setDeleting(current)}
            />
          ) : (
            <SystemEntry
              entry={current}
              used={signalsUsingConversion(view.project.signals, current.list, current.index).length}
            />
          )}
        </div>
      </div>
      </div>
      {deleting && (
        <DeleteConversionModal
          entry={deleting}
          signals={signalsUsingConversion(view.project.signals, deleting.list, deleting.index)}
          busy={busy}
          onClose={() => setDeleting(null)}
          onConfirm={() => void remove(deleting)}
        />
      )}
    </>
  );
}

function AddButton({
  label,
  disabled,
  onClick,
  children,
  ...props
}: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode } & React.AriaAttributes) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex cursor-pointer items-center gap-[3px] rounded-[4px] px-[5px] py-[2px] font-sans text-[11.5px] font-bold normal-case tracking-normal text-hms-accent hover:bg-[#EAF3FB] disabled:cursor-default disabled:opacity-50"
      {...props}
    >
      <Plus className="h-3 w-3" aria-hidden />
      {children}
    </button>
  );
}

/** "+ Add" for operations asks for the type: the manager only creates scales and arithmetic ones. */
function AddOperationMenu({ disabled, onAdd }: { disabled?: boolean; onAdd: (type: 1 | 2) => void }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !ref.current?.contains(event.target as Node))
        setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <AddButton label="Add operation" aria-expanded={open} disabled={disabled} onClick={() => setOpen((v) => !v)}>
        Add
      </AddButton>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-10 mt-1 w-[180px] rounded-[6px] border border-border bg-white p-1 font-sans normal-case tracking-normal shadow-[0_12px_32px_rgba(4,61,93,.18)]"
        >
          {(
            [
              [CONVERSION_TYPE.SCALE, "Scale", "Input range → output range"],
              [CONVERSION_TYPE.ARITH, "Arithmetic", "y = x · B · 10^A + C"],
            ] as const
          ).map(([type, label, hint]) => (
            <button
              key={type}
              type="button"
              role="menuitem"
              className="block w-full cursor-pointer rounded-[4px] px-2 py-[6px] text-left hover:bg-[#F4F7F9]"
              onClick={() => {
                setOpen(false);
                onAdd(type);
              }}
            >
              <span className="block text-[12.5px] font-bold text-hms-blue">{label}</span>
              <span className="block font-mono text-[11px] font-normal text-fg-subtle">{hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TypeTag({ type, system }: { type: number; system?: boolean }) {
  const filter = type === CONVERSION_TYPE.FILTER;
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-[6px] py-px font-mono text-[9.5px] font-semibold tracking-[.04em]",
          filter ? "border-border-strong bg-white text-hms-blue" : "border-[#C9DEF0] bg-[#EAF3FB] text-hms-accent",
        )}
      >
        {TYPE_TAGS[type] ?? `TYPE ${type}`}
      </span>
      {system && (
        <span className="inline-flex items-center rounded-full border border-border bg-[#F1F3F5] px-[6px] py-px font-mono text-[9.5px] font-semibold text-fg-muted">
          system
        </span>
      )}
    </span>
  );
}

function EntryRow({
  entry,
  used,
  selected,
  onSelect,
}: {
  entry: Entry;
  used: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { values, errors, dirty } = useEntryDraft(entry);
  const untitled = !values.description;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected || undefined}
      className={cn(
        "flex w-full cursor-pointer items-center gap-[10px] px-[14px] py-[7px] text-left",
        selected ? "bg-[#EAF3FB]" : "hover:bg-[#F4F7F9]",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-[6px]">
          <span
            className={cn(
              "truncate text-[12.5px]",
              selected ? "font-bold text-hms-blue" : "text-text-body",
              untitled && "italic text-fg-subtle",
            )}
          >
            {entryName(values)}
          </span>
          {dirty && <span title="Edited · not saved yet" className="h-[6px] w-[6px] shrink-0 rounded-full bg-warning" />}
          {Object.keys(errors).length > 0 && (
            <span title="Has errors" className="h-[6px] w-[6px] shrink-0 rounded-full bg-error" />
          )}
        </span>
        <span className="mt-px flex min-w-0 items-center gap-[6px]">
          <TypeTag type={values.type} system={!entry.editable} />
          <span className="truncate font-mono text-[11px] text-fg-subtle">{conversionSummary(values)}</span>
        </span>
      </span>
      <span
        title={used ? `Used by ${used} ${used === 1 ? "signal" : "signals"}` : "Not used by any signal"}
        className={cn("shrink-0 font-mono text-[11px]", used ? "text-fg-muted" : "italic text-fg-subtle")}
      >
        {used ? `used by ${used}` : "unused"}
      </span>
    </button>
  );
}

function EmptyLibrary({ busy, onAdd }: { busy: boolean; onAdd: (type: 0 | 1 | 2) => void }) {
  return (
    <div className="rounded-lg border border-border bg-white px-8 py-14 text-center">
      <div className="mb-2 font-display text-[17px] text-hms-blue">No filters or operations in this project yet</div>
      <p className="mx-auto mb-[18px] max-w-[440px] text-[12.5px] leading-[1.6] text-fg-muted">
        A filter decides what happens to a value that does not meet a condition. An operation transforms the value:
        a scale maps one range onto another and an arithmetic operation calculates y = x · B · 10^A + C.
      </p>
      <div className="flex flex-wrap justify-center gap-[9px]">
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => onAdd(0)}>
          New filter
        </Button>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => onAdd(1)}>
          New scale
        </Button>
        <Button size="sm" disabled={busy} onClick={() => onAdd(2)}>
          New arithmetic
        </Button>
      </div>
    </div>
  );
}

function DetailCard({
  entry,
  values,
  used,
  children,
  foot,
}: {
  entry: Entry;
  values: ConversionValues;
  used: number;
  children: React.ReactNode;
  foot: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-white">
      <header className="flex flex-wrap items-center gap-[10px] border-b border-border bg-[#FCFCFD] px-[18px] py-[13px]">
        <TypeTag type={values.type} system={!entry.editable} />
        <h3
          className={cn(
            "min-w-[min(120px,100%)] flex-1 truncate text-[14px] font-bold text-hms-blue",
            !values.description && "italic text-fg-subtle",
          )}
        >
          {entryName(values)}
        </h3>
        {used ? (
          <button
            type="button"
            onClick={() => router.push(signalsHref("map", undefined, { list: entry.list, index: entry.index }))}
            className="cursor-pointer text-left text-[12px] font-bold text-hms-accent hover:text-hms-accent-hover"
          >
            {`Used by ${used} ${used === 1 ? "signal" : "signals"} →`}
          </button>
        ) : (
          <span className="text-[12px] text-fg-muted">Not used by any signal</span>
        )}
      </header>
      {children}
      <footer className="flex flex-wrap items-center gap-[9px] border-t border-border bg-[#FCFCFD] px-[18px] py-3">{foot}</footer>
    </section>
  );
}

/**
 * Field row of the V15 conversions editor: the label keeps 170px beside the
 * control and moves above it when the card is too narrow for both.
 */
function ConversionRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="pending-field flex flex-wrap items-start gap-x-4 gap-y-2 border-b border-[#F2F3F4] py-[11px]">
      <div className="min-w-0 flex-[0_1_170px] pt-[5px]">
        <div className="pending-label text-[12.5px] font-bold text-text-body">{label}</div>
        {hint && <div className="mt-[2px] text-[11px] leading-[1.45] text-fg-subtle">{hint}</div>}
      </div>
      <div className="min-w-0 flex-[1_1_240px]">{children}</div>
    </div>
  );
}

/** Radio chips for a draft field with a few options (filter type, condition, operation type). */
function DraftChips({
  id,
  labels,
  onChoose,
}: {
  id: string;
  labels: Readonly<Record<string, string>>;
  /** Runs after the choice is staged. */
  onChoose?: (value: number) => void;
}) {
  const { field, entry, change, disabled, error } = usePropertyField(id);
  if (!field) return null;
  const value = String(entry && entry.conflict !== "entity" ? entry.value : field.base);
  return (
    <div className="min-w-0">
      <div
        id={id}
        tabIndex={-1}
        role="radiogroup"
        aria-label={field.label}
        aria-invalid={!!error || undefined}
        data-dirty={!!entry}
        className="flex flex-wrap gap-[6px] outline-none"
      >
        {Object.entries(labels).map(([option, label]) => {
          const on = option === value;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => {
                change(id, Number(option));
                onChoose?.(Number(option));
              }}
              className={cn(
                "max-w-full cursor-pointer rounded-[4px] border px-[10px] py-[5px] text-left text-[12px] disabled:cursor-default",
                on
                  ? "border-[#C9DEF0] bg-[#EAF3FB] font-bold text-hms-blue"
                  : "border-border bg-white text-fg-muted hover:border-hms-accent",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-[5px] text-[11px] text-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** A live rule message, unless the save attempt already shows the same one under the field. */
function LiveError({ id, message }: { id: string; message?: string }) {
  const { error } = usePropertyField(id);
  if (!message || message === error) return null;
  return <p className="mt-[5px] text-[11px] leading-[1.4] text-error">{message}</p>;
}

function NumberField({ id, label, error }: { id: string; label: string; error?: string }) {
  return (
    <div className="w-[min(120px,100%)]">
      <DraftInput id={id} type="number" aria-label={label} className="font-mono" style={{ width: "100%" }} />
      <LiveError id={id} message={error} />
    </div>
  );
}

function EntryEditor({
  entry,
  signals,
  busy,
  onDuplicate,
  onDelete,
}: {
  entry: Entry;
  signals: Signal[];
  busy: boolean;
  onDuplicate: (values: ConversionValues) => void;
  onDelete: () => void;
}) {
  const { values, errors, dirty } = useEntryDraft(entry);
  const drafts = usePropertyDrafts();
  const id = (key: ConversionField) => conversionFieldId(entry.list, entry.index, key);
  const filter = values.type === CONVERSION_TYPE.FILTER;
  // Like the MAPS numeric boxes, which fall back to their last valid value: a param the new
  // condition or type hides keeps a valid pending value, but not an empty or broken one.
  const dropHiddenInvalid = (type: number, comparison: number) => {
    const used: ConversionField[] =
      type === CONVERSION_TYPE.FILTER
        ? filterValueParams(comparison)
        : type === CONVERSION_TYPE.ARITH
          ? ["param1", "param2", "param3"]
          : ["param1", "param2", "param3", "param4"];
    const numeric: ConversionField[] = filter ? ["param3", "param4"] : ["param1", "param2", "param3", "param4"];
    numeric.forEach((key, i) => {
      const offset = filter ? 2 : 0;
      if (used.includes(key) || parseConversionNumber(values.params[i + offset]) !== undefined) return;
      const field = drafts.fields.find((candidate) => candidate.id === id(key));
      if (field) drafts.change(field.id, field.base);
    });
  };
  const labels = conversionParamLabels(values.type, Number(values.params[1]));
  const valueErrors = Object.entries(errors).filter(([key]) => key !== "description");
  // Only the values the editor shows can be wrong: a duplicate copies them as they are now.
  const complete = Object.keys(conversionErrors(values)).length === 0;

  return (
    <DetailCard
      entry={entry}
      values={values}
      used={signals.length}
      foot={
        <>
          <p className="flex-1 text-[11.5px] text-fg-subtle">{dirty ? "Edited · save with the bar below" : ""}</p>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || !complete}
            title={complete ? undefined : "Some values do not follow the MAPS rules (for example more than 2 decimals), so they cannot be copied"}
            onClick={() => onDuplicate(values)}
          >
            Duplicate
          </Button>
          <Button variant="secondary" size="sm" className="text-error" disabled={busy} onClick={onDelete}>
            Delete
          </Button>
        </>
      }
    >
      <div className="px-[18px] pb-[6px] pt-[2px]">
        <ConversionRow label="Description" hint={filter ? undefined : `Up to ${OPERATION_DESCRIPTION_MAX} characters`}>
          <DraftInput
            id={id("description")}
            aria-label="Description"
            maxLength={filter ? FILTER_DESCRIPTION_MAX : OPERATION_DESCRIPTION_MAX}
            placeholder={filter ? "Untitled filter" : "Untitled operation"}
            style={{ width: "100%", maxWidth: 340 }}
          />
          <LiveError id={id("description")} message={errors.description} />
        </ConversionRow>
        {filter ? (
          <>
            <ConversionRow label="Filter type" hint={FILTER_TYPE_HINTS[Number(values.params[0])]}>
              <DraftChips id={id("param1")} labels={FILTER_TYPE_LABELS} />
            </ConversionRow>
            <ConversionRow label="Condition">
              <DraftChips
                id={id("param2")}
                labels={FILTER_CONDITION_LABELS}
                onChoose={(comparison) => dropHiddenInvalid(values.type, comparison)}
              />
              <LiveError id={id("param2")} message={errors.param2} />
            </ConversionRow>
            <FilterValues entry={entry} values={values} errors={errors} />
          </>
        ) : (
          <>
            <ConversionRow label="Type">
              <DraftChips
                id={id("type")}
                labels={OPERATION_TYPE_LABELS}
                onChoose={(type) => dropHiddenInvalid(type, Number(values.params[1]))}
              />
            </ConversionRow>
            {values.type === CONVERSION_TYPE.SCALE ? (
              <>
                <ConversionRow label="Input range" hint="Values outside it are limited to it first">
                  <RangeInputs entry={entry} keys={["param1", "param2"]} labels={labels} errors={errors} />
                </ConversionRow>
                <ConversionRow label="Output range">
                  <RangeInputs entry={entry} keys={["param3", "param4"]} labels={labels} errors={errors} />
                </ConversionRow>
              </>
            ) : (
              <ConversionRow label="Formula" hint="y = x · B · 10^A + C">
                <div className="flex flex-wrap items-start gap-3">
                  {(["param1", "param2", "param3"] as const).map((key, i) => (
                    <label key={key} className="flex min-w-0 max-w-full items-start gap-[6px]">
                      <span className="pt-[6px] font-mono text-[12px] text-fg-muted">{["A", "B", "C"][i]}</span>
                      <NumberField id={id(key)} label={labels[i]} error={errors[key]} />
                    </label>
                  ))}
                </div>
              </ConversionRow>
            )}
          </>
        )}
      </div>
      <div className="mx-[18px] mt-2 rounded-[6px] bg-[#F7F9FA] px-[13px] py-[11px]">
        <div className="mb-[5px] font-mono text-[10px] font-semibold tracking-[.08em] text-fg-subtle">IN PLAIN WORDS</div>
        {valueErrors.length ? (
          <p className="text-[12.5px] leading-[1.55] text-text-body">Fix the values above to see what it does.</p>
        ) : (
          <>
            <p className="text-[12.5px] leading-[1.55] text-text-body">{conversionExplanation(values)}</p>
            <p className="mt-[3px] text-[12.5px] leading-[1.55] text-fg-muted">{conversionInverseExplanation(values)}</p>
          </>
        )}
      </div>
      <TryIt values={values} blocked={valueErrors.length > 0} />
    </DetailCard>
  );
}

function RangeInputs({
  entry,
  keys,
  labels,
  errors,
}: {
  entry: Entry;
  keys: [ConversionField, ConversionField];
  labels: string[];
  errors: ConversionErrors;
}) {
  const [low, high] = keys;
  const label = (key: ConversionField) => labels[Number(key.at(-1)) - 1];
  return (
    <div className="flex flex-wrap items-start gap-2">
      <NumberField id={conversionFieldId(entry.list, entry.index, low)} label={label(low)} error={errors[low]} />
      <span className="pt-[6px] text-[12px] text-fg-muted">to</span>
      <NumberField id={conversionFieldId(entry.list, entry.index, high)} label={label(high)} error={errors[high]} />
    </div>
  );
}

function FilterValues({ entry, values, errors }: { entry: Entry; values: ConversionValues; errors: ConversionErrors }) {
  const comparison = Number(values.params[1]);
  const used = filterValueParams(comparison);
  const labels = conversionParamLabels(values.type, comparison);
  const hint = "Compared with the value on the side of the signal where the filter sits · −100000 to 100000";
  if (used.length === 2)
    return (
      <ConversionRow label={comparison === 4 ? "Range (Low ≤ x ≤ High)" : "Range (x < Low or x > High)"} hint={hint}>
        <RangeInputs entry={entry} keys={["param3", "param4"]} labels={labels} errors={errors} />
      </ConversionRow>
    );
  const key = used[0];
  return (
    <ConversionRow label="Value" hint={hint}>
      <NumberField id={conversionFieldId(entry.list, entry.index, key)} label="Value" error={errors[key]} />
    </ConversionRow>
  );
}

function TryIt({ values, blocked }: { values: ConversionValues; blocked: boolean }) {
  const [input, setInput] = React.useState("");
  const [inverted, setInverted] = React.useState(false);
  const filter = values.type === CONVERSION_TYPE.FILTER;
  const x = parseConversionNumber(input);
  let result: { text: string; bad: boolean } | undefined;
  if (x !== undefined) {
    if (blocked) result = { text: "fix the errors first", bad: true };
    else {
      const outcome = applyConversion(values, x, !filter && inverted);
      result =
        outcome.kind === "value"
          ? { text: formatConversionValue(outcome.value), bad: false }
          : outcome.kind === "discarded"
            ? { text: "not forwarded", bad: true }
            : { text: "no result", bad: true };
    }
  }
  return (
    <div className="mx-[18px] mb-4 mt-3 flex flex-wrap items-center gap-[10px] rounded-[6px] border border-border px-[13px] py-[10px]">
      <div className="w-[48px] font-mono text-[10px] font-semibold tracking-[.08em] text-fg-subtle">TRY IT</div>
      {!filter && (
        <div role="radiogroup" aria-label="Direction" className="flex min-w-0 flex-wrap gap-1">
          {(
            [
              [false, "Forward"],
              [true, "Other direction"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={inverted === value}
              onClick={() => setInverted(value)}
              className={cn(
                "max-w-full cursor-pointer rounded-[4px] border px-[9px] py-1 text-left text-[12px]",
                inverted === value
                  ? "border-[#C9DEF0] bg-[#EAF3FB] font-bold text-hms-blue"
                  : "border-border bg-white text-fg-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <Input
        type="number"
        aria-label="Value to try"
        placeholder="e.g. 215"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        style={{ width: "min(110px, 100%)" }}
      />
      <span className="text-fg-subtle" aria-hidden>
        →
      </span>
      <span
        role="status"
        aria-label="Try it result"
        className={cn(
          "text-[12px]",
          result
            ? cn(
                "rounded-full border px-2 py-[2px] font-mono font-bold",
                result.bad ? "border-[#E8C4C0] bg-[#FDF3F2] text-error" : "border-[#BFE3D4] bg-[#F1FAF6] text-success",
              )
            : "text-fg-subtle",
        )}
      >
        {result?.text ?? (filter ? "forwarded value" : "result")}
      </span>
    </div>
  );
}

/** LUT remaps and logical operations: created by the template, shown as MAPS stores them. */
function SystemEntry({ entry, used }: { entry: Entry; used: number }) {
  const [p1, p2, p3] = entry.conv.params;
  const mask = (value: string) => {
    const n = parseConversionNumber(value);
    return n === undefined ? value || "—" : `${Math.trunc(n).toString(2)} (${Math.trunc(n)})`;
  };
  const rows: [string, string][] =
    entry.conv.type === CONVERSION_TYPE.LOGICAL
      ? [
          ["OR mask", mask(p1)],
          ["AND mask", mask(p2)],
          ["XOR mask", mask(p3)],
          ["Behaviour", "Applied in order: OR → AND → XOR"],
        ]
      : entry.conv.type === CONVERSION_TYPE.LUT_REMAP
        ? [
            ["Remap table", p1 || "—"],
            ["Inverse table", Number(p2) & 0x8 ? "Yes" : "No"],
          ]
        : [["Parameters", entry.conv.params.filter(Boolean).join(" · ") || "—"]];
  return (
    <DetailCard
      entry={entry}
      values={entry.conv}
      used={used}
      foot={<p className="flex-1 text-[11.5px] text-fg-subtle">Created by the template. Cannot be edited.</p>}
    >
      <div className="px-[18px] pb-[6px] pt-[2px]">
        {rows.map(([label, value]) => (
          <ConversionRow key={label} label={label}>
            <div className="py-[6px] font-mono text-[12.5px] text-hms-blue">{value}</div>
          </ConversionRow>
        ))}
      </div>
      <div className="mx-[18px] mb-4 mt-2 rounded-[6px] bg-[#F7F9FA] px-[13px] py-[11px] text-[12.5px] leading-[1.55] text-fg-muted">
        {conversionInverseExplanation(entry.conv)}
      </div>
    </DetailCard>
  );
}

function DeleteConversionModal({
  entry,
  signals,
  busy,
  onClose,
  onConfirm,
}: {
  entry: Entry;
  signals: Signal[];
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const drafts = usePropertyDrafts();
  const group = draftGroup(entry);
  const pending = Object.values(drafts.snapshot.projects[drafts.view?.meta.id ?? ""]?.edits ?? {}).filter(
    (edit) => edit.group === group,
  ).length;
  const what = entry.list === "filters" ? "filter" : "operation";
  const n = signals.length;
  return (
    <Modal
      title={`Delete “${entryName(entry.conv)}”?`}
      description={
        n
          ? `${n} ${n === 1 ? "signal uses" : "signals use"} this ${what}. Deleting it removes it from ${n === 1 ? "that signal" : "all of them"}.`
          : `No signal uses this ${what}. It is removed from the project library.`
      }
      foot={`The later ${what}s move up one place; the signals that use them are updated to keep them.`}
      ctaLabel={n ? `Delete and update ${n} ${n === 1 ? "signal" : "signals"}` : "Delete"}
      ctaDisabled={busy}
      width={540}
      onClose={onClose}
      onConfirm={onConfirm}
    >
      <div className="text-[12.5px] text-text-body">
        {n > 0 && (
          <>
            <ul className="mb-3 space-y-1">
              {signals.slice(0, 5).map((signal) => (
                <li key={signal.id} className="flex gap-2">
                  <span className="w-9 shrink-0 font-mono text-fg-subtle">#{signal.id + 1}</span>
                  <span className="truncate">{signal.description || `Signal ${signal.id + 1}`}</span>
                </li>
              ))}
              {n > 5 && <li className="text-fg-muted">{`+ ${n - 5} more ${n - 5 === 1 ? "signal" : "signals"}`}</li>}
            </ul>
            <p>These signals lose this {what}. Their other conversions keep working.</p>
          </>
        )}
        {pending > 0 && (
          <p className="mt-3">{`${pending} unsaved ${pending === 1 ? "edit" : "edits"} on this ${what} ${pending === 1 ? "is" : "are"} discarded.`}</p>
        )}
      </div>
    </Modal>
  );
}
