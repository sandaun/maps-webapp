"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatGroupAddress, parseGroupAddress } from "@/protocols/knx";
import { planAddSignals, signalDeviceOptions, type AddSignalsOptions, type AddSignalsProject } from "@/core/signals/add-signals";
import type { ProjectPatchInput, ProjectView } from "@/lib/project-types";
import { useCurrentProject } from "@/lib/current-project";
import { useWorkspaceChrome } from "@/lib/workspace-chrome";

export function AddSignalsControl({ project, selected, applyPatches, onAdded }: {
  project: AddSignalsProject;
  selected: Set<number>;
  applyPatches: (patches: ProjectPatchInput[]) => Promise<ProjectView>;
  onAdded: (index: number, id: number) => void;
}) {
  const chrome = useWorkspaceChrome();
  const { mutating } = useCurrentProject();
  const pending = React.useRef(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [dialog, setDialog] = React.useState<AddSignalsOptions | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const devices = signalDeviceOptions(project);
  const master = "mbm" in project;
  const selectedSignal = [...project.signals].reverse().find((s) => selected.has(s.id));
  const selectedModbus = master && selectedSignal ? selectedSignal.modbus as Extract<AddSignalsProject, { mbm: unknown }>["signals"][number]["modbus"] : undefined;
  const selectionDevices = new Set(project.signals.filter((s) => selected.has(s.id)).map((s) => {
    const m = s.modbus as Extract<AddSignalsProject, { mbm: unknown }>["signals"][number]["modbus"];
    return `${m.port}:${m.deviceIndex}`;
  }));
  const suggestedDevice = selectionDevices.size === 1 && selectedModbus && devices.find((d) => d.port === selectedModbus.port && d.deviceIndex === selectedModbus.deviceIndex) || (devices.length === 1 ? devices[0] : undefined);
  const defaults = (): AddSignalsOptions => ({ count: 1, ...(suggestedDevice ? { device: { port: suggestedDevice.port, deviceIndex: suggestedDevice.deviceIndex } } : {}) });
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  async function add(options: AddSignalsOptions) {
    if (busy || mutating || pending.current) return;
    setError(null);
    let plan: ReturnType<typeof planAddSignals>;
    try { plan = planAddSignals(project, options); }
    catch (e) { setError((e as Error).message); return; }
    pending.current = true;
    setBusy(true);
    try {
      const next = await applyPatches([{ type: "addSignals", options }]);
      const added = next.project.signals.slice(plan.insertIndex, plan.insertIndex + options.count);
      chrome.bumpDirty(options.count);
      chrome.pushUndo({ label: options.count === 1 ? "Add signal" : `Add ${options.count} signals`,
        patches: added.map((s) => ({ type: "removeSignal", id: s.id })) });
      setDialog(null);
      triggerRef.current?.focus();
      if (added[0]) onAdded(plan.insertIndex, added[0].id);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add signals."); }
    finally { pending.current = false; setBusy(false); }
  }

  return <>
    <div className="flex rounded-[4px] border border-border text-[12.5px] font-medium text-hms-blue">
      <button ref={triggerRef} type="button" disabled={busy || mutating} className="rounded-l-[3px] px-[11px] py-[7px] hover:bg-[#EAF3FB] disabled:opacity-50"
        onClick={() => {
          setError(null);
          if (master && !suggestedDevice) setDialog(defaults());
          else void add(defaults());
        }}>{busy ? "Adding…" : "+ Add signal"}</button>
      <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Popover.Trigger asChild><button type="button" disabled={busy || mutating} aria-label="More signal actions" className="border-l border-border px-1.5 hover:bg-[#EAF3FB] disabled:opacity-50"><ChevronDown size={14} /></button></Popover.Trigger>
        <Popover.Portal><Popover.Content align="end" sideOffset={4} className="z-50 rounded-md border border-border bg-white p-1 shadow-lg">
          <button type="button" className="rounded px-3 py-2 text-[12.5px] text-hms-blue hover:bg-[#EAF3FB]" onClick={() => { setMenuOpen(false); setError(null); setDialog(defaults()); }}>Add multiple signals…</button>
        </Popover.Content></Popover.Portal>
      </Popover.Root>
    </div>
    {error && !dialog && <span role="alert" className="max-w-xs text-xs text-error">{error}</span>}
    {dialog && <AddSignalsDialog project={project} initial={dialog} afterId={selectedSignal?.id} busy={busy} error={error}
      onClose={() => { if (!busy) { setDialog(null); setError(null); triggerRef.current?.focus(); } }} onApply={add} />}
  </>;
}

function AddSignalsDialog({ project, initial, afterId, busy, error, onClose, onApply }: {
  project: AddSignalsProject; initial: AddSignalsOptions; afterId?: number; busy: boolean; error: string | null;
  onClose: () => void; onApply: (options: AddSignalsOptions) => Promise<void>;
}) {
  const [count, setCount] = React.useState(String(initial.count));
  const [position, setPosition] = React.useState("end");
  const [deviceKey, setDeviceKey] = React.useState(initial.device ? `${initial.device.port}:${initial.device.deviceIndex}` : "");
  const [profile, setProfile] = React.useState<NonNullable<AddSignalsOptions["profile"]>>("mbm" in project ? "maps" : "unsigned16");
  const [active, setActive] = React.useState("mbm" in project);
  const [ga, setGa] = React.useState("");
  const [address, setAddress] = React.useState("");
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const countRef = React.useRef<HTMLInputElement>(null);
  const devices = signalDeviceOptions(project);
  const options: AddSignalsOptions = { count: Number(count), profile, active,
    ...(position === "after" && afterId !== undefined ? { afterId } : {}),
    ...(deviceKey ? { device: { port: Number(deviceKey.split(":")[0]), deviceIndex: Number(deviceKey.split(":")[1]) } } : {}),
    ...(ga.trim() ? { groupAddress: parseGroupAddress(ga) ?? NaN } : {}),
    ...(address.trim() ? { address: Number(address) } : {}),
  };
  let plan: ReturnType<typeof planAddSignals> | undefined;
  let planError: string | undefined;
  try { plan = planAddSignals(project, options); }
  catch (e) { planError = (e as Error).message; }
  React.useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    countRef.current?.focus();
    return () => previous?.focus();
  }, []);
  const first = plan?.entries[0];
  const last = plan?.entries.at(-1);

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-hms-blue/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="add-signals-title" className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-lg border border-border bg-white p-5 shadow-lg"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); onClose(); }
        if (e.key === "Tab") {
          const elements = [...dialogRef.current!.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), summary')];
          const firstEl = elements[0], lastEl = elements.at(-1);
          if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl?.focus(); }
          else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl?.focus(); }
        }
      }}>
      <h2 id="add-signals-title" className="font-display text-base font-medium text-hms-blue">Add signals</h2>
      <p className="mt-1 text-xs text-fg-muted">Create signals with consecutive available addresses.</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="text-xs font-medium text-text-body">Quantity<Input ref={countRef} aria-label="Quantity" type="number" min={1} max={500} value={count} disabled={busy} onChange={(e) => setCount(e.target.value)} className="mt-1" /></label>
        <label className="text-xs font-medium text-text-body">Position<Select aria-label="Position" value={position} disabled={busy} onValueChange={setPosition} className="mt-1" options={[{ value: "end", label: "At the end" }, ...(afterId === undefined ? [] : [{ value: "after", label: `After signal ${afterId}` }])]} /></label>
        {"mbm" in project && <label className="col-span-2 text-xs font-medium text-text-body">Modbus device<Select aria-label="Modbus device" disabled={busy} value={deviceKey} onValueChange={setDeviceKey} className="mt-1" options={devices.map((d) => ({ value: `${d.port}:${d.deviceIndex}`, label: d.label }))} /></label>}
        <label className="col-span-2 text-xs font-medium text-text-body">Signal type<Select aria-label="Signal type" disabled={busy} value={profile} onValueChange={(v) => setProfile(v as typeof profile)} className="mt-1" options={[
          ...("mbm" in project ? [{ value: "maps", label: "MAPS switch · DPT 1.001 · 16-bit register" }] : []),
          { value: "unsigned16", label: "Unsigned 16-bit · DPT 7.x" },
          { value: "unsigned32", label: "Unsigned 32-bit · DPT 12.x · 2 registers" },
        ]} /></label>
      </div>
      <label className="mt-3 flex items-center gap-2 text-xs text-text-body"><input type="checkbox" checked={active} disabled={busy} onChange={(e) => setActive(e.target.checked)} />Enable new signals</label>
      <details className="mt-3 text-xs text-text-body"><summary className="cursor-pointer font-medium">Starting addresses</summary>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <label>KNX group address<Input aria-label="Starting KNX address" value={ga} disabled={busy} placeholder={first ? formatGroupAddress(first.groupAddress) : "Automatic"} onChange={(e) => setGa(e.target.value)} className="mt-1" /></label>
          <label>Modbus register<Input aria-label="Starting Modbus register" type="number" value={address} disabled={busy} placeholder={first ? String(first.address) : "Automatic"} onChange={(e) => setAddress(e.target.value)} className="mt-1" /></label>
        </div>
      </details>
      {first && last && <div role="status" className="mt-4 rounded-md bg-[#F5FAFE] p-3 text-xs text-hms-blue">
        <p>{plan!.entries.length} signal{plan!.entries.length === 1 ? "" : "s"} · {active ? "Enabled" : "Disabled"}</p>
        <p className="mt-1">KNX: {formatGroupAddress(first.groupAddress)} → {formatGroupAddress(last.groupAddress)}</p>
        <p className="mt-1">Modbus registers: {first.address} → {last.address + last.lenBits / 16 - 1}</p>
      </div>}
      {(planError || error) && <p role="alert" className="mt-3 text-xs text-error">{planError || error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" disabled={busy} className="rounded border border-border px-3 py-2 text-xs text-hms-blue" onClick={onClose}>Cancel</button>
        <button type="button" disabled={busy || !plan} className="rounded bg-hms-blue px-3 py-2 text-xs text-white disabled:opacity-50" onClick={() => void onApply(options)}>{busy ? "Adding…" : `Add ${count} signal${Number(count) === 1 ? "" : "s"}`}</button>
      </div>
    </div>
  </div>;
}
