"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Crosshair, Loader2, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import type { MeControllerInfo, MeGroupInfo } from "@/protocols/me";
import { CONTROLLER_MODELS } from "@/protocols/me";
import type { ScannedMeGroup } from "@/gateway-families/me-mbs/bus-scan";
import type { MeMbsSignal } from "@/gateway-families/me-mbs/model";
import { scanMeGroups } from "@/lib/gateway-api";
import { useGatewaySession } from "@/lib/gateway-session";
import type { ProjectPatchInput, ProjectView } from "@/lib/project-types";
import { usePatch } from "@/lib/current-project";
import { useDraftForm, usePropertyDrafts, useRevealProperty, useSaveInProgress } from "@/lib/property-drafts";
import { StickySaveBar } from "@/components/properties/sticky-save-bar";
import { cn } from "@/lib/utils";
import { ScreenIssues } from "@/components/screens/screen-gate";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DraftInput as Input, DraftSelect as Select, ImmediatePropertyError, PropertySwitch } from "@/components/properties/draft-controls";
import { Modal } from "@/components/ui/modal";

type MeMbsView = Extract<ProjectView, { family: "me-mbs" }>;

const GROUPS_PER_CONTROLLER = 50;
const LICENSED_GROUPS = 100;

/** Short model label for the tree chip. */
const CONTROLLER_MODEL_LABELS: Record<number, string> = {
  0: "AG-150",
  1: "EB-50GU",
  2: "AE-200",
  3: "AE-C400E",
};

/** V11 select labels for the controller model. */
const ME_MODEL_OPTIONS = [
  { value: 0, label: "AG-150A or older" },
  { value: 1, label: "EB-50GU" },
  { value: 2, label: "AE-200, EW-50" },
  { value: 3, label: "AE-C400E, EW-C50" },
];

/** Desktop `GetControllerTypeString` (frmDiscoverMe.cs). */
const CONTROLLER_TYPE_LABELS: Record<number, string> = {
  0: "Controller Direct Connection",
  1: "Expansion Controller 1",
  2: "Expansion Controller 2",
  3: "Expansion Controller 3",
};

const GROUP_TYPE_SHORT: Record<number, string> = {
  0: "IC",
  1: "LC",
  2: "FU",
  3: "BU",
  4: "WH",
  5: "CEh",
  6: "SYS",
};

/** V11 select labels for the group unit type. */
const GROUP_TYPE_OPTIONS = [
  { value: 0, label: "IC: Air Conditioning Unit" },
  { value: 1, label: "LC: Lossnay" },
  { value: 2, label: "FU: Outdoor-Air Processing Unit" },
  { value: 3, label: "BU: Air to Water Booster Unit" },
  { value: 4, label: "WH: Air to Water HEX Unit" },
  { value: 5, label: "CEh: Heat Pump" },
  { value: 6, label: "System Component" },
];

/**
 * Which settings apply to each unit type (V11 `CAPS` matrix): fan speeds,
 * setpoint type and URC. Non-applicable settings render as a note.
 */
const GROUP_CAPS: Record<number, { fan: boolean; sp: boolean; urc: boolean }> = {
  0: { fan: true, sp: true, urc: true },
  1: { fan: true, sp: false, urc: false },
  2: { fan: true, sp: true, urc: false },
  3: { fan: false, sp: true, urc: false },
  4: { fan: false, sp: true, urc: false },
  5: { fan: false, sp: true, urc: false },
  6: { fan: false, sp: false, urc: false },
};

/** Card-header tags that render with the amber warning pill (V11). */
const WARN_TAGS = new Set(["gateway offline", "no data", "not integrated"]);

type Selection =
  | { kind: "controller"; controllerIndex: number }
  | { kind: "group"; controllerIndex: number; groupIndex: number };

/**
 * ME–MBS "AC units" (V11): master-detail over the Mitsubishi Electric side.
 * Left tree lists the centralized controllers and their integrated (enabled)
 * groups; the detail pane edits the selected controller or group through the
 * patch API. The Modbus Slave summary lives in Configuration → BMS.
 */
export function MeMbsDevicesView({ view }: { view: MeMbsView }) {
  const { session } = useGatewaySession();
  const [selection, setSelection] = React.useState<Selection>({ kind: "controller", controllerIndex: 0 });
  const drafts = usePropertyDrafts();
  useRevealProperty(React.useCallback((section: string) => {
    const group = section.match(/^dev-g-(\d+)-(\d+)$/);
    const controller = section.match(/^dev-cc-(\d+)$/);
    if (group) setSelection({ kind: "group", controllerIndex: Number(group[1]), groupIndex: Number(group[2]) });
    else if (controller) setSelection({ kind: "controller", controllerIndex: Number(controller[1]) });
  }, []));
  const [query, setQuery] = React.useState("");
  const [railOpen, setRailOpen] = React.useState(true);
  const [addFor, setAddFor] = React.useState<number | null>(null);
  const [scanFor, setScanFor] = React.useState<MeControllerInfo | null>(null);

  const controllers = view.project.me.controllers;
  const integratedCount = controllers.reduce(
    (acc, c) => acc + c.groups.filter((g) => g.enabled).length,
    0,
  );

  /** `${controllerIndex}-${groupIndex}` → mapped signal count (for tree dots). */
  const signalCounts = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const s of view.project.signals) {
      const key = `${s.me.g50Index}-${s.me.groupIndex}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [view.project.signals]);

  const toggleController = (c: MeControllerInfo, enabled: boolean) =>
    drafts.change(`dev-cc-${c.index}-enabled`, enabled);

  const toggleGroup = (g: MeGroupInfo, enabled: boolean) =>
    drafts.change(`dev-g-${g.controllerIndex}-${g.index}-enabled`, enabled);

  const connected = session?.connected === true;
  const selectedController = controllers.find((c) => c.index === selection.controllerIndex);
  const selectedGroup =
    selection.kind === "group"
      ? selectedController?.groups.find((g) => g.index === selection.groupIndex)
      : undefined;
  const removable = selectedGroup?.enabled === true;

  return (
    <div className="-m-6 flex min-h-[calc(100%+3rem)]">
      {/* ---------- device tree (V11) ---------- */}
      {railOpen ? (
        <aside className="flex w-[314px] shrink-0 flex-col border-r border-border bg-white">
          <div className="flex items-center gap-2 border-b border-border p-3">
            <div className="relative min-w-0 flex-1">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter devices"
                aria-label="Filter devices"
                className="w-full rounded-[4px] border border-border bg-[#FBFBFC] py-[6px] pl-[27px] pr-[9px] text-[12.5px] focus-visible:outline-2 focus-visible:outline-hms-accent"
              />
              <Search className="pointer-events-none absolute left-2 top-[7px] size-[13px] text-fg-subtle" />
            </div>
            <button
              type="button"
              disabled={!connected || !selectedController}
              title={connected ? undefined : "Connect the gateway to scan the centralized controllers"}
              onClick={() => selectedController && setScanFor(selectedController)}
              className={cn(
                "shrink-0 cursor-pointer whitespace-nowrap rounded-[4px] border px-[10px] py-[6px] text-[12px] font-bold",
                connected && selectedController
                  ? "border-hms-accent text-hms-accent hover:bg-[#F2F8FD]"
                  : "cursor-not-allowed border-border text-fg-subtle",
              )}
            >
              Scan groups
            </button>
            <button
              type="button"
              aria-label="Collapse device list"
              onClick={() => setRailOpen(false)}
              className="shrink-0 cursor-pointer rounded-[4px] p-1 text-fg-subtle hover:bg-hms-muted hover:text-fg-muted"
            >
              <PanelLeftClose className="size-[15px]" aria-hidden />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pb-5 pt-[6px]">
            {controllers.map((c) => (
              <ControllerNode
                key={c.index}
                controller={c}
                query={query}
                selection={selection}
                gatewayConnected={connected}
                signalCounts={signalCounts}
                onSelect={setSelection}
                onToggleController={toggleController}
                onToggleGroup={toggleGroup}
              />
            ))}
            {controllers.length === 0 && (
              <p className="px-[10px] text-[12.5px] text-fg-muted">No centralized controllers in this project.</p>
            )}
          </div>

          <div className="flex flex-col gap-[9px] border-t border-border px-3 py-[10px]">
            <div className="flex items-baseline gap-2">
              <span className="flex-1 text-[11.5px] text-fg-muted">{integratedCount} groups integrated</span>
              <span className="font-mono text-[10.5px] text-fg-subtle">{LICENSED_GROUPS} licensed</span>
            </div>
            <div className="flex gap-[7px]">
              <button
                type="button"
                onClick={() => setAddFor(selectedController?.index ?? controllers[0]?.index ?? 0)}
                className="flex-1 cursor-pointer rounded-[4px] border border-hms-accent px-2 py-[6px] text-center text-[12px] font-bold text-hms-accent hover:bg-[#F2F8FD]"
              >
                Add groups
              </button>
              <button
                type="button"
                disabled={!removable}
                title={removable ? "Drop this group's Modbus registers" : "Select an integrated group first"}
                onClick={() => selectedGroup && toggleGroup(selectedGroup, false)}
                className="cursor-pointer rounded-[4px] border border-border px-[9px] py-[6px] text-[12px] text-[#B03A2E] hover:border-[#B03A2E] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </div>
        </aside>
      ) : (
        <div className="flex w-[34px] shrink-0 flex-col items-center border-r border-border bg-white py-2">
          <button
            type="button"
            aria-label="Expand device list"
            onClick={() => setRailOpen(true)}
            className="cursor-pointer rounded-[4px] p-[6px] text-fg-subtle hover:bg-hms-muted hover:text-fg-muted"
          >
            <PanelLeftOpen className="size-[15px]" aria-hidden />
          </button>
        </div>
      )}

      {/* ---------- detail ---------- */}
      <div className="min-w-0 flex-1">
        <div className="flex min-h-full max-w-[940px] flex-col px-6 pb-1 pt-5">
          <div className="flex-1 pb-6">
          <ScreenIssues issues={view.issues} screen="devices" />
          <DetailPane
            key={selectionKey(selection)}
            view={view}
            selection={selection}
            onScan={setScanFor}
            onAddGroups={(controllerIndex) => setAddFor(controllerIndex)}
          />
          </div>
          <StickySaveBar screen="devices" />
        </div>
      </div>

      {addFor !== null && (
        <AddGroupsModal view={view} initialControllerIndex={addFor} onClose={() => setAddFor(null)} />
      )}
      {scanFor && session?.connected && (
        <ScanGroupsModal controller={scanFor} sessionId={session.id} onClose={() => setScanFor(null)} />
      )}
    </div>
  );
}

function selectionKey(sel: Selection): string {
  return sel.kind === "controller" ? `c${sel.controllerIndex}` : `g${sel.controllerIndex}-${sel.groupIndex}`;
}

/* ---------------------------------------------------------------------------
 * Tree
 * ------------------------------------------------------------------------- */

function ControllerNode({
  controller,
  query,
  selection,
  gatewayConnected,
  signalCounts,
  onSelect,
  onToggleController,
  onToggleGroup,
}: {
  controller: MeControllerInfo;
  query: string;
  selection: Selection;
  gatewayConnected: boolean;
  signalCounts: Map<string, number>;
  onSelect: (sel: Selection) => void;
  onToggleController: (c: MeControllerInfo, enabled: boolean) => void;
  onToggleGroup: (g: MeGroupInfo, enabled: boolean) => void;
}) {
  const enabledGroups = controller.groups.filter((g) => g.enabled);
  const q = query.trim().toLowerCase();
  const groupLabel = (g: MeGroupInfo) =>
    `g${g.index + 1} ${g.description} ${GROUP_TYPE_SHORT[g.type] ?? ""}`.toLowerCase();
  const shownGroups = q ? enabledGroups.filter((g) => groupLabel(g).includes(q)) : enabledGroups;
  const controllerLabel =
    `${controller.description} ${CONTROLLER_MODEL_LABELS[controller.model] ?? ""}`.toLowerCase();
  if (q && shownGroups.length === 0 && !controllerLabel.includes(q)) return null;

  const selected = selection.kind === "controller" && selection.controllerIndex === controller.index;
  const off = !controller.enabled;
  const dotTone = off && enabledGroups.length > 0 ? "red" : off || !gatewayConnected ? "grey" : "green";

  return (
    <div>
      <div
        className={cn(
          "flex w-full items-center gap-[7px] py-[5px] pl-2 pr-[10px] text-left text-[12.5px]",
          selected ? "bg-[#EAF3FB] font-bold text-hms-blue" : off ? "text-fg-subtle" : "text-text-body",
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-[7px] text-left"
          aria-label={`Select controller ${controller.index + 1}`}
          onClick={() => onSelect({ kind: "controller", controllerIndex: controller.index })}
        >
          <span
            className={cn(
              "shrink-0 rounded-[2px] px-1 py-[2px] font-mono text-[9.5px] font-semibold text-white",
              off ? "bg-[#8B979F]" : "bg-hms-blue",
            )}
          >
            {CONTROLLER_MODEL_LABELS[controller.model] ?? `Model ${controller.model}`}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {controller.description || `Controller ${controller.index + 1}`}
          </span>
          <span className="shrink-0 font-mono text-[10.5px] text-fg-subtle">
            {enabledGroups.length}/{GROUPS_PER_CONTROLLER}
          </span>
        </button>
        <StatusDot tone={dotTone} />
        <PropertySwitch
          id={`dev-cc-${controller.index}-enabled`}
          aria-label={`Controller ${controller.index + 1} enabled`}
          title={controller.enabled ? "Polled — switch off to stop polling this controller" : "Not polled"}
          checked={controller.enabled}
          onCheckedChange={(enabled) => onToggleController(controller, enabled)}
        />
      </div>

      <ImmediatePropertyError id={`dev-cc-${controller.index}-enabled`} />

      {shownGroups.map((g) => {
        const groupSelected =
          selection.kind === "group" &&
          selection.controllerIndex === controller.index &&
          selection.groupIndex === g.index;
        const groupOff = off || !g.enabled;
        const groupSignals = signalCounts.get(`${controller.index}-${g.index}`) ?? 0;
        const groupDot =
          groupOff || !gatewayConnected ? "grey" : groupSignals === 0 ? "amber" : "green";
        return (
          <div
            key={g.index}
            className={cn(
              "flex w-full items-center gap-[7px] py-[5px] pl-[22px] pr-[10px] text-left text-[12.5px]",
              groupSelected
                ? "bg-[#EAF3FB] font-bold text-hms-blue"
                : groupOff
                  ? "text-fg-subtle"
                  : "text-text-body",
            )}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-[7px] text-left"
              aria-label={`Select controller ${controller.index + 1} group ${g.index + 1}`}
              onClick={() =>
                onSelect({ kind: "group", controllerIndex: controller.index, groupIndex: g.index })
              }
            >
              <span className="w-3 shrink-0" aria-hidden />
              <span
                className={cn(
                  "shrink-0 rounded-[2px] px-1 py-[2px] font-mono text-[9.5px] font-semibold",
                  groupOff ? "bg-[#F2F3F4] text-[#8B979F]" : "bg-[#EAF3FB] text-hms-accent",
                )}
              >
                {GROUP_TYPE_SHORT[g.type] ?? `T${g.type}`}
              </span>
              <span className="min-w-0 flex-1 truncate">
                G{g.index + 1} · {g.description || "no description"}
              </span>
            </button>
            <StatusDot tone={groupDot} />
            <PropertySwitch
              id={`dev-g-${controller.index}-${g.index}-enabled`}
              aria-label={`Group ${g.index + 1} integrated`}
              title={g.enabled ? "Integrated — switch off to drop its registers" : "Not integrated — no signals are generated"}
              checked={g.enabled}
              onCheckedChange={(enabled) => onToggleGroup(g, enabled)}
            />
            <ImmediatePropertyError id={`dev-g-${controller.index}-${g.index}-enabled`} />
          </div>
        );
      })}
    </div>
  );
}

function StatusDot({ tone }: { tone: "green" | "red" | "amber" | "grey" }) {
  const color =
    tone === "green" ? "#008961" : tone === "red" ? "#B03A2E" : tone === "amber" ? "#D9881B" : "#C9CFD3";
  return <span aria-hidden className="size-[6px] shrink-0 rounded-full" style={{ background: color }} />;
}

/* ---------------------------------------------------------------------------
 * Detail pane
 * ------------------------------------------------------------------------- */

function DetailPane({
  view,
  selection,
  onScan,
  onAddGroups,
}: {
  view: MeMbsView;
  selection: Selection;
  onScan: (controller: MeControllerInfo) => void;
  onAddGroups: (controllerIndex: number) => void;
}) {
  const controller = view.project.me.controllers.find((c) => c.index === selection.controllerIndex);
  if (!controller) {
    return <p className="text-[13px] text-fg-muted">Select a controller or group on the left.</p>;
  }
  if (selection.kind === "group") {
    const group = controller.groups.find((g) => g.index === selection.groupIndex);
    if (group) return <GroupDetail view={view} controller={controller} group={group} />;
  }
  return <ControllerDetail view={view} controller={controller} onScan={onScan} onAddGroups={onAddGroups} />;
}

function signalsForController(signals: MeMbsSignal[], controllerIndex: number): MeMbsSignal[] {
  return signals.filter((s) => s.me.g50Index === controllerIndex);
}

function signalsForGroup(signals: MeMbsSignal[], controllerIndex: number, groupIndex: number): MeMbsSignal[] {
  return signals.filter((s) => s.me.g50Index === controllerIndex && s.me.groupIndex === groupIndex);
}

function DetailHeader({
  title,
  sub,
  pill,
  readLabel,
  readTitle,
  signalCount,
}: {
  title: string;
  sub: string;
  pill: React.ReactNode;
  /** Label for the (disabled) live-read button shown for 1:1 parity with V11. */
  readLabel: string;
  readTitle: string;
  signalCount: number;
}) {
  const router = useRouter();
  return (
    <div className="mb-[18px] flex items-start gap-[14px]">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-[9px]">
          <h2 className="font-display text-[21px] font-light text-hms-blue">{title}</h2>
          {pill}
        </div>
        <p className="mt-[3px] text-[12.5px] text-fg-muted">{sub}</p>
      </div>
      <div className="flex shrink-0 items-center gap-[9px]">
        <button
          type="button"
          disabled
          title={readTitle}
          className="flex cursor-not-allowed items-center gap-[7px] rounded-[4px] border border-border bg-white px-3 py-[7px] text-[12.5px] font-bold text-fg-subtle"
        >
          <Crosshair className="size-[14px]" aria-hidden />
          {readLabel}
        </button>
        <button
          type="button"
          onClick={() => router.push("/signals")}
          className="cursor-pointer rounded-[4px] border border-border bg-white px-3 py-[7px] text-[12.5px] font-bold text-hms-blue hover:border-hms-accent hover:text-hms-accent"
        >
          Signals ({signalCount}) →
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Controller detail
 * ------------------------------------------------------------------------- */

function ControllerDetail({
  view,
  controller,
  onScan,
  onAddGroups,
}: {
  view: MeMbsView;
  controller: MeControllerInfo;
  onScan: (controller: MeControllerInfo) => void;
  onAddGroups: (controllerIndex: number) => void;
}) {
  const { session } = useGatewaySession();
  const { me } = view.project;
  const c = controller;
  const enabledGroups = c.groups.filter((g) => g.enabled);
  const controllerSignals = signalsForController(view.project.signals, c.index);
  const integratedTotal = me.controllers.reduce(
    (acc, cc) => acc + cc.groups.filter((g) => g.enabled).length,
    0,
  );
  const typesInUse = [...new Set(enabledGroups.map((g) => g.type))];
  const secure = c.port === 443;
  const connected = session?.connected === true;

  const { form, set } = useDraftForm(`dev-cc-${c.index}`, {
    enabled: c.enabled,
    description: c.description,
    ip: c.ip,
    port: c.port,
    type: c.type,
    model: c.model as number,
    compatibility: c.compatibility as number,
    addErrorSignals: c.addErrorSignals,
  });
  const setModel = (model: number) => set("model", model);

  return (
    <>
      <DetailHeader
        title={`Centralized controller ${c.index + 1}${c.description ? ` — ${c.description}` : ""}`}
        sub={`${CONTROLLER_MODEL_LABELS[c.model] ?? `Model ${c.model}`} · ${(CONTROLLER_TYPE_LABELS[c.type] ?? `Type ${c.type}`).toLowerCase()} · ${c.ip || "—"}:${c.port} · ${enabledGroups.length} of ${GROUPS_PER_CONTROLLER} groups`}
        pill={
          !c.enabled ? (
            <Pill tone="muted">disabled</Pill>
          ) : secure ? (
            <Pill tone="ok">HTTPS · TLS</Pill>
          ) : (
            <Pill tone="muted">HTTP</Pill>
          )
        }
        readLabel={connected ? "Read status" : "Gateway offline"}
        readTitle={
          connected ? "Live reads are not available in the web app yet" : "Connect the gateway to read the controller"
        }
        signalCount={controllerSignals.length}
      />

      <GroupCard label="Controller">
        <FieldRow label="Enabled" hint="A disabled controller is not polled at all">
          <ToggleControl id={`dev-cc-${c.index}-enabled`} label="Enabled" checked={form.enabled} onToggle={(v) => set("enabled", v)} />
        </FieldRow>
        <FieldRow label="Description">
          <TextControl
            id={`dev-cc-${c.index}-desc`}
            value={form.description}
            maxLength={128}
            width={200}
            onChange={(e) => set("description", e.target.value)}
          />
        </FieldRow>
        <FieldRow label="IP address">
          <TextControl
            id={`dev-cc-${c.index}-ip`}
            value={form.ip}
            width={160}
            mono
            onChange={(e) => set("ip", e.target.value)}
          />
        </FieldRow>
        <FieldRow label="Port" hint={secure ? "HTTPS 443" : "HTTP 80"}>
          <TextControl
            id={`dev-cc-${c.index}-port`}
            type="number"
            value={form.port}
            min={1}
            max={65535}
            width={80}
            onChange={(e) => set("port", Number(e.target.value))}
          />
        </FieldRow>
        <FieldRow label="Controller type">
          <SelectControl
            id={`dev-cc-${c.index}-type`}
            value={form.type}
            onChange={(e) => set("type", Number(e.target.value))}
          >
            {Object.entries(CONTROLLER_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectControl>
        </FieldRow>
        <FieldRow label="Centralized controller model">
          <SelectControl
            id={`dev-cc-${c.index}-model`}
            value={form.model}
            onChange={(e) => setModel(Number(e.target.value))}
          >
            {ME_MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </SelectControl>
        </FieldRow>
        {form.model === CONTROLLER_MODELS.AG_150 ? (
          <FieldRow label="Old model compatibility" hint="Forced by the model">
            <NoteValue value="Old model" tone="warn" />
          </FieldRow>
        ) : (
          <FieldRow label="Old model compatibility">
            <SelectControl
              id={`dev-cc-${c.index}-compat`}
              value={form.compatibility}
              onChange={(e) => set("compatibility", Number(e.target.value))}
            >
              <option value={0}>New model</option>
              <option value={1}>Old model</option>
            </SelectControl>
          </FieldRow>
        )}
        <FieldRow label="Individual error signals" hint="Indoor and outdoor unit errors per group">
          <ToggleControl
            id={`dev-cc-${c.index}-addErrorSignals`} label="Individual error signals"
            checked={form.addErrorSignals}
            onToggle={(v) => set("addErrorSignals", v)}
          />
        </FieldRow>
      </GroupCard>

      <GroupCard label="Groups" action="Add groups" onAction={() => onAddGroups(c.index)}>
        <FieldRow label="Integrated" hint={`G1 to G${GROUPS_PER_CONTROLLER} · M-NET group numbers`}>
          <NoteValue value={`${enabledGroups.length} of ${GROUPS_PER_CONTROLLER}`} tone="mono" />
        </FieldRow>
        <FieldRow
          label="Scan groups"
          hint={
            connected
              ? "Reads every unit on this controller"
              : "Connect the gateway to scan the centralized controllers"
          }
        >
          <button
            type="button"
            disabled={!connected}
            title={connected ? undefined : "Connect the gateway to scan the centralized controllers"}
            onClick={() => onScan(c)}
            className={cn(
              "shrink-0 cursor-pointer whitespace-nowrap rounded-[4px] border px-[11px] py-[6px] text-[12px] font-bold",
              connected
                ? "border-hms-accent bg-white text-hms-accent hover:bg-[#F2F8FD]"
                : "cursor-not-allowed border-border text-fg-subtle",
            )}
          >
            Scan groups
          </button>
        </FieldRow>
        <FieldRow label="Licence" hint="Groups across both controllers">
          <NoteValue value={`${integratedTotal} of ${LICENSED_GROUPS} licensed`} tone="mono" />
        </FieldRow>
        <FieldRow label="Unit types in use">
          <NoteValue
            value={typesInUse.map((t) => GROUP_TYPE_SHORT[t] ?? `T${t}`).join(" · ") || "none"}
            tone="mono"
          />
        </FieldRow>
      </GroupCard>

      <GroupCard label="Connection" tag={secure ? "secure" : undefined}>
        <FieldRow label="Transport">
          <NoteValue
            value={secure ? "HTTPS · TLS · CA certificate validated" : "HTTP · no encryption"}
            tone={secure ? "ok" : "default"}
          />
        </FieldRow>
        <FieldRow label="Login data" hint="Never editable from the web UI">
          <NoteValue value="Configured in the centralized controller itself" />
        </FieldRow>
        <FieldRow label="Timeouts" hint="From Configuration · advanced parameters">
          <NoteValue value={`answer ${me.ansTimeout} s · connection ${me.controllerTout} s`} tone="mono" />
        </FieldRow>
      </GroupCard>

      <GroupCard label="Status" tag={connected ? "no data" : "gateway offline"}>
        <FieldRow label="Last response">
          <NoteValue value={connected ? "—" : "— connect the gateway to read live status"} />
        </FieldRow>
        <FieldRow label="Groups in error">
          <NoteValue value="—" />
        </FieldRow>
        <FieldRow label="Polling period" hint="From Configuration">
          <NoteValue value={`${me.pollPeriod} ms`} tone="mono" />
        </FieldRow>
        <FieldRow label="Signals mapped">
          <NoteValue value={String(controllerSignals.length)} tone="mono" />
        </FieldRow>
      </GroupCard>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Group detail
 * ------------------------------------------------------------------------- */

function GroupDetail({
  view,
  controller,
  group,
}: {
  view: MeMbsView;
  controller: MeControllerInfo;
  group: MeGroupInfo;
}) {
  const { session } = useGatewaySession();
  const router = useRouter();
  const g = group;
  const connected = session?.connected === true;
  const groupSignals = signalsForGroup(view.project.signals, controller.index, g.index);
  const registerBlock = (() => {
    if (groupSignals.length === 0) return "—";
    const addresses = groupSignals.map((s) => s.modbus.address);
    return `${Math.min(...addresses)} – ${Math.max(...addresses)}`;
  })();

  const { form, set, dirtyKeys } = useDraftForm(`dev-g-${controller.index}-${g.index}`, {
    enabled: g.enabled,
    description: g.description,
    type: g.type as number,
    fanSpeeds: g.fanSpeeds,
    dualSetPoint: g.dualSetPoint,
    urc: g.urc,
    capacity: g.capacity,
  });

  const caps = GROUP_CAPS[form.type] ?? GROUP_CAPS[0];
  const short = GROUP_TYPE_SHORT[form.type] ?? `T${form.type}`;
  const typeLabel = GROUP_TYPE_OPTIONS.find((t) => t.value === g.type)?.label ?? `Type ${g.type}`;
  const mbs = view.project.mbs;

  return (
    <>
      <DetailHeader
        title={`G${g.index + 1} · ${g.description || "no description"}`}
        sub={`Controller ${controller.index + 1} · ${typeLabel} · M-NET address ${String(g.index + 1).padStart(3, "0")}`}
        pill={
          !g.enabled ? (
            <Pill tone="muted">not integrated</Pill>
          ) : !controller.enabled ? (
            <Pill tone="muted">controller off</Pill>
          ) : !connected ? (
            <Pill tone="muted">offline</Pill>
          ) : (
            <Pill tone="ok">online</Pill>
          )
        }
        readLabel={connected ? "Read group" : "Gateway offline"}
        readTitle={
          connected ? "Live reads are not available in the web app yet" : "Connect the gateway to read this group"
        }
        signalCount={groupSignals.length}
      />

      <GroupCard label="Group" tag={g.enabled ? undefined : "not integrated"}>
        <FieldRow label="Integrated" hint="Generates the Modbus registers of this group">
          <ToggleControl id={`dev-g-${controller.index}-${g.index}-enabled`} label="Integrated" checked={form.enabled} onToggle={(v) => set("enabled", v)} />
        </FieldRow>
        <FieldRow label="Description">
          <TextControl
            id={`dev-g-${controller.index}-${g.index}-desc`}
            value={form.description}
            maxLength={128}
            width={200}
            onChange={(e) => set("description", e.target.value)}
          />
        </FieldRow>
        <FieldRow label="Unit type">
          <SelectControl
            id={`dev-g-${controller.index}-${g.index}-type`}
            value={form.type}
            onChange={(e) => set("type", Number(e.target.value))}
          >
            {GROUP_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </SelectControl>
        </FieldRow>
        {caps.fan || dirtyKeys.has("fanSpeeds") ? (
          <FieldRow label="Num of fan speeds" hint="0 to 4">
            <SelectControl
              id={`dev-g-${controller.index}-${g.index}-fans`}
              value={form.fanSpeeds}
              onChange={(e) => set("fanSpeeds", Number(e.target.value))}
            >
              {[0, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </SelectControl>
          </FieldRow>
        ) : (
          <FieldRow label="Num of fan speeds">
            <NoteValue value={`Not applicable to ${short} units`} />
          </FieldRow>
        )}
        {caps.sp || dirtyKeys.has("dualSetPoint") ? (
          <FieldRow label="Setpoint type">
            <SelectControl
              id={`dev-g-${controller.index}-${g.index}-setpoint`}
              value={form.dualSetPoint ? 1 : 0}
              onChange={(e) => set("dualSetPoint", Number(e.target.value) === 1)}
            >
              <option value={0}>Single Setpoint</option>
              <option value={1}>Multiple Setpoint</option>
            </SelectControl>
          </FieldRow>
        ) : (
          <FieldRow label="Setpoint type">
            <NoteValue value={`Not applicable to ${short} units`} />
          </FieldRow>
        )}
        {caps.urc || dirtyKeys.has("urc") ? (
          <FieldRow label="URC controller" hint="Universal remote control on this group">
            <SelectControl
              id={`dev-g-${controller.index}-${g.index}-urc`}
              value={form.urc ? 1 : 0}
              onChange={(e) => set("urc", Number(e.target.value) === 1)}
            >
              <option value={1}>Available</option>
              <option value={0}>Not available</option>
            </SelectControl>
          </FieldRow>
        ) : (
          <FieldRow label="URC controller">
            <NoteValue value={`Not available for ${short} units`} />
          </FieldRow>
        )}
        {(view.project.me.consumptionEnabled || dirtyKeys.has("capacity")) && (
          <FieldRow label="Capacity" hint="Nominal capacity in kW · used by the consumption function">
            <TextControl
              id={`dev-g-${controller.index}-${g.index}-capacity`}
              type="number"
              value={form.capacity}
              min={-1}
              width={80}
              onChange={(e) => set("capacity", Number(e.target.value))}
            />
          </FieldRow>
        )}
      </GroupCard>

      <GroupCard label="Live values" tag={connected ? "no data" : "gateway offline"}>
        <FieldRow label="Drive">
          <NoteValue
            value={
              !connected
                ? "— connect the gateway"
                : !controller.enabled
                  ? "— controller off"
                  : !g.enabled
                    ? "— not integrated"
                    : "—"
            }
          />
        </FieldRow>
        <FieldRow label="Mode">
          <NoteValue value="—" />
        </FieldRow>
        <FieldRow label="Setpoint">
          <NoteValue value="—" />
        </FieldRow>
        <FieldRow label="Inlet temperature">
          <NoteValue value="—" />
        </FieldRow>
        <FieldRow label="Error code">
          <NoteValue value="—" />
        </FieldRow>
      </GroupCard>

      <GroupCard
        label="Modbus registers"
        action={groupSignals.length > 0 ? "Open in signals →" : undefined}
        onAction={() => router.push("/signals")}
      >
        {groupSignals.length === 0 ? (
          <>
            <FieldRow label="Register block">
              <NoteValue value="Not generated yet — send the configuration to the gateway" tone="warn" />
            </FieldRow>
            <FieldRow label="Signals mapped">
              <NoteValue value="0" />
            </FieldRow>
            <FieldRow label="Slave addressing" hint="From BMS · Modbus server">
              <NoteValue value={mbs.slaveAddressMode === 1 ? "Multiple" : "Single"} />
            </FieldRow>
            <FieldRow label="Addresses">
              <NoteValue value={`${mbs.addressMode === 1 ? "Custom" : "Fixed"} register list`} />
            </FieldRow>
          </>
        ) : (
          <>
            <FieldRow label="Register block">
              <ReadOnly value={registerBlock} />
            </FieldRow>
            <FieldRow label="Signals mapped">
              <ReadOnly value={String(groupSignals.length)} />
            </FieldRow>
            <FieldRow label="Last response">
              <ReadOnly value="—" />
            </FieldRow>
            <FieldRow label="Errors (24 h)">
              <ReadOnly value="—" />
            </FieldRow>
          </>
        )}
      </GroupCard>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Add groups modal
 * ------------------------------------------------------------------------- */

function AddGroupsModal({
  view,
  initialControllerIndex,
  onClose,
}: {
  view: MeMbsView;
  initialControllerIndex: number;
  onClose: () => void;
}) {
  const applyPatches = usePatch();
  const saveInProgress = useSaveInProgress();
  const controllers = view.project.me.controllers;
  const [tab, setTab] = React.useState(initialControllerIndex);
  const [selected, setSelected] = React.useState<Set<number>>(new Set());

  const controller = controllers.find((c) => c.index === tab) ?? controllers[0];

  const toggleCell = (groupIndex: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(groupIndex)) next.delete(groupIndex);
      else next.add(groupIndex);
      return next;
    });

  function handleConfirm() {
    if (!controller || selected.size === 0 || saveInProgress) return;
    const patches: ProjectPatchInput[] = [...selected].map((groupIndex) => ({
      type: "updateGroup",
      controllerIndex: controller.index,
      groupIndex,
      patch: { enabled: true },
    }));
    void applyPatches(patches).then(onClose);
  }

  return (
    <Modal
      title="Add groups"
      description="Pick the M-NET group numbers to integrate. Each group becomes a block of Modbus registers when you send the configuration."
      foot="A group is an M-NET group number on the centralized controller. Unit type and description are set per group afterwards."
      ctaLabel={`Add ${selected.size} group${selected.size === 1 ? "" : "s"}`}
      ctaDisabled={selected.size === 0 || saveInProgress}
      onConfirm={handleConfirm}
      onClose={onClose}
      width={620}
    >
      <div className="mb-4 flex gap-2">
        {controllers.map((c) => {
          const count = c.groups.filter((g) => g.enabled).length;
          const active = tab === c.index;
          return (
            <button
              key={c.index}
              type="button"
              onClick={() => {
                setTab(c.index);
                setSelected(new Set());
              }}
              className={cn(
                "cursor-pointer rounded-full border px-3 py-[5px] text-[12px] font-bold",
                active
                  ? "border-hms-accent bg-[#EAF3FB] text-hms-accent"
                  : "border-border bg-white text-fg-muted",
              )}
            >
              Controller {c.index + 1} · {count}/{GROUPS_PER_CONTROLLER}
            </button>
          );
        })}
      </div>

      {controller && (
        <div className="grid grid-cols-10 gap-[6px]">
          {controller.groups.map((g) => {
            const inProject = g.enabled;
            const isSelected = selected.has(g.index);
            return (
              <button
                key={g.index}
                type="button"
                disabled={inProject}
                title={inProject ? "Already in the project" : g.description || undefined}
                onClick={() => toggleCell(g.index)}
                className={cn(
                  "rounded-[4px] border py-[7px] text-center font-mono text-[11.5px]",
                  inProject
                    ? "cursor-default border-border bg-[#F5F6F7] text-fg-subtle"
                    : isSelected
                      ? "cursor-pointer border-hms-accent bg-hms-accent text-white"
                      : "cursor-pointer border-[#C9CFD3] bg-white text-hms-blue hover:border-hms-accent",
                )}
              >
                {g.index + 1}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-[14px] flex gap-[18px] text-[11px] text-fg-muted">
        <span className="flex items-center gap-[6px]">
          <span className="size-[10px] rounded-[2px] border border-border bg-[#F5F6F7]" aria-hidden />
          In the project
        </span>
        <span className="flex items-center gap-[6px]">
          <span className="size-[10px] rounded-[2px] border border-hms-accent bg-hms-accent" aria-hidden />
          Selected
        </span>
        <span className="flex items-center gap-[6px]">
          <span className="size-[10px] rounded-[2px] border border-[#C9CFD3] bg-white" aria-hidden />
          Free
        </span>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------------------
 * Scan groups modal (M-NET bus scan via the gateway diagnostics console)
 * ------------------------------------------------------------------------- */

type ScanPhase = "ready" | "scanning" | "finished" | "failed";

const SCAN_PHASE_PILL: Record<ScanPhase, { label: string; tone: "muted" | "info" | "ok" | "err" }> = {
  ready: { label: "ready", tone: "muted" },
  scanning: { label: "scanning", tone: "info" },
  finished: { label: "scan finished", tone: "ok" },
  failed: { label: "scan failed", tone: "err" },
};

const SCAN_COLUMNS: { label: string; width?: number; flex?: boolean; right?: boolean }[] = [
  { label: "ADD", width: 40 },
  { label: "GROUP", width: 50 },
  { label: "ADDRESS", width: 70 },
  { label: "MODEL", flex: true },
  { label: "FAN SPEED", width: 78 },
  { label: "FAN AUTO", width: 70 },
  { label: "FAN EXLOW", width: 80 },
  { label: "URC", width: 92 },
  { label: "STATE", width: 86, right: true },
];

function ScanGroupsModal({
  controller,
  sessionId,
  onClose,
}: {
  controller: MeControllerInfo;
  sessionId: string;
  onClose: () => void;
}) {
  const applyPatches = usePatch();
  const saveInProgress = useSaveInProgress();
  const [phase, setPhase] = React.useState<ScanPhase>("ready");
  const [groups, setGroups] = React.useState<ScannedMeGroup[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const abortRef = React.useRef<AbortController | null>(null);

  const inProject = (group: number) => controller.groups[group - 1]?.enabled === true;
  const newCount = groups.filter((g) => !inProject(g.group)).length;

  function startScan() {
    // Secure controllers need credentials appended to the command; those are
    // never stored in the project model, so the scan is not supported.
    if (controller.model === CONTROLLER_MODELS.AE_C400E) {
      setError("Secure controllers (AE-C400E) require credentials that the web app never handles — bus scan is not supported for them");
      setPhase("failed");
      return;
    }
    const abort = new AbortController();
    abortRef.current = abort;
    setPhase("scanning");
    setError(null);
    void scanMeGroups(
      sessionId,
      { typeIndex: controller.type, ip: controller.ip, port: controller.port },
      abort.signal,
    )
      .then((result) => {
        if (abort.signal.aborted) return;
        setGroups(result.groups);
        if (result.ok) {
          // Pre-select only the groups that are not yet in the project.
          setSelected(new Set(result.groups.filter((g) => !inProject(g.group)).map((g) => g.group)));
          setPhase("finished");
        } else {
          setError(result.error ?? "Scan failed");
          setPhase("failed");
        }
      })
      .catch((scanError: unknown) => {
        if (abort.signal.aborted) return;
        setGroups([]);
        setError(scanError instanceof Error ? scanError.message : "Scan failed");
        setPhase("failed");
      });
  }

  // Stopping or closing mid-scan aborts only the client-side wait: the
  // gateway finishes the scan in the background (no STOPBUSSCAN is sent).
  function handleStop() {
    abortRef.current?.abort();
    setPhase("ready");
  }

  function handleClose() {
    abortRef.current?.abort();
    onClose();
  }

  const toggle = (group: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  function selectNewOnly() {
    setSelected(new Set(groups.filter((g) => !inProject(g.group)).map((g) => g.group)));
  }

  function handleApply() {
    if (saveInProgress) return;
    const patches: ProjectPatchInput[] = groups
      .filter((g) => selected.has(g.group))
      .map((g) => ({
        type: "updateGroup",
        controllerIndex: controller.index,
        groupIndex: g.group - 1,
        patch: { enabled: true, type: g.type, fanSpeeds: g.fanSpeeds, urc: g.urc, capacity: g.capacity },
      }));
    void applyPatches(patches).then(onClose);
  }

  const phasePill = SCAN_PHASE_PILL[phase];

  return (
    <Modal
      title="Discover controller groups"
      description={`The gateway asks centralized controller ${controller.index + 1} for every indoor and outdoor unit on the M-NET bus. Nothing changes in the project until you apply the selection.`}
      foot="Applying replaces the unit type, fan speeds and URC of the selected groups with the values read from the controller. Descriptions are not read from the controller — add them per group after applying."
      ctaLabel={`Apply ${selected.size} group${selected.size === 1 ? "" : "s"}`}
      ctaDisabled={selected.size === 0 || phase === "scanning" || saveInProgress}
      onConfirm={handleApply}
      onClose={handleClose}
      width={900}
    >
      {/* connection strip */}
      <div className="mb-3 flex flex-wrap items-end gap-[30px] rounded-[4px] border border-border bg-[#FCFCFD] px-[15px] py-3">
        <ScanField
          label="Controller"
          value={`${controller.index + 1}${controller.description ? ` — ${controller.description}` : ""}`}
        />
        <ScanField label="Type" value={CONTROLLER_TYPE_LABELS[controller.type] ?? `Type ${controller.type}`} />
        <ScanField label="IP address" value={controller.ip || "—"} />
        <ScanField label="Port" value={String(controller.port)} />
        <div className="ml-auto flex items-center gap-[9px]">
          {phase === "scanning" && (
            <button
              type="button"
              onClick={handleStop}
              className="cursor-pointer rounded-[4px] border border-[#C9CFD3] bg-white px-4 py-2 text-[12.5px] font-bold text-hms-blue"
            >
              Stop
            </button>
          )}
          <button
            type="button"
            disabled={phase === "scanning"}
            onClick={startScan}
            className={cn(
              "rounded-[4px] px-[18px] py-2 text-[12.5px] font-bold",
              phase === "scanning"
                ? "cursor-not-allowed bg-[#E7EBEE] text-fg-subtle"
                : "cursor-pointer bg-hms-accent text-white hover:bg-hms-accent-hover",
            )}
          >
            {phase === "ready" ? "Scan" : "Scan again"}
          </button>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-[9px]">
        <Pill tone={phasePill.tone}>{phasePill.label}</Pill>
        {phase === "scanning" && (
          <span className="flex items-center gap-[6px] text-[12px] text-fg-muted">
            <Loader2 className="size-[13px] animate-spin" aria-hidden />
            Reading M-NET addresses…
          </span>
        )}
      </div>

      {phase === "failed" && error && (
        <p role="alert" className="mb-3 text-[12.5px] text-error">
          {error}
        </p>
      )}
      {phase === "finished" && groups.length === 0 && (
        <p className="mb-3 text-[12.5px] text-fg-muted">No groups found on the M-NET bus.</p>
      )}

      {groups.length > 0 && (
        <>
          <div className="mb-2 flex items-center gap-[9px] text-[11.5px] text-fg-subtle">
            <span>
              {groups.length} groups · {newCount} new
            </span>
            {newCount > 0 && (
              <button
                type="button"
                onClick={selectNewOnly}
                className="cursor-pointer text-hms-accent hover:underline"
              >
                Select new only
              </button>
            )}
          </div>
          <div className="max-h-[320px] overflow-y-auto rounded-[4px] border border-border">
            <div className="flex bg-[#FCFCFD] px-3 py-[7px] font-mono text-[10px] font-semibold uppercase tracking-[0.07em] text-fg-subtle">
              {SCAN_COLUMNS.map((col) => (
                <div
                  key={col.label}
                  className={cn("shrink-0", col.right && "text-right")}
                  style={col.flex ? { flex: 1, minWidth: 120 } : { width: col.width }}
                >
                  {col.label}
                </div>
              ))}
            </div>
            {groups.map((g) => {
              const existing = inProject(g.group);
              const isSelected = selected.has(g.group);
              const cells: React.ReactNode[] = [
                <Checkbox
                  key="add"
                  aria-label={`Add group G${g.group}`}
                  checked={isSelected}
                  onChange={() => toggle(g.group)}
                  onClick={(e) => e.stopPropagation()}
                  className="h-[15px] w-[15px]"
                />,
                <span key="group" className="font-mono text-[12px]">
                  G{g.group}
                </span>,
                <span key="addr" className="truncate font-mono text-[12px]">
                  {g.addresses.join(", ") || "—"}
                </span>,
                <span key="model" className="truncate text-[12px]">
                  {g.model || "—"}
                </span>,
                <span key="fan" className="font-mono text-[12px]">
                  {g.fanSpeeds}
                </span>,
                <span key="auto" className="text-[12px]">
                  {g.fanAuto || "—"}
                </span>,
                <span key="exlow" className="text-[12px]">
                  {g.fanExlow || "—"}
                </span>,
                <span key="urc" className="text-[12px]">
                  {g.urc ? "Enabled" : "-"}
                </span>,
                <span key="state" className="text-right">
                  <Pill tone={existing ? "muted" : "info"}>{existing ? "in project" : "new"}</Pill>
                </span>,
              ];
              return (
                <div
                  key={g.group}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggle(g.group)}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                      e.preventDefault();
                      toggle(g.group);
                    }
                  }}
                  className={cn(
                    "flex cursor-pointer items-center border-b border-[#F2F3F4] px-3 py-[7px] last:border-b-0",
                    isSelected ? "bg-[#F7FBFE]" : "hover:bg-[#F7FBFE]",
                  )}
                >
                  {SCAN_COLUMNS.map((col, i) => (
                    <div
                      key={col.label}
                      className="flex min-w-0 shrink-0 items-center"
                      style={col.flex ? { flex: 1, minWidth: 120 } : { width: col.width }}
                    >
                      {cells[i]}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}

function ScanField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-[5px] text-[10px] uppercase tracking-[0.09em] text-fg-subtle">{label}</div>
      <div className="truncate font-mono text-[12.5px] text-hms-blue">{value}</div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * V11 building blocks (mirrored from configuration-screen.tsx so this screen
 * stays self-contained).
 * ------------------------------------------------------------------------- */

/** Pill used for header status, card tags and scan states (V11 `pill`). */
function Pill({ tone, children }: { tone: "ok" | "err" | "warn" | "muted" | "info"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[5px] whitespace-nowrap rounded-full border px-[7px] py-[2px] text-[11px] font-bold",
        tone === "ok" && "border-[#BFE3D4] bg-[#F1FAF6] text-[#0A6B4C]",
        tone === "err" && "border-[#E8C4C0] bg-[#FDF3F2] text-[#B03A2E]",
        tone === "warn" && "border-[#E8D3B4] bg-[#FDF6EC] text-[#8A5A12]",
        tone === "muted" && "border-border bg-[#EFF0F1] text-fg-muted",
        tone === "info" && "border-[#C9DEF0] bg-[#EAF3FB] text-hms-accent",
      )}
    >
      {children}
    </span>
  );
}

function GroupCard({
  label,
  tag,
  action,
  onAction,
  children,
}: {
  label: string;
  tag?: string;
  /** Right-side header action (V11), e.g. "Add groups". */
  action?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-[14px] overflow-hidden rounded-[8px] border border-border bg-white">
      <header className="flex items-center gap-[9px] border-b border-border bg-[#FCFCFD] px-[15px] py-[11px]">
        <h3 className="text-[12.5px] font-bold text-hms-blue">{label}</h3>
        {tag && <Pill tone={WARN_TAGS.has(tag) ? "warn" : "muted"}>{tag}</Pill>}
        <div className="flex-1" />
        {action && (
          <button
            type="button"
            onClick={onAction}
            className="cursor-pointer text-[12px] font-bold text-hms-accent hover:underline"
          >
            {action}
          </button>
        )}
      </header>
      <div className="grid grid-cols-1 gap-x-[26px] px-[15px] pb-3 pt-1 min-[1400px]:grid-cols-2">
        {children}
      </div>
    </section>
  );
}

/** One cell of the two-column card body: label + hint left, control right. */
function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-[#F2F3F4] py-[9px]">
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] text-text-body">{label}</div>
        {hint && <div className="text-[10.5px] text-fg-subtle">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function TextControl({
  id,
  value,
  onChange,
  width = 240,
  unit,
  mono,
  disabled,
  maxLength,
  type,
  min,
  max,
}: {
  id: string;
  value: string | number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  width?: number;
  unit?: string;
  mono?: boolean;
  disabled?: boolean;
  maxLength?: number;
  type?: string;
  min?: number;
  max?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type={type}
        value={value}
        disabled={disabled}
        maxLength={maxLength}
        min={min}
        max={max}
        onChange={onChange}
        style={{ width }}
        className={cn("h-auto rounded-[4px] px-[9px] py-[6px] text-[12.5px]", mono && "font-mono")}
      />
      {unit && <span className="font-mono text-[11.5px] text-fg-subtle">{unit}</span>}
    </div>
  );
}

function SelectControl({
  id,
  value,
  onChange,
  children,
}: {
  id: string;
  value: string | number;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <Select
      id={id}
      value={value}
      onChange={onChange}
      className="h-auto w-auto max-w-[190px] rounded-[4px] px-[7px] py-[5px] text-[12px]"
    >
      {children}
    </Select>
  );
}

function ToggleControl({
  id,
  label,
  checked,
  onToggle,
  disabled,
}: {
  id: string;
  label: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-[10px]">
      <PropertySwitch id={id} size="lg" checked={checked} onCheckedChange={onToggle} aria-label={label} disabled={disabled} />
      <span className="text-[12px] text-fg-muted">{checked ? "Enabled" : "Disabled"}</span>
      <ImmediatePropertyError id={id} />
    </div>
  );
}

/** Note value (V11 `fN`): prose-style value with a tone. */
function NoteValue({
  value,
  tone = "default",
}: {
  value: string;
  tone?: "default" | "warn" | "err" | "ok" | "mono";
}) {
  return (
    <div
      className={cn(
        "py-1 text-[12px] leading-[1.5]",
        tone === "err" && "text-[#B03A2E]",
        tone === "warn" && "text-[#8A5A12]",
        tone === "ok" && "text-[#0A6B4C]",
        tone === "default" && "text-fg-muted",
        tone === "mono" && "font-mono text-hms-blue",
      )}
    >
      {value}
    </div>
  );
}

/** Read-only live value (V11 `fR`). */
function ReadOnly({ value }: { value: string }) {
  return <div className="py-1 font-mono text-[12px] text-fg-muted">{value}</div>;
}
