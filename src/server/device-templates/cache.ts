import "server-only";
import { randomUUID } from "node:crypto";
import { ProjectServiceError } from "@/server/projects/errors";
import type { ParsedDeviceTemplate } from "./read";

type PreviewRecord = { projectId: string; revision: number; template: ParsedDeviceTemplate; expires: number; undoXml?: string };
const state = globalThis as typeof globalThis & { mapsDeviceTemplatePreviews?: Map<string, PreviewRecord> };
const previews = state.mapsDeviceTemplatePreviews ??= new Map();

export function rememberTemplate(projectId: string, revision: number, template: ParsedDeviceTemplate): string {
  for (const [token, preview] of previews) if (preview.expires <= Date.now()) previews.delete(token);
  // Keep bounded XML trees, including when requests arrive from abandoned dialogs.
  while (previews.size >= 16) previews.delete(previews.keys().next().value!);
  const token = randomUUID();
  previews.set(token, { projectId, revision, template, expires: Date.now() + 30 * 60 * 1000 });
  return token;
}

export function getPreviewTemplate(token: string, projectId?: string, revision?: number): ParsedDeviceTemplate {
  const preview = previews.get(token);
  if (!preview || preview.expires <= Date.now()) {
    previews.delete(token);
    throw new ProjectServiceError(409, "Template preview expired. Load the template again.", "template-expired");
  }
  if (projectId !== undefined && (preview.projectId !== projectId || preview.revision !== revision))
    throw new ProjectServiceError(409, "The project changed since this template was loaded. Reload the template and review its destination.", "revision-conflict");
  return preview.template;
}

export function rememberTemplateUndo(token: string, xml: string): void {
  const preview = previews.get(token);
  if (preview) preview.undoXml = xml;
}

export function templateUndoXml(token: string, projectId: string, revision: number): string {
  getPreviewTemplate(token);
  const preview = previews.get(token)!;
  if (preview.projectId !== projectId || revision !== preview.revision + 1 || !preview.undoXml)
    throw new ProjectServiceError(409, "The project changed after this import. Use project history to review and restore an earlier version.", "revision-conflict");
  return preview.undoXml;
}
