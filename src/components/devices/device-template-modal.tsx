"use client";

import * as React from "react";
import { Download, FileUp, Library } from "lucide-react";
import type { DeviceTemplateMetadata, DeviceTemplatePreview, TemplateLibrary } from "@/core/device-templates/types";
import { MAX_ACTIVE_SIGNALS, MAX_MODBUS_DEVICES, MAX_TOTAL_SIGNAL_ROWS } from "@/core/signals/model";
import type { NodeLocator } from "@/lib/project-types";
import { request } from "@/lib/api";
import { downloadDeviceTemplate } from "@/lib/device-templates";
import { useCurrentProject } from "@/lib/current-project";
import { useSave } from "@/lib/use-save";
import { useWorkspaceChrome } from "@/lib/workspace-chrome";
import { formatDpt, formatGroupAddressAtLevel } from "@/protocols/knx";
import { BYTE_ORDER_LABELS, FORMAT_LABELS } from "@/protocols/modbus/master";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Radio } from "@/components/ui/radio";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select } from "@/components/ui/select";

const PAGE_SIZE = 50;

function TemplateMetadata({ metadata }: { metadata: DeviceTemplateMetadata }) {
  return <dl className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
    <div><dt className="text-fg-muted">Template version</dt><dd className="mt-0.5 font-medium">{metadata.version}</dd></div>
    <div><dt className="text-fg-muted">MAPS version</dt><dd className="mt-0.5 font-medium">{metadata.mapsVersion}</dd></div>
    <div><dt className="text-fg-muted">Signature</dt><dd className="mt-0.5 font-medium">{metadata.signed === true ? `Signed by ${metadata.author}` : metadata.signed === false ? "Unsigned" : `Unknown${metadata.authorCode === null ? "" : ` · ${metadata.author}`}`}</dd></div>
  </dl>;
}

export function DeviceTemplateModal({ initialLocator, onClose }: { initialLocator: NodeLocator; onClose: () => void }) {
  const { view, projectId, mutating } = useCurrentProject();
  const { save, busy: saving, error: saveError } = useSave();
  const { pushUndo } = useWorkspaceChrome();
  const [preview, setPreview] = React.useState<DeviceTemplatePreview | null>(null);
  const [enabled, setEnabled] = React.useState<Set<number>>(new Set());
  const [includeDisabled, setIncludeDisabled] = React.useState(false);
  const [name, setName] = React.useState("");
  const [locator, setLocator] = React.useState(initialLocator);
  const [slave, setSlave] = React.useState(1);
  const [page, setPage] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = React.useState(false);
  const [library, setLibrary] = React.useState<TemplateLibrary | null>(null);
  const [manufacturer, setManufacturer] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [selectedId, setSelectedId] = React.useState("");
  const [details, setDetails] = React.useState<{ id: string; metadata?: DeviceTemplateMetadata; error?: string } | null>(null);
  const [detailsRetry, setDetailsRetry] = React.useState(0);
  const [metadataCache, setMetadataCache] = React.useState<Record<string, DeviceTemplateMetadata>>({});
  const fileInput = React.useRef<HTMLInputElement>(null);
  const project = view?.family === "knx-mbm" ? view.project : null;
  const nodes = project ? [
    ...project.mbm.rtuNodes.map((n, nodeIndex) => ({ locator: { kind: "rtu" as const, nodeIndex }, label: `RTU ${nodeIndex + 1} · Port ${n.physicalPort === 0 ? "A" : "B"}`, devices: n.devices })),
    ...project.mbm.tcpNodes.map((n, nodeIndex) => ({ locator: { kind: "tcp" as const, nodeIndex }, label: `TCP ${nodeIndex + 1} · ${n.description || n.ip}`, devices: n.devices })),
  ] : [];
  const node = nodes.find((n) => n.locator.kind === locator.kind && n.locator.nodeIndex === locator.nodeIndex);
  const busy = loading || saving || !!mutating;
  const selectedEntry = library?.entries.find((entry) => entry.id === selectedId);
  const selectedDetails = details?.id === selectedId ? details : null;
  const selectedMetadata = metadataCache[selectedId] ?? selectedDetails?.metadata;

  React.useEffect(() => {
    if (!libraryOpen || !selectedId || metadataCache[selectedId]) return;
    let current = true;
    void request<DeviceTemplateMetadata>(`/api/modbus-templates/${encodeURIComponent(selectedId)}/metadata`)
      .then((metadata) => {
        if (!current) return;
        setMetadataCache((cache) => ({ ...cache, [selectedId]: metadata }));
        setDetails({ id: selectedId, metadata });
      })
      .catch((err) => {
        if (current) setDetails({ id: selectedId, error: err instanceof Error ? err.message : "Could not read template details." });
      });
    return () => { current = false; };
  }, [libraryOpen, selectedId, detailsRetry, metadataCache]);
  const entries = library?.entries.filter((entry) =>
    (!manufacturer || entry.manufacturer === manufacturer) &&
    `${entry.manufacturer} ${entry.model} ${entry.modelVersion}`.toLowerCase().includes(search.toLowerCase()),
  ) ?? [];
  const stale = !!preview && preview.revision !== (view?.meta.revision ?? 0);
  const includedCount = preview ? (includeDisabled ? preview.signals.length : enabled.size) : 0;
  const existingActive = project?.signals.filter((s) => s.active).length ?? 0;
  const problem = stale ? "The project changed. Load the template again before importing." :
    !node ? "Choose an existing connection." :
    !name.trim() ? "Enter a device name." :
    node.devices.some((d) => d.name === name.trim()) ? "A device with this name already exists on this connection." :
    !Number.isInteger(slave) || slave < (locator.kind === "rtu" ? 1 : 0) || slave > (locator.kind === "rtu" ? 254 : 255) ? "Slave number is outside the connection range." :
    node.devices.some((d) => d.slave === slave) ? "Slave number is already used on this connection." :
    nodes.reduce((n,node) => n + node.devices.length,0) >= MAX_MODBUS_DEVICES ? "The project device limit has been reached." :
    includedCount === 0 ? "Activate an object or include disabled objects." :
    existingActive + enabled.size + 1 > MAX_ACTIVE_SIGNALS || (project?.signals.length ?? 0) + includedCount + 1 > MAX_TOTAL_SIGNAL_ROWS ? "Selected objects exceed the project signal capacity." : null;

  function freeSlave(target: typeof node) {
    let next = 1;
    while (target?.devices.some((d) => d.slave === next)) next++;
    return next;
  }

  async function loadPreview(form: FormData) {
    if (!projectId || busy) return;
    setLoading(true); setError(null);
    try {
      const next = await request<DeviceTemplatePreview>(`/api/projects/${encodeURIComponent(projectId)}/device-templates/preview`, { method: "POST", body: form });
      setPreview(next); setEnabled(new Set(next.signals.filter((s) => s.active).map((s) => s.id)));
      setName(next.device.name); setSlave(freeSlave(node)); setPage(0); setLibraryOpen(false);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not read template."); }
    finally { setLoading(false); }
  }

  async function openLibrary() {
    setLibraryOpen(true); setError(null);
    if (library) return;
    setLoading(true);
    try { setLibrary(await request<TemplateLibrary>("/api/modbus-templates")); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not load the library."); }
    finally { setLoading(false); }
  }

  async function downloadSelected() {
    if (!selectedEntry) return;
    setLoading(true); setError(null);
    try {
      await downloadDeviceTemplate(`/api/modbus-templates/${encodeURIComponent(selectedEntry.id)}/download`, `${selectedEntry.manufacturer} - ${selectedEntry.model}.knxmbm`);
    } catch (err) { setError(err instanceof Error ? err.message : "Download failed."); }
    finally { setLoading(false); }
  }

  async function confirm() {
    if (busy) return;
    if (libraryOpen) {
      if (!selectedEntry) return;
      const form = new FormData(); form.set("libraryId", selectedEntry.id);
      await loadPreview(form);
    } else if (preview && !problem) {
      const ok = await save([{ type: "applyDeviceTemplate", token: preview.token, locator, name: name.trim(), slave, enabled: [...enabled], includeDisabled }]);
      if (ok) {
        pushUndo({ label: `Imported ${name.trim()}`, patches: [{ type: "undoDeviceTemplate", token: preview.token }] });
        onClose();
      }
    }
  }

  return (
    <Modal title={libraryOpen ? "HMS Modbus template library" : "Add device from template"}
      description={libraryOpen ? "Choose a manufacturer and model. Download the file or load it for preview." : "Import Modbus registers and their KNX mapping into an existing connection."}
      width={libraryOpen ? 720 : 1120} scrollable
      foot={libraryOpen ? `${entries.length} templates` : preview ? `${enabled.size} active · ${includedCount} imported + 1 communication-error signal` : "Supported: .knxmbm, .knxmbr, .bacmbm · Maximum 8 MB"}
      ctaLabel={loading ? "Loading…" : saving ? "Importing…" : libraryOpen ? "Load template" : "Add device"}
      ctaDisabled={busy || (libraryOpen ? !selectedEntry : !preview || !!problem)}
      onConfirm={() => void confirm()} onClose={() => { if (!busy) { if (libraryOpen) { setLibraryOpen(false); setError(null); } else onClose(); } }}>
      {error && <p role="alert" className="mb-3 rounded border border-error/30 bg-error-bg p-3 text-sm text-error">{error}</p>}
      {saveError && <p role="alert" className="mb-3 text-sm text-error">{saveError}</p>}
      {libraryOpen ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Manufacturer" htmlFor="template-manufacturer">
              <Select id="template-manufacturer" className="w-full" value={manufacturer} options={[{ value: "", label: "All manufacturers" }, ...(library?.manufacturers ?? []).map((m) => ({ value: m, label: m }))]} onValueChange={(value) => { setManufacturer(value); setSelectedId(""); }} />
            </Field>
            <Field label="Search models" htmlFor="template-search">
              <Input id="template-search" value={search} onChange={(e) => { setSearch(e.target.value); setSelectedId(""); }} placeholder="Model or manufacturer" />
            </Field>
          </div>
          {loading && <p role="status" className="text-sm text-fg-muted">{library ? "Loading template…" : "Loading HMS library…"}</p>}
          {!library && !loading && <Button variant="secondary" onClick={() => void openLibrary()}>Retry library</Button>}
          {library && <div className="max-h-[42vh] overflow-auto rounded border border-border">
            {entries.length === 0 && <p className="p-4 text-sm text-fg-muted">No matching templates.</p>}
            {entries.map((entry) => <label key={entry.id} className={`flex min-h-9 cursor-pointer items-center gap-3 border-b border-row-rule px-3 py-1.5 text-sm last:border-b-0 hover:bg-hms-blue/5 focus-within:bg-hms-blue/5 ${selectedId === entry.id ? "bg-hms-blue/5" : ""}`}>
              <Radio name="library-template" value={entry.id} checked={selectedId === entry.id} onChange={() => { setSelectedId(entry.id); setDetails(null); }} disabled={busy} />
              <span className="min-w-0 flex-1 truncate font-medium" title={entry.model}>{entry.model}</span>
              <span className="max-w-[25%] truncate text-xs text-fg-muted" title={entry.manufacturer}>{entry.manufacturer}</span>
              <span className="shrink-0 text-xs text-fg-muted" title="Template version">v{entry.version}</span>
            </label>)}
          </div>}
          <div className="min-h-20 rounded border border-border bg-card-foot px-3 py-2" aria-label="Selected template details" aria-live="polite" aria-busy={!!selectedEntry && !selectedMetadata && !selectedDetails?.error}>
            {selectedEntry ? <>
              <p className="mb-2 truncate text-xs font-medium" title={`${selectedEntry.manufacturer} · ${selectedEntry.model}`}>{selectedEntry.manufacturer} · {selectedEntry.model}</p>
              {selectedMetadata ? <TemplateMetadata metadata={selectedMetadata} /> : selectedDetails?.error ? <div className="flex items-center gap-2">
                <p role="alert" className="flex-1 text-xs text-error">{selectedDetails.error}</p>
                <Button variant="secondary" size="sm" onClick={() => { setDetails(null); setDetailsRetry((value) => value + 1); }}>Retry details</Button>
              </div> : <p role="status" className="text-xs text-fg-muted">Reading template version and signature…</p>}
            </> : <p className="text-xs text-fg-muted">Select a template to see its version and signature.</p>}
          </div>
          <Button variant="secondary" size="sm" disabled={!selectedEntry || busy} onClick={() => void downloadSelected()}><Download className="h-3.5 w-3.5" aria-hidden />Download template</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileInput} type="file" accept=".knxmbm,.knxmbr,.bacmbm" className="sr-only" aria-label="Template file" onChange={(e) => {
              const file = e.target.files?.[0]; e.target.value = "";
              if (file) { const form = new FormData(); form.set("file", file); void loadPreview(form); }
            }} />
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}><FileUp className="h-3.5 w-3.5" aria-hidden />Import file</Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void openLibrary()}><Library className="h-3.5 w-3.5" aria-hidden />Download templates</Button>
            <span className="min-w-0 truncate text-xs text-fg-muted">{loading ? "Reading template…" : preview?.fileName ?? "No template loaded"}</span>
          </div>
          {preview ? <>
            <div className="rounded border border-border bg-card-foot px-3 py-2 text-xs text-fg-muted">
              <strong className="text-text-body">{preview.device.manufacturer || "Unknown manufacturer"} · {preview.device.name}</strong>
              <span className="ml-4">{preview.signals.length} objects · {preview.conversions.length} conversions · {preview.device.baseRegister}-based registers</span>
              <div className="mt-2 text-text-body"><TemplateMetadata metadata={preview} /></div>
            </div>
            {preview.warnings.map((warning) => <p key={warning} className="rounded border border-warning-border bg-warning-bg p-2 text-xs text-warning-text">{warning}</p>)}
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Device name" htmlFor="template-device-name"><Input id="template-device-name" maxLength={128} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Connection" htmlFor="template-connection">
                <Select id="template-connection" className="w-full" disabled={busy} value={`${locator.kind}:${locator.nodeIndex}`} options={nodes.map((n) => ({ value: `${n.locator.kind}:${n.locator.nodeIndex}`, label: n.label }))} onValueChange={(value) => {
                  const next = nodes.find((n) => `${n.locator.kind}:${n.locator.nodeIndex}` === value);
                  if (next) { setLocator(next.locator); setSlave(freeSlave(next)); }
                }} />
              </Field>
              <Field label="Slave number" htmlFor="template-slave"><Input id="template-slave" type="number" min={locator.kind === "rtu" ? 1 : 0} max={locator.kind === "rtu" ? 254 : 255} value={Number.isNaN(slave) ? "" : slave} disabled={busy} onChange={(e) => setSlave(e.target.value === "" ? NaN : Number(e.target.value))} /></Field>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-2"><Checkbox checked={enabled.size === preview.signals.length} disabled={busy} onChange={(e) => setEnabled(e.target.checked ? new Set(preview.signals.map((s) => s.id)) : new Set())} />Activate all objects</label>
              <label className="flex items-center gap-2"><Checkbox checked={includeDisabled} disabled={busy} onChange={(e) => setIncludeDisabled(e.target.checked)} />Import disabled objects</label>
              <span className="ml-auto text-fg-muted">{enabled.size} / {preview.signals.length} active</span>
            </div>
            <Table containerClassName="max-h-[35vh] overflow-auto rounded border border-border" className="min-w-[920px] text-xs">
                <TableHeader className="sticky top-0 z-10 bg-card-foot">
                  <tr className="border-b border-border"><TableHead colSpan={5}>KNX mapping</TableHead><TableHead colSpan={6}>Modbus Master registers</TableHead></tr>
                  <tr>{["Active", "#", "Description", "DPT", "Group address", "Read / Write", "Address", "Bits", "Format", "Byte order", "Details"].map((h) => <TableHead key={h} className="whitespace-nowrap">{h}</TableHead>)}</tr>
                </TableHeader>
                <TableBody>{preview.signals.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((signal) => <TableRow key={signal.id} className={enabled.has(signal.id) ? "" : "text-fg-subtle"}>
                  <TableCell><Checkbox aria-label={`Activate object ${signal.id + 1}`} checked={enabled.has(signal.id)} disabled={busy} onChange={(e) => setEnabled((prev) => { const next = new Set(prev); if (e.target.checked) next.add(signal.id); else next.delete(signal.id); return next; })} /></TableCell>
                  <TableCell className="font-mono">{signal.id + 1}</TableCell>
                  <TableCell className="min-w-48">{signal.description}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono">{formatDpt(signal.knx.dpt)}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono">{signal.knx.groupAddress ? formatGroupAddressAtLevel(signal.knx.groupAddress, signal.knx.groupAddressLevel ?? 3) : "Unassigned"}</TableCell>
                  <TableCell className="font-mono">{signal.modbus.readFunc < 0 ? "—" : signal.modbus.readFunc} / {signal.modbus.writeFunc < 0 ? "—" : signal.modbus.writeFunc}</TableCell>
                  <TableCell className="font-mono">{signal.modbus.address}</TableCell>
                  <TableCell className="font-mono">{signal.modbus.lenBits}</TableCell>
                  <TableCell className="whitespace-nowrap">{FORMAT_LABELS[signal.modbus.format] ?? signal.modbus.format}</TableCell>
                  <TableCell className="whitespace-nowrap">{BYTE_ORDER_LABELS[signal.modbus.byteOrder] ?? signal.modbus.byteOrder}</TableCell>
                  <TableCell><details><summary className="cursor-pointer">Mapping</summary><div className="min-w-48 space-y-1 py-2">
                    <p>KNX flags: {Object.entries(signal.knx.flags).filter(([, on]) => on).map(([flag]) => flag.toUpperCase()).join(", ") || "None"}</p>
                    <p>Listening addresses: {signal.knx.additionalAddresses.map((a, i) => formatGroupAddressAtLevel(a, signal.knx.additionalAddressLevels?.[i] ?? 3)).join(", ") || "None"}</p>
                    <p>Bit: {signal.modbus.bit} · Number of bits: {signal.modbus.numOfBits}</p>
                    {signal.modbus.deadband !== undefined && <p>Deadband: {signal.modbus.deadband}</p>}
                    {(["internal", "external"] as const).map((side) => <p key={side}>{side === "internal" ? "KNX" : "Modbus"} conversions: {(["filters", "operations"] as const).flatMap((list) => signal.conversions[side][list].map((r) => `${list === "filters" ? "Filter" : "Operation"} ${r.index + 1}${r.inverted ? " (inverse)" : ""}`)).join(", ") || "None"}</p>)}
                  </div></details></TableCell>
                </TableRow>)}</TableBody>
              </Table>
            <div className="flex items-center justify-between text-xs text-fg-muted">
              <span>Objects {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, preview.signals.length)} of {preview.signals.length}</span>
              <div className="flex items-center gap-2"><Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="secondary" disabled={(page + 1) * PAGE_SIZE >= preview.signals.length} onClick={() => setPage(page + 1)}>Next</Button></div>
            </div>
            {problem && <p role="status" className="text-xs text-error">{problem}</p>}
          </> : <p className="rounded border border-dashed border-border p-8 text-center text-sm text-fg-muted">Import a MAPS device template or choose one from the HMS library to inspect its objects.</p>}
        </div>
      )}
    </Modal>
  );
}
