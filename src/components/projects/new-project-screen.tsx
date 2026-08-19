"use client";

import * as React from "react";
import { ArrowLeftRight, FileUp, RadioTower, RefreshCw, Search, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { createTemplateProject, openProjectFile } from "@/lib/api";
import {
  gatewayFamily,
  receiveGatewayProject,
  scanGateways,
  type DiscoveredGateway,
} from "@/lib/gateway-api";
import { useCurrentProject } from "@/lib/current-project";
import { useGatewaySession } from "@/lib/gateway-session";
import type { FamilyId } from "@/lib/project-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type StartMode = "template" | "file" | "gateway";

interface Template {
  family: FamilyId;
  code: string;
  title: string;
  bms: string;
  device: string;
  gateway: string;
  capacity: string;
}

const TEMPLATES: Template[] = [
  {
    family: "knx-mbm",
    code: "IN-KNX-MBM",
    title: "KNX → Modbus Master",
    bms: "KNX TP",
    device: "Modbus Master",
    gateway: "IN701KNX…",
    capacity: "3,000 signals",
  },
  {
    family: "me-mbs",
    code: "IN-BA-ME",
    title: "Mitsubishi Electric → Modbus Server",
    bms: "Modbus Server",
    device: "Mitsubishi Electric",
    gateway: "IN770AIR…",
    capacity: "700 indoor units",
  },
];

export function NewProjectScreen() {
  const router = useRouter();
  const { setProjectId } = useCurrentProject();
  const { session } = useGatewaySession();
  const [mode, setMode] = React.useState<StartMode>("template");
  const [selected, setSelected] = React.useState<Template | null>(null);
  const [name, setName] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [bmsFilter, setBmsFilter] = React.useState("All");
  const [deviceFilter, setDeviceFilter] = React.useState("All");
  const [gateways, setGateways] = React.useState<DiscoveredGateway[]>([]);
  const [selectedGateway, setSelectedGateway] = React.useState<string | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const [draggingFile, setDraggingFile] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const visibleTemplates = TEMPLATES.filter(
    (template) =>
      (bmsFilter === "All" || template.bms === bmsFilter) &&
      (deviceFilter === "All" || template.device === deviceFilter) &&
      `${template.title} ${template.code} ${template.bms} ${template.device}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );

  const bmsCounts = ["All", "KNX TP", "Modbus Server"].map((item) =>
    TEMPLATES.filter(
      (template) =>
        (item === "All" || template.bms === item) &&
        (deviceFilter === "All" || template.device === deviceFilter),
    ).length,
  );
  const deviceCounts = ["All", "Modbus Master", "Mitsubishi Electric"].map((item) =>
    TEMPLATES.filter(
      (template) =>
        (item === "All" || template.device === item) &&
        (bmsFilter === "All" || template.bms === bmsFilter),
    ).length,
  );

  const gatewayRows = React.useMemo(() => {
    const rows = [...gateways];
    if (session?.gateway && !rows.some((gateway) => gateway.address === session.host)) {
      rows.unshift({ address: session.host, info: session.gateway, raw: {} });
    }
    return rows;
  }, [gateways, session]);

  const activeGateway = gatewayRows.find((gateway) => gateway.address === selectedGateway) ?? null;

  const runGatewayScan = React.useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const found = await scanGateways();
      setGateways(found);
      setSelectedGateway((current) => current ?? session?.host ?? found[0]?.address ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to scan for gateways");
      setSelectedGateway((current) => current ?? session?.host ?? null);
    } finally {
      setScanning(false);
    }
  }, [session?.host]);

  function finish(id: string) {
    setProjectId(id);
    router.push("/overview");
  }

  async function handleCreate() {
    if (!selected || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const project = await createTemplateProject(selected.family, name.trim());
      finish(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const project = await openProjectFile(file);
      finish(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import project");
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    await importFile(file);
  }

  async function handleReceive() {
    if (!session || selectedGateway !== session.host) {
      router.push("/connection");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const project = await receiveGatewayProject(session.id);
      finish(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to receive project");
    } finally {
      setBusy(false);
    }
  }

  const modeOptions: Array<{
    id: StartMode;
    title: string;
    description: string;
    icon?: React.ReactNode;
  }> = [
    { id: "template", title: "From a template", description: "Pre-mapped, one gateway model and protocol pair" },
    { id: "file", title: "From a project file", description: "An .ibmaps project made earlier in MAPS", icon: <FileUp className="size-3.5" /> },
    { id: "gateway", title: "From a gateway", description: "Read what a commissioned gateway already runs", icon: <RadioTower className="size-3.5" /> },
  ];

  return (
    <div className="w-full max-w-[1320px]">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h1 className="font-display text-[24px] font-light leading-8 text-hms-blue">New project</h1>
          <p className="mt-0.5 max-w-[660px] text-[12px] leading-[1.45] text-fg-muted">
            A project is one gateway. Everything a template sets can be changed afterwards.
          </p>
        </div>
        <Button
          variant="secondary"
          className="h-9 rounded-[4px] px-[15px] text-[13px] font-medium text-fg-muted"
          onClick={() => router.push("/projects")}
        >
          Cancel
        </Button>
      </div>

      <div className="mb-[14px] grid grid-cols-3 gap-[10px]">
        {modeOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            className={cn(
              "flex min-h-[54px] items-center gap-[10px] rounded-[6px] border bg-white px-[13px] py-[9px] text-left",
              mode === option.id ? "border-hms-accent ring-1 ring-hms-accent" : "border-border hover:border-border-strong",
            )}
            onClick={() => {
              setMode(option.id);
              setError(null);
              if (option.id === "gateway" && gateways.length === 0) void runGatewayScan();
            }}
          >
            <span
              className={cn(
                "flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                mode === option.id ? "border-hms-accent" : "border-border-strong",
              )}
            >
              {mode === option.id ? <span className="size-1.5 rounded-full bg-hms-accent" /> : option.icon}
            </span>
            <span>
              <span className="block text-[12.5px] font-medium text-hms-blue">{option.title}</span>
              <span className="mt-px block text-[11px] leading-[1.35] text-fg-muted">{option.description}</span>
            </span>
          </button>
        ))}
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded border border-error-border bg-error-bg px-3 py-2 text-xs text-error">
          {error}
        </p>
      ) : null}

      {mode === "template" ? (
      <div className="grid grid-cols-[200px_minmax(0,1fr)_324px] gap-3">
        <aside className="rounded-[6px] border border-border bg-white py-3">
          <FilterGroup
            title="BMS side"
            items={["All", "KNX TP", "Modbus Server"]}
            counts={bmsCounts}
            selected={bmsFilter}
            onSelect={setBmsFilter}
          />
          <div className="my-3 border-t border-border" />
          <FilterGroup
            title="Device side"
            items={["All", "Modbus Master", "Mitsubishi Electric"]}
            counts={deviceCounts}
            selected={deviceFilter}
            onSelect={setDeviceFilter}
          />
        </aside>

        <section className="min-w-0 overflow-hidden rounded-[6px] border border-border bg-white">
          <div className="flex h-10 items-center border-b border-border px-3">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-fg-subtle" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-8 rounded-[4px] border-border pl-7 text-[12.5px]"
                placeholder="Search protocol, template code, order code…"
              />
            </div>
            <span className="ml-3 text-[11px] text-fg-muted">{visibleTemplates.length} templates</span>
          </div>
          <div className="grid grid-cols-[minmax(210px,1.4fr)_120px_145px_110px] border-b border-border bg-table-header px-3 py-2 font-mono text-[10.5px] font-semibold uppercase tracking-[.06em] text-fg-muted">
            <span>Template</span>
            <span>BMS side</span>
            <span>Device side</span>
            <span>Gateway</span>
          </div>
          {visibleTemplates.map((template) => (
            <button
              key={template.family}
              type="button"
              className={cn(
                "grid w-full grid-cols-[minmax(210px,1.4fr)_120px_145px_110px] items-center border-b border-row-rule px-3 py-2.5 text-left last:border-b-0 hover:bg-row-hover",
                selected?.family === template.family && "bg-row-open",
              )}
              onClick={() => {
                setSelected(template);
                setName(template.title.replace(" → ", " to "));
              }}
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-hms-blue">{template.title}</span>
                <span className="block font-mono text-[11px] text-fg-subtle">{template.code}</span>
              </span>
              <span className="text-[12px] text-fg-muted">{template.bms}</span>
              <span className="text-[12px] text-fg-muted">{template.device}</span>
              <span className="font-mono text-[11px] text-hms-blue">{template.gateway}</span>
            </button>
          ))}
          {visibleTemplates.length === 0 ? (
            <div className="px-6 py-11 text-center text-[13px] leading-[1.6] text-fg-muted">
              <p>No templates match these protocols and search terms.</p>
              <button
                type="button"
                className="mt-3 text-[12.5px] font-medium text-hms-accent hover:underline"
                onClick={() => {
                  setBmsFilter("All");
                  setDeviceFilter("All");
                  setQuery("");
                }}
              >
                Clear filters
              </button>
            </div>
          ) : null}
        </section>

        <aside className="rounded-[6px] border border-border bg-white p-4">
          <h2 className={cn("font-display font-medium text-hms-blue", selected ? "text-[17px] leading-[1.25]" : "text-[15px]")}>
            {selected ? "Name the project" : "Pick a template"}
          </h2>
          {selected ? (
            <div className="mt-3 space-y-3">
              <div className="rounded border border-border bg-gateway-surface p-3">
                <div className="text-[12.5px] font-medium text-hms-blue">{selected.title}</div>
                <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-fg-muted">
                  {selected.bms}
                  <ArrowLeftRight className="size-3" />
                  {selected.device}
                </div>
                <div className="mt-1 font-mono text-[11px] text-fg-subtle">{selected.capacity}</div>
              </div>
              <label className="block">
                <span className="mb-1 block text-[11.5px] font-medium text-text-body">Project name</span>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="h-8 text-[12.5px]"
                  autoFocus
                />
              </label>
              <Button
                className="h-9 w-full rounded-[4px] text-[13px] font-medium"
                disabled={busy || !name.trim()}
                onClick={handleCreate}
              >
                {busy ? "Creating…" : "Create project"}
              </Button>
            </div>
          ) : (
            <>
              <p className="mt-2 text-[11.5px] leading-[1.6] text-fg-muted">
                Filter by the two protocols the gateway has to sit between. The template you choose sets the signal table, the gateway model and the licence you order.
              </p>
              <ol className="mt-3 space-y-2 border-t border-border pt-3 text-[11.5px] text-text-body">
                <li><Step number="1" text="Choose the BMS and the device protocol" /></li>
                <li><Step number="2" text="Pick the capacity — it resolves the order code" /></li>
                <li><Step number="3" text="Name it, and connect a gateway now or later" /></li>
              </ol>
            </>
          )}
        </aside>
      </div>
      ) : mode === "file" ? (
        <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-[14px]">
          <section className="rounded-[8px] border border-border bg-white p-5">
            <button
              type="button"
              className={cn(
                "flex min-h-[168px] w-full flex-col items-center justify-center rounded-[6px] border border-dashed px-7 py-11 text-center transition-colors",
                draggingFile
                  ? "border-hms-accent bg-row-selected"
                  : "border-border-strong bg-white hover:border-hms-accent hover:bg-row-hover",
              )}
              onClick={() => fileRef.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                setDraggingFile(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDraggingFile(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDraggingFile(false);
                void importFile(event.dataTransfer.files[0]);
              }}
            >
              <Upload className="size-6 text-hms-accent" strokeWidth={1.6} aria-hidden />
              <span className="mt-3 text-[14px] font-medium text-hms-blue">
                {busy ? "Importing project…" : "Drop an .ibmaps project here"}
              </span>
              <span className="mt-1 text-[12px] leading-[1.5] text-fg-muted">
                Projects exported from MAPS on Windows open unchanged, including their signal table and device list.
              </span>
              <span className="mt-[14px] rounded-[4px] border border-hms-accent bg-white px-[15px] py-2 text-[12.5px] font-medium text-hms-accent">
                Browse files
              </span>
            </button>
          </section>
          <aside className="h-fit rounded-[8px] border border-border bg-white px-4 py-[15px]">
            <h2 className="font-display text-[15px] font-medium text-hms-blue">On import</h2>
            <p className="mt-2 text-[11.5px] leading-[1.6] text-fg-muted">
              The template the project was built from is recognised from its header, so the gateway model and licence
              come across with it. Signals that the current firmware no longer supports are listed as validation
              warnings instead of being dropped.
            </p>
          </aside>
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-[14px]">
          <section className="min-w-0 overflow-hidden rounded-[8px] border border-border bg-white">
            <div className="grid grid-cols-[minmax(230px,1fr)_210px_118px_96px] border-b border-border bg-table-header px-[15px] py-2 font-mono text-[10.5px] font-semibold uppercase tracking-[.07em] text-fg-muted">
              <span>Gateway</span>
              <span>Protocols</span>
              <span>Address</span>
              <span>State</span>
            </div>
            {scanning && gatewayRows.length === 0 ? (
              <p className="px-4 py-10 text-center text-[13px] text-fg-muted">Scanning for gateways…</p>
            ) : gatewayRows.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <p className="text-[13px] text-fg-muted">No gateways found on this network.</p>
                <Button className="mt-3 h-8 text-[12.5px]" variant="secondary" onClick={() => void runGatewayScan()}>
                  <RefreshCw className="size-3.5" />
                  Scan again
                </Button>
              </div>
            ) : (
              gatewayRows.map((gateway) => {
                const connected = session?.host === gateway.address && session.connected;
                const family = gatewayFamily(gateway.info, gateway.raw);
                return (
                  <button
                    key={gateway.address}
                    type="button"
                    className={cn(
                      "grid w-full grid-cols-[minmax(230px,1fr)_210px_118px_96px] items-center border-b border-row-rule px-[14px] py-[10px] text-left last:border-b-0 hover:bg-row-hover",
                      selectedGateway === gateway.address && "border-l-2 border-l-hms-accent bg-row-open pl-3",
                    )}
                    onClick={() => setSelectedGateway(gateway.address)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-hms-blue">
                        {gateway.info.name ?? "Intesis gateway"}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-fg-subtle">
                        {[gateway.info.platform, gateway.info.serial].filter(Boolean).join(" · ") || "Gateway discovered"}
                      </span>
                    </span>
                    <span className="truncate font-mono text-[11px] text-fg-muted">
                      {family === "knx-mbm"
                        ? "KNX TP ↔ MODBUS MASTER"
                        : family === "me-mbs"
                          ? "MITSUBISHI ELECTRIC ↔ MODBUS SERVER"
                          : "not configured"}
                    </span>
                    <span className="font-mono text-[11.5px] text-text-body">{gateway.address}</span>
                    <span>
                      <span
                        className={cn(
                          "inline-flex rounded-full border px-[7px] py-0.5 text-[11px] font-medium",
                          connected
                            ? "border-success-border bg-success-bg text-success"
                            : "border-border bg-hms-muted text-fg-muted",
                        )}
                      >
                        {connected ? "connected" : "reachable"}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </section>

          <aside className="h-fit overflow-hidden rounded-[8px] border border-border bg-white">
            {activeGateway ? (
              <>
                <div className="border-b border-border px-4 pb-[13px] pt-[14px]">
                  <h2 className="font-display text-[17px] font-normal leading-[1.25] text-hms-blue">
                    {activeGateway.info.name ?? "Intesis gateway"}
                  </h2>
                  <p className="mt-1 font-mono text-[11px] text-fg-subtle">
                    {[activeGateway.info.platform, activeGateway.info.serial, activeGateway.address]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="px-4 py-[14px] text-[11.5px] leading-[1.6] text-fg-muted">
                  {session?.host === activeGateway.address
                    ? "The configuration stored in the gateway becomes the new project, template included. The gateway keeps running while it is read."
                    : "This gateway is reachable but is not connected to this workspace. Connect it before receiving its configuration."}
                </div>
                <div className="border-t border-border bg-[#FCFCFD] px-4 py-[13px]">
                  <Button
                    className="h-9 w-full rounded-[4px] text-[13px] font-medium"
                    disabled={busy}
                    onClick={handleReceive}
                  >
                    {busy
                      ? "Receiving…"
                      : session?.host === activeGateway.address
                        ? "Receive configuration"
                        : "Connect gateway"}
                  </Button>
                </div>
              </>
            ) : (
              <div className="p-4">
                <h2 className="font-display text-[15px] font-medium text-hms-blue">Pick a gateway</h2>
                <p className="mt-2 text-[11.5px] leading-[1.6] text-fg-muted">
                  Select a reachable gateway to inspect it and receive its current configuration.
                </p>
              </div>
            )}
          </aside>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".ibmaps,.bin,application/xml,text/xml"
        className="hidden"
        aria-label="Open project file"
        onChange={handleFile}
      />
    </div>
  );
}

function FilterGroup({
  title,
  items,
  counts,
  selected,
  onSelect,
}: {
  title: string;
  items: string[];
  counts: number[];
  selected: string;
  onSelect: (item: string) => void;
}) {
  return (
    <div>
      <h2 className="bg-table-header px-[13px] pb-1.5 pt-[9px] font-mono text-[10.5px] font-semibold uppercase tracking-[.07em] text-fg-subtle">{title}</h2>
      <div className="mt-2">
        {items.map((item, index) => (
          <button
            key={item}
            type="button"
            className={cn(
              "flex w-full items-center justify-between border-l-2 px-[13px] py-1.5 text-left text-[12px] leading-[1.35] hover:bg-row-hover",
              selected === item
                ? "border-hms-accent bg-row-selected font-medium text-hms-blue"
                : "border-transparent text-text-body",
            )}
            aria-pressed={selected === item}
            onClick={() => onSelect(item)}
          >
            <span>{item}</span>
            <span className="font-mono text-[10.5px] text-fg-subtle">{counts[index]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Step({ number, text }: { number: string; text: string }) {
  return (
    <span className="flex gap-2">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#EDF3F7] font-mono text-[10.5px] font-semibold text-fg-subtle">
        {number}
      </span>
      <span className="leading-4">{text}</span>
    </span>
  );
}
