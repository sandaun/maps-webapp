"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Search } from "lucide-react";
import type { MeControllerInfo, MeGroupInfo } from "@/protocols/me";
import { CONTROLLER_MODELS, GROUP_TYPE_LABELS } from "@/protocols/me";
import type { ScannedMeGroup } from "@/gateway-families/me-mbs/bus-scan";
import type { MeMbsSignal } from "@/gateway-families/me-mbs/model";
import { scanMeGroups } from "@/lib/gateway-api";
import { useGatewaySession } from "@/lib/gateway-session";
import type { ProjectPatchInput, ProjectView } from "@/lib/project-types";
import { usePatch } from "@/lib/current-project";
import { useSave } from "@/lib/use-save";
import { cn } from "@/lib/utils";
import { ScreenIssues } from "@/components/screens/screen-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type MeMbsView = Extract<ProjectView, { family: "me-mbs" }>;

const GROUPS_PER_CONTROLLER = 50;
const LICENSED_GROUPS = 100;

const CONTROLLER_MODEL_LABELS: Record<number, string> = {
  0: "AG-150",
  1: "EB-50GU",
  2: "AE-200",
  3: "AE-C400E",
};

const ME_MODEL_OPTIONS = [
  { value: 0, label: "AG-150A / GB-50ADA or older" },
  { value: 1, label: "EB-50GU" },
  { value: 2, label: "AE-200 / EW-50" },
  { value: 3, label: "AE-C400E / EW-C50" },
];

const GROUP_TYPE_SHORT: Record<number, string> = {
  0: "IC",
  1: "LC",
  2: "FU",
  3: "BU",
  4: "WH",
  5: "CEh",
  6: "SYS",
};

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
  const applyPatches = usePatch();
  const [selection, setSelection] = React.useState<Selection>({ kind: "controller", controllerIndex: 0 });
  const [query, setQuery] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(false);

  const controllers = view.project.me.controllers;
  const integratedCount = controllers.reduce(
    (acc, c) => acc + c.groups.filter((g) => g.enabled).length,
    0,
  );

  const toggleController = (c: MeControllerInfo, enabled: boolean) =>
    void applyPatches([{ type: "updateController", controllerIndex: c.index, patch: { enabled } }]);

  const toggleGroup = (g: MeGroupInfo, enabled: boolean) =>
    void applyPatches([
      { type: "updateGroup", controllerIndex: g.controllerIndex, groupIndex: g.index, patch: { enabled } },
    ]);

  return (
    <div className="-m-6 flex min-h-full">
      {/* ---------- device tree (V11) ---------- */}
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-border bg-white px-3 py-4">
        <div className="relative mb-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter devices"
            aria-label="Filter devices"
            className="w-full rounded-[4px] border border-border bg-[#FBFBFC] py-[7px] pl-[28px] pr-[9px] text-[12.5px] focus-visible:outline-2 focus-visible:outline-hms-accent"
          />
          <Search className="pointer-events-none absolute left-[8px] top-[9px] size-[13px] text-fg-subtle" />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {controllers.map((c) => (
            <ControllerNode
              key={c.index}
              controller={c}
              query={query}
              selection={selection}
              onSelect={setSelection}
              onToggleController={toggleController}
              onToggleGroup={toggleGroup}
            />
          ))}
          {controllers.length === 0 && (
            <p className="px-[10px] text-[12.5px] text-fg-muted">No centralized controllers in this project.</p>
          )}
        </div>

        <div className="mt-3 flex items-center gap-[9px] border-t border-border pt-3">
          <span className="flex-1 font-mono text-[11px] text-fg-subtle">
            {integratedCount} of {LICENSED_GROUPS} licensed
          </span>
          <Button size="sm" variant="secondary" className="h-8" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add groups
          </Button>
        </div>
      </aside>

      {/* ---------- detail ---------- */}
      <div className="min-w-0 flex-1">
        <div className="max-w-[900px] px-[26px] pb-10 pt-[22px]">
          <ScreenIssues issues={view.issues} screen="devices" />
          <DetailPane key={`${view.meta.updatedAt}:${selectionKey(selection)}`} view={view} selection={selection} />
        </div>
      </div>

      {addOpen && <AddGroupsModal view={view} onClose={() => setAddOpen(false)} />}
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
  onSelect,
  onToggleController,
  onToggleGroup,
}: {
  controller: MeControllerInfo;
  query: string;
  selection: Selection;
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

  return (
    <div className="mb-1">
      <div
        className={cn(
          "flex w-full items-center gap-2 rounded-[4px] px-[10px] py-2 text-left text-[12.5px]",
          selected ? "bg-[#EAF3FB] font-bold text-hms-blue" : "font-normal text-fg-muted",
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
          onClick={() => onSelect({ kind: "controller", controllerIndex: controller.index })}
        >
          <Badge variant="outline" className="shrink-0 px-[6px] py-0 font-mono text-[10px]">
            {CONTROLLER_MODEL_LABELS[controller.model] ?? `Model ${controller.model}`}
          </Badge>
          <span className="min-w-0 flex-1 truncate">
            {controller.description || `Controller ${controller.index + 1}`}
          </span>
          <span className="shrink-0 font-mono text-[10.5px] text-fg-subtle">
            {enabledGroups.length}/{GROUPS_PER_CONTROLLER}
          </span>
        </button>
        <Switch
          aria-label={`Controller ${controller.index + 1} enabled`}
          checked={controller.enabled}
          onCheckedChange={(enabled) => onToggleController(controller, enabled)}
        />
      </div>

      <div className="ml-[14px] border-l border-[#F2F3F4] pl-[6px]">
        {shownGroups.map((g) => {
          const groupSelected =
            selection.kind === "group" &&
            selection.controllerIndex === controller.index &&
            selection.groupIndex === g.index;
          return (
            <div
              key={g.index}
              className={cn(
                "flex w-full items-center gap-2 rounded-[4px] px-[10px] py-[6px] text-left text-[12px]",
                groupSelected ? "bg-[#EAF3FB] font-bold text-hms-blue" : "font-normal text-fg-muted",
              )}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                onClick={() =>
                  onSelect({ kind: "group", controllerIndex: controller.index, groupIndex: g.index })
                }
              >
                <span className="min-w-0 flex-1 truncate">
                  G{g.index + 1} · {g.description || "No description"}
                </span>
                <Badge variant="muted" className="shrink-0 px-[6px] py-0 font-mono text-[10px]">
                  {GROUP_TYPE_SHORT[g.type] ?? `T${g.type}`}
                </Badge>
              </button>
              <Switch
                aria-label={`Group ${g.index + 1} integrated`}
                checked={g.enabled}
                onCheckedChange={(enabled) => onToggleGroup(g, enabled)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Detail pane
 * ------------------------------------------------------------------------- */

function DetailPane({ view, selection }: { view: MeMbsView; selection: Selection }) {
  const controller = view.project.me.controllers.find((c) => c.index === selection.controllerIndex);
  if (!controller) {
    return <p className="text-[13px] text-fg-muted">Select a controller or group on the left.</p>;
  }
  if (selection.kind === "group") {
    const group = controller.groups.find((g) => g.index === selection.groupIndex);
    if (group) return <GroupDetail view={view} controller={controller} group={group} />;
  }
  return <ControllerDetail view={view} controller={controller} />;
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
  badge,
  signalCount,
}: {
  title: string;
  sub: string;
  badge: React.ReactNode;
  signalCount: number;
}) {
  const router = useRouter();
  return (
    <div className="mb-[22px]">
      <div className="flex flex-wrap items-center gap-[9px]">
        <h2 className="font-display text-[22px] font-normal text-hms-blue">{title}</h2>
        {badge}
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto h-8"
          onClick={() => router.push("/signals")}
        >
          Signals ({signalCount}) →
        </Button>
      </div>
      <p className="mt-1 text-[13px] text-fg-muted">{sub}</p>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Controller detail
 * ------------------------------------------------------------------------- */

function ControllerDetail({ view, controller }: { view: MeMbsView; controller: MeControllerInfo }) {
  const { save, busy, error } = useSave();
  const { session } = useGatewaySession();
  const [scanOpen, setScanOpen] = React.useState(false);
  const { me } = view.project;
  const c = controller;
  const enabledGroups = c.groups.filter((g) => g.enabled);
  const controllerSignals = signalsForController(view.project.signals, c.index);
  const integratedTotal = me.controllers.reduce(
    (acc, cc) => acc + cc.groups.filter((g) => g.enabled).length,
    0,
  );
  const typesInUse = [...new Set(enabledGroups.map((g) => g.type))];

  const [form, setForm] = React.useState({
    enabled: c.enabled,
    description: c.description,
    ip: c.ip,
    port: c.port,
    model: c.model as number,
    compatibility: c.compatibility as number,
    addErrorSignals: c.addErrorSignals,
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const dirty =
    JSON.stringify(form) !==
    JSON.stringify({
      enabled: c.enabled,
      description: c.description,
      ip: c.ip,
      port: c.port,
      model: c.model as number,
      compatibility: c.compatibility as number,
      addErrorSignals: c.addErrorSignals,
    });

  function handleSave() {
    void save([
      {
        type: "updateController",
        controllerIndex: c.index,
        patch: {
          enabled: form.enabled,
          description: form.description,
          ip: form.ip,
          port: form.port,
          model: form.model as MeControllerInfo["model"],
          compatibility: form.compatibility as MeControllerInfo["compatibility"],
          addErrorSignals: form.addErrorSignals,
        },
      },
    ]);
  }

  return (
    <>
      <DetailHeader
        title={`Centralized controller ${c.index + 1}${c.description ? ` — ${c.description}` : ""}`}
        sub={`${c.ip || "—"}:${c.port} · ${enabledGroups.length} of ${GROUPS_PER_CONTROLLER} groups`}
        badge={
          <Badge variant={c.enabled ? "success" : "muted"}>{c.enabled ? "Enabled" : "Disabled"}</Badge>
        }
        signalCount={controllerSignals.length}
      />

      <GroupCard label="Controller">
        <FieldRow label="Enabled" hint="A disabled controller is not polled at all">
          <ToggleControl label="Enabled" checked={form.enabled} onToggle={(v) => set("enabled", v)} />
        </FieldRow>
        <FieldRow label="Description" hint="Shown in the AC unit list">
          <TextControl
            id={`dev-cc-${c.index}-desc`}
            value={form.description}
            maxLength={128}
            width={300}
            onChange={(e) => set("description", e.target.value)}
          />
        </FieldRow>
        <FieldRow label="IP address" hint="HTTP/HTTPS connection from the gateway">
          <TextControl
            id={`dev-cc-${c.index}-ip`}
            value={form.ip}
            width={190}
            mono
            onChange={(e) => set("ip", e.target.value)}
          />
        </FieldRow>
        <FieldRow label="Port" hint="HTTPS 443 · HTTP 80">
          <TextControl
            id={`dev-cc-${c.index}-port`}
            type="number"
            value={form.port}
            min={1}
            max={65535}
            width={110}
            onChange={(e) => set("port", Number(e.target.value))}
          />
        </FieldRow>
        <FieldRow label="Centralized controller model">
          <SelectControl
            id={`dev-cc-${c.index}-model`}
            value={form.model}
            onChange={(e) => set("model", Number(e.target.value))}
          >
            {ME_MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </SelectControl>
        </FieldRow>
        <FieldRow label="Old model compatibility" hint="Protocol revision expected by the controller">
          <SelectControl
            id={`dev-cc-${c.index}-compat`}
            value={form.compatibility}
            onChange={(e) => set("compatibility", Number(e.target.value))}
          >
            <option value={0}>New model</option>
            <option value={1}>Old model</option>
          </SelectControl>
        </FieldRow>
        <FieldRow label="Individual error signals" hint="Indoor and outdoor unit errors per group">
          <ToggleControl
            label="Individual error signals"
            checked={form.addErrorSignals}
            onToggle={(v) => set("addErrorSignals", v)}
          />
        </FieldRow>
        <SaveRow dirty={dirty} busy={busy} error={error} onSave={handleSave} />
      </GroupCard>

      <GroupCard label="Groups" tag={`${enabledGroups.length} of ${GROUPS_PER_CONTROLLER}`} tagTone="info">
        <FieldRow label="Integrated" hint="Groups integrated from this controller into the project list">
          <ReadOnly value={`${enabledGroups.length} of ${GROUPS_PER_CONTROLLER} · ${controllerSignals.length} signals mapped`} />
        </FieldRow>
        <FieldRow
          label="Scan groups"
          hint={
            session?.connected
              ? "Read the M-NET groups from this controller via the gateway"
              : "Connect the gateway to scan the centralized controllers"
          }
        >
          <Button
            size="sm"
            variant="secondary"
            className="h-8"
            disabled={!session?.connected}
            onClick={() => setScanOpen(true)}
          >
            Scan groups
          </Button>
        </FieldRow>
        <FieldRow label="Licence" hint="Groups licensed across both controllers">
          <ReadOnly value={`${integratedTotal} of ${LICENSED_GROUPS} licensed`} />
        </FieldRow>
        <FieldRow label="Unit types in use">
          {typesInUse.length === 0 ? (
            <ReadOnly value="—" />
          ) : (
            <div className="flex flex-wrap gap-1.5 py-[6px]">
              {typesInUse.map((t) => (
                <Badge key={t} variant="muted">
                  {GROUP_TYPE_LABELS[t] ?? `Type ${t}`}
                </Badge>
              ))}
            </div>
          )}
        </FieldRow>
      </GroupCard>

      <GroupCard label="Connection">
        <FieldRow label="Transport">
          <ReadOnly value={c.port === 443 ? "HTTPS · TLS" : "HTTP · no encryption"} />
        </FieldRow>
        <FieldRow label="Login data" hint="Credentials are stored on the gateway">
          <ReadOnly value="Never editable from the web UI" />
        </FieldRow>
        <FieldRow label="Timeouts" hint="Answer timeout · controller timeout">
          <ReadOnly value={`${me.ansTimeout} s · ${me.controllerTout} s`} />
        </FieldRow>
      </GroupCard>

      <GroupCard label="Status" tag="no live data">
        <FieldRow label="Polling period" hint="For the whole installation">
          <ReadOnly value={`${me.pollPeriod} ms`} />
        </FieldRow>
        <FieldRow label="Signals mapped">
          <ReadOnly value={String(controllerSignals.length)} />
        </FieldRow>
        <FieldRow label="Controller status">
          <ReadOnly value="—" />
        </FieldRow>
        <FieldRow label="Last poll">
          <ReadOnly value="—" />
        </FieldRow>
      </GroupCard>

      {scanOpen && session?.connected && (
        <ScanGroupsModal controller={c} sessionId={session.id} onClose={() => setScanOpen(false)} />
      )}
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
  const { save, busy, error } = useSave();
  const g = group;
  const groupSignals = signalsForGroup(view.project.signals, controller.index, g.index);
  const registerBlock = (() => {
    if (groupSignals.length === 0) return "—";
    const addresses = groupSignals.map((s) => s.modbus.address);
    return `${Math.min(...addresses)} – ${Math.max(...addresses)}`;
  })();

  const [form, setForm] = React.useState({
    enabled: g.enabled,
    description: g.description,
    type: g.type as number,
    fanSpeeds: g.fanSpeeds,
    dualSetPoint: g.dualSetPoint,
    urc: g.urc,
    capacity: g.capacity,
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const dirty =
    JSON.stringify(form) !==
    JSON.stringify({
      enabled: g.enabled,
      description: g.description,
      type: g.type as number,
      fanSpeeds: g.fanSpeeds,
      dualSetPoint: g.dualSetPoint,
      urc: g.urc,
      capacity: g.capacity,
    });

  function handleSave() {
    void save([
      {
        type: "updateGroup",
        controllerIndex: controller.index,
        groupIndex: g.index,
        patch: {
          enabled: form.enabled,
          description: form.description,
          type: form.type as MeGroupInfo["type"],
          fanSpeeds: form.fanSpeeds,
          dualSetPoint: form.dualSetPoint,
          urc: form.urc,
          capacity: form.capacity,
        },
      },
    ]);
  }

  return (
    <>
      <DetailHeader
        title={`G${g.index + 1} · ${g.description || "No description"}`}
        sub={`Controller ${controller.index + 1} · ${GROUP_TYPE_LABELS[g.type] ?? `Type ${g.type}`} · M-NET address ${g.index + 1}`}
        badge={
          <Badge variant={g.enabled ? "success" : "muted"}>
            {g.enabled ? "integrated" : "not integrated"}
          </Badge>
        }
        signalCount={groupSignals.length}
      />

      <GroupCard label="Group">
        <FieldRow label="Integrated" hint="Generates the Modbus registers of this group">
          <ToggleControl label="Integrated" checked={form.enabled} onToggle={(v) => set("enabled", v)} />
        </FieldRow>
        <FieldRow label="Description" hint="Shown in the AC unit list">
          <TextControl
            id={`dev-g-${controller.index}-${g.index}-desc`}
            value={form.description}
            maxLength={128}
            width={300}
            onChange={(e) => set("description", e.target.value)}
          />
        </FieldRow>
        <FieldRow label="Unit type">
          <SelectControl
            id={`dev-g-${controller.index}-${g.index}-type`}
            value={form.type}
            onChange={(e) => set("type", Number(e.target.value))}
          >
            {Object.entries(GROUP_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectControl>
        </FieldRow>
        <FieldRow label="Num of fan speeds">
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
        <FieldRow label="Setpoint type" hint="Single setpoint or separate cooling/heating setpoints">
          <SelectControl
            id={`dev-g-${controller.index}-${g.index}-setpoint`}
            value={form.dualSetPoint ? 1 : 0}
            onChange={(e) => set("dualSetPoint", Number(e.target.value) === 1)}
          >
            <option value={0}>Single</option>
            <option value={1}>Multiple</option>
          </SelectControl>
        </FieldRow>
        <FieldRow label="URC controller" hint="Remote controller with humidity/brightness/occupancy sensors">
          <SelectControl
            id={`dev-g-${controller.index}-${g.index}-urc`}
            value={form.urc ? 1 : 0}
            onChange={(e) => set("urc", Number(e.target.value) === 1)}
          >
            <option value={0}>Not available</option>
            <option value={1}>Available</option>
          </SelectControl>
        </FieldRow>
        {view.project.me.consumptionEnabled && (
          <FieldRow label="Capacity" hint="Used by the consumption function · -1 = unknown">
            <TextControl
              id={`dev-g-${controller.index}-${g.index}-capacity`}
              type="number"
              value={form.capacity}
              min={-1}
              width={110}
              unit="kW"
              onChange={(e) => set("capacity", Number(e.target.value))}
            />
          </FieldRow>
        )}
        <SaveRow dirty={dirty} busy={busy} error={error} onSave={handleSave} />
      </GroupCard>

      <GroupCard label="Modbus registers">
        <FieldRow label="Signals mapped" hint="Signals that reference this group">
          <ReadOnly value={String(groupSignals.length)} />
        </FieldRow>
        <FieldRow label="Register block">
          <ReadOnly value={registerBlock} />
        </FieldRow>
      </GroupCard>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Add groups modal
 * ------------------------------------------------------------------------- */

function AddGroupsModal({ view, onClose }: { view: MeMbsView; onClose: () => void }) {
  const applyPatches = usePatch();
  const controllers = view.project.me.controllers;
  const [tab, setTab] = React.useState(controllers[0]?.index ?? 0);
  const [selected, setSelected] = React.useState<Set<number>>(new Set());

  const controller = controllers.find((c) => c.index === tab);

  const toggleCell = (groupIndex: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(groupIndex)) next.delete(groupIndex);
      else next.add(groupIndex);
      return next;
    });

  function handleConfirm() {
    if (!controller || selected.size === 0) return;
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
      ctaDisabled={selected.size === 0}
      onConfirm={handleConfirm}
      onClose={onClose}
      width={560}
    >
      <div className="mb-3 flex gap-[2px]">
        {controllers.map((c) => {
          const count = c.groups.filter((g) => g.enabled).length;
          return (
            <button
              key={c.index}
              type="button"
              onClick={() => {
                setTab(c.index);
                setSelected(new Set());
              }}
              className={cn(
                "cursor-pointer rounded-[4px] px-[10px] py-[6px] text-[12px]",
                tab === c.index ? "bg-[#EAF3FB] font-bold text-hms-blue" : "font-normal text-fg-muted",
              )}
            >
              Controller {c.index + 1} · {count}/{GROUPS_PER_CONTROLLER}
            </button>
          );
        })}
      </div>

      {controller && (
        <div className="grid grid-cols-10 gap-[4px]">
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
                  "rounded-[4px] border py-[5px] font-mono text-[11px]",
                  inProject
                    ? "cursor-default border-transparent bg-hms-muted text-fg-subtle"
                    : isSelected
                      ? "cursor-pointer border-hms-accent bg-hms-accent text-white"
                      : "cursor-pointer border-border bg-white text-text-body hover:border-hms-accent",
                )}
              >
                {g.index + 1}
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------------------------
 * Scan groups modal (M-NET bus scan via the gateway diagnostics console)
 * ------------------------------------------------------------------------- */

/** Desktop `GetControllerTypeString` (frmDiscoverMe.cs). */
const CONTROLLER_TYPE_LABELS: Record<number, string> = {
  0: "Controller Direct Connection",
  1: "Expansion Controller 1",
  2: "Expansion Controller 2",
  3: "Expansion Controller 3",
};

type ScanPhase = "ready" | "scanning" | "finished" | "failed";

const SCAN_PHASE_BADGE: Record<ScanPhase, { label: string; variant: "muted" | "default" | "success" | "error" }> = {
  ready: { label: "ready", variant: "muted" },
  scanning: { label: "scanning", variant: "default" },
  finished: { label: "scan finished", variant: "success" },
  failed: { label: "scan failed", variant: "error" },
};

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

  // Cancelling mid-scan aborts only the client-side wait: the gateway finishes
  // the scan in the background (no STOPBUSSCAN is sent).
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

  const phaseBadge = SCAN_PHASE_BADGE[phase];

  return (
    <Modal
      title={`Scan groups — Controller ${controller.index + 1}`}
      description={`The gateway asks centralized controller ${controller.index + 1} for every indoor and outdoor unit on the M-NET bus. Nothing changes in the project until you apply the selection.`}
      foot="Applying replaces the unit type, fan speeds and URC of the selected groups with the values read from the controller. Descriptions are not read from the controller — add them per group after applying."
      ctaLabel={`Apply ${selected.size} group${selected.size === 1 ? "" : "s"}`}
      ctaDisabled={selected.size === 0 || phase === "scanning"}
      onConfirm={handleApply}
      onClose={handleClose}
      width={760}
    >
      <div className="mb-3 grid grid-cols-4 gap-[9px] rounded-[4px] border border-border bg-[#FBFBFC] px-3 py-[10px]">
        <ScanField
          label="Controller"
          value={`${controller.index + 1}${controller.description ? ` — ${controller.description}` : ""}`}
        />
        <ScanField label="Type" value={CONTROLLER_TYPE_LABELS[controller.type] ?? `Type ${controller.type}`} />
        <ScanField label="IP address" value={controller.ip || "—"} mono />
        <ScanField label="Port" value={String(controller.port)} mono />
      </div>

      <div className="mb-3 flex items-center gap-[9px]">
        <Badge variant={phaseBadge.variant}>{phaseBadge.label}</Badge>
        {phase === "scanning" && (
          <span className="flex items-center gap-[6px] text-[12px] text-fg-muted">
            <Loader2 className="size-[13px] animate-spin" aria-hidden />
            Reading M-NET addresses…
          </span>
        )}
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto h-8"
          disabled={phase === "scanning"}
          onClick={startScan}
        >
          {phase === "ready" ? "Scan" : "Scan again"}
        </Button>
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[36px]">Add</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Fan speed</TableHead>
                  <TableHead>Fan auto</TableHead>
                  <TableHead>Fan exlow</TableHead>
                  <TableHead>URC</TableHead>
                  <TableHead>State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => {
                  const existing = inProject(g.group);
                  return (
                    <TableRow key={g.group}>
                      <TableCell>
                        <Checkbox
                          aria-label={`Add group G${g.group}`}
                          checked={selected.has(g.group)}
                          onChange={() => toggle(g.group)}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-[12px]">G{g.group}</TableCell>
                      <TableCell className="font-mono text-[12px]">{g.addresses.join(", ") || "—"}</TableCell>
                      <TableCell className="text-[12px]">{g.model || "—"}</TableCell>
                      <TableCell className="font-mono text-[12px]">{g.fanSpeeds}</TableCell>
                      <TableCell className="text-[12px]">{g.fanAuto || "—"}</TableCell>
                      <TableCell className="text-[12px]">{g.fanExlow || "—"}</TableCell>
                      <TableCell className="text-[12px]">{g.urc ? "Enabled" : "-"}</TableCell>
                      <TableCell>
                        <Badge variant={existing ? "success" : "outline"} className="px-[6px] py-0 text-[10px]">
                          {existing ? "in project" : "new"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </Modal>
  );
}

function ScanField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-bold uppercase tracking-wider text-fg-subtle">{label}</div>
      <div className={cn("mt-[2px] truncate text-[12.5px] text-text-body", mono && "font-mono")}>{value}</div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * V10 building blocks (mirrored from configuration-screen.tsx so this screen
 * stays self-contained).
 * ------------------------------------------------------------------------- */

function GroupCard({
  label,
  tag,
  tagTone = "warning",
  children,
}: {
  label: string;
  tag?: string;
  tagTone?: "warning" | "info";
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4 overflow-hidden rounded-lg border border-border bg-white">
      <header className="flex items-center gap-[9px] border-b border-border bg-[#FCFCFD] px-4 py-3">
        <h3 className="text-[13px] font-bold text-hms-blue">{label}</h3>
        {tag && (
          <span
            className={cn(
              "inline-flex items-center whitespace-nowrap rounded-full border px-[7px] py-[2px] text-[11px] font-bold",
              tagTone === "warning"
                ? "border-warning-border bg-warning-bg text-warning-text"
                : "border-[#C9DEF0] bg-[#EAF3FB] text-hms-accent",
            )}
          >
            {tag}
          </span>
        )}
      </header>
      <div className="px-4 pb-[14px] pt-[6px]">{children}</div>
    </section>
  );
}

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
    <div className="flex items-start gap-4 border-b border-[#F2F3F4] py-[11px] last:border-b-0">
      <div className="w-[210px] shrink-0 pt-[5px]">
        <div className="text-[12.5px] font-bold text-text-body">{label}</div>
        {hint && <div className="mt-[2px] text-[11px] leading-[1.45] text-fg-subtle">{hint}</div>}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
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
      className="h-auto w-auto min-w-[220px] rounded-[4px] px-[9px] py-[6px] text-[12.5px]"
    >
      {children}
    </Select>
  );
}

function ToggleControl({
  label,
  checked,
  onToggle,
  disabled,
}: {
  label: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-[10px] py-[3px]">
      <Switch checked={checked} onCheckedChange={onToggle} aria-label={label} disabled={disabled} />
      <span className="text-[12px] text-fg-muted">{checked ? "Enabled" : "Disabled"}</span>
    </div>
  );
}

function ReadOnly({ value }: { value: string }) {
  return <div className="py-[6px] font-mono text-[12.5px] text-hms-blue">{value}</div>;
}

function SaveRow({
  dirty,
  busy,
  error,
  onSave,
}: {
  dirty: boolean;
  busy: boolean;
  error: string | null;
  onSave: () => void;
}) {
  return (
    <div className="flex items-center gap-3 pt-3">
      <Button size="sm" disabled={!dirty || busy} onClick={onSave}>
        Save
      </Button>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
