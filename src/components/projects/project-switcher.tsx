"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { listProjects } from "@/lib/api";
import { useCurrentProject } from "@/lib/current-project";
import { FAMILY_LABELS, type ProjectMeta } from "@/lib/project-types";
import { cn } from "@/lib/utils";

function relativeTime(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

export function ProjectSwitcher() {
  const { view, projectId, setProjectId } = useCurrentProject();
  const [open, setOpen] = React.useState(false);
  const [projects, setProjects] = React.useState<ProjectMeta[]>([]);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    void listProjects().then(setProjects).catch(() => setProjects([]));
    const close = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={containerRef} className="relative mx-3 mb-4">
      <button
        type="button"
        className="flex w-full items-center gap-[9px] rounded-[4px] border border-white/15 bg-white/[.045] px-[11px] py-[9px] text-left hover:border-hms-pop hover:bg-white/[.08]"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium leading-[1.25] text-white">
            {view?.meta.name ?? "No project loaded"}
          </span>
          <span className="mt-0.5 block truncate text-[10.5px] leading-[1.25] text-white/50">
            {view ? FAMILY_LABELS[view.family] : "Open or receive a project"}
          </span>
        </span>
        <ChevronDown
          className={cn("size-3.5 shrink-0 text-white/55 transition-transform", open && "rotate-180")}
          strokeWidth={1.7}
          aria-hidden
        />
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close project switcher"
            className="fixed inset-0 z-40 cursor-default bg-[rgba(4,61,93,.18)]"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Switch project"
            className="fixed left-[242px] top-[64px] z-50 w-[400px] overflow-hidden rounded-[8px] border border-border bg-white text-text-body shadow-[0_18px_45px_rgba(4,61,93,.22)]"
          >
            <div className="border-b border-border px-4 py-[13px] font-mono text-[10.5px] font-semibold uppercase tracking-[.08em] text-fg-subtle">
              Switch gateway workspace
            </div>
            <div className="max-h-[340px] overflow-auto py-1.5">
              {projects.length === 0 ? (
                <p className="px-4 py-4 text-xs text-fg-muted">No saved projects</p>
              ) : (
                projects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className={cn(
                      "flex w-full items-start gap-[11px] border-b border-row-rule px-4 py-[11px] text-left last:border-b-0 hover:bg-row-hover",
                      project.id === projectId && "bg-row-selected",
                    )}
                    onClick={() => {
                      setProjectId(project.id);
                      setOpen(false);
                    }}
                  >
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        project.source === "gateway" ? "bg-[#12A278]" : "bg-warning",
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-hms-blue">{project.name}</span>
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-fg-subtle">
                        {FAMILY_LABELS[project.family]}
                      </span>
                    </span>
                    <span className="shrink-0 pt-0.5 text-[11.5px] text-fg-muted">
                      {relativeTime(project.updatedAt)}
                    </span>
                  </button>
                ))
              )}
            </div>
            <Link
              href="/projects"
              className="block border-t border-border px-4 py-3 text-[12.5px] font-medium text-hms-accent hover:bg-row-hover"
              onClick={() => setOpen(false)}
            >
              All projects and sites →
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}
