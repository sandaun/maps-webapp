import type { ProjectMeta, ProjectPatchInput, ProjectView } from "./project-types";

/** Typed fetch wrappers for the `/api/projects` REST API (client-side). */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const data = await request<{ projects: ProjectMeta[] }>("/api/projects");
  return data.projects;
}

export async function getProjectView(id: string): Promise<ProjectView> {
  // The static `demo` segment shadows `[id]`; both paths return a ProjectView.
  return request<ProjectView>(`/api/projects/${encodeURIComponent(id)}`);
}

export async function patchProject(id: string, patches: ProjectPatchInput[]): Promise<ProjectView> {
  return request<ProjectView>(`/api/projects/${encodeURIComponent(id)}/patch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patches }),
  });
}

/** Explicitly load (or reload) the labelled synthetic demo project. */
export async function loadDemoProject(): Promise<ProjectMeta> {
  const data = await request<{ project: ProjectMeta }>("/api/projects/demo", { method: "POST" });
  return data.project;
}

/** Upload a local `.ibmaps` XML (or gateway "complete" blob) as a project. */
export async function openProjectFile(file: File): Promise<ProjectMeta> {
  const form = new FormData();
  form.append("file", file);
  const data = await request<{ project: ProjectMeta }>("/api/projects/open", {
    method: "POST",
    body: form,
  });
  return data.project;
}

export function exportProjectUrl(id: string): string {
  return `/api/projects/${encodeURIComponent(id)}/export`;
}
