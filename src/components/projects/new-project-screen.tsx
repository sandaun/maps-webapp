"use client";

import * as React from "react";
import { ArrowLeftRight, FileUp, RadioTower, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { createTemplateProject, openProjectFile } from "@/lib/api";
import { receiveGatewayProject } from "@/lib/gateway-api";
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
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const visibleTemplates = TEMPLATES.filter((template) =>
    `${template.title} ${template.code} ${template.bms} ${template.device}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

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

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
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

  async function handleReceive() {
    if (!session) {
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
          className="h-9 rounded-[4px] px-[15px] text-[13px] font-bold text-fg-muted"
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
              if (option.id === "file") fileRef.current?.click();
              if (option.id === "gateway") void handleReceive();
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
              <span className="block text-[12.5px] font-bold text-hms-blue">{option.title}</span>
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

      <div className="grid grid-cols-[200px_minmax(0,1fr)_324px] gap-3">
        <aside className="rounded-[6px] border border-border bg-white py-3">
          <FilterGroup title="BMS side" items={["All", "KNX TP", "Modbus Server"]} counts={[2, 1, 1]} />
          <div className="my-3 border-t border-border" />
          <FilterGroup title="Device side" items={["All", "Modbus Master", "Mitsubishi Electric"]} counts={[2, 1, 1]} />
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
                <span className="block truncate text-[13px] font-bold text-hms-blue">{template.title}</span>
                <span className="block font-mono text-[11px] text-fg-subtle">{template.code}</span>
              </span>
              <span className="text-[12px] text-fg-muted">{template.bms}</span>
              <span className="text-[12px] text-fg-muted">{template.device}</span>
              <span className="font-mono text-[11px] text-hms-blue">{template.gateway}</span>
            </button>
          ))}
        </section>

        <aside className="rounded-[6px] border border-border bg-white p-4">
          <h2 className={cn("font-display font-medium text-hms-blue", selected ? "text-[17px] leading-[1.25]" : "text-[15px]")}>
            {selected ? "Name the project" : "Pick a template"}
          </h2>
          {selected ? (
            <div className="mt-3 space-y-3">
              <div className="rounded border border-border bg-gateway-surface p-3">
                <div className="text-[12.5px] font-bold text-hms-blue">{selected.title}</div>
                <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-fg-muted">
                  {selected.bms}
                  <ArrowLeftRight className="size-3" />
                  {selected.device}
                </div>
                <div className="mt-1 font-mono text-[11px] text-fg-subtle">{selected.capacity}</div>
              </div>
              <label className="block">
                <span className="mb-1 block text-[11.5px] font-bold text-text-body">Project name</span>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="h-8 text-[12.5px]"
                  autoFocus
                />
              </label>
              <Button
                className="h-9 w-full rounded-[4px] text-[13px] font-bold"
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

function FilterGroup({ title, items, counts }: { title: string; items: string[]; counts: number[] }) {
  return (
    <div>
      <h2 className="bg-table-header px-[13px] pb-1.5 pt-[9px] font-mono text-[10.5px] font-semibold uppercase tracking-[.07em] text-fg-subtle">{title}</h2>
      <div className="mt-2">
        {items.map((item, index) => (
          <div
            key={item}
            className={cn(
              "flex items-center justify-between border-l-2 px-3 py-1.5 text-[12px]",
              index === 0 ? "border-hms-accent bg-row-selected font-semibold text-[#244f68]" : "border-transparent text-text-body",
            )}
          >
            <span>{item}</span>
            <span className="font-mono text-[10.5px] text-fg-subtle">{counts[index]}</span>
          </div>
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
