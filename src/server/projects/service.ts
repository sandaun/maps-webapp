import "server-only";
import {
  buildCompleteBlob,
  buildProjectZip,
  extractIbmaps,
  parseCompleteBlob,
  XmlDocument,
} from "@/core/project-format";
import {
  addSignal,
  isKnxMbmProject,
  projectFromXml,
  removeSignal,
  setGatewayInfo,
  setGeneralInfo,
  setKnxExtendedAddresses,
  setKnxPhysicalAddress,
  updateSignal,
  validateProject,
  type KnxMbmProject,
  type SignalPatch,
} from "@/gateway-families/knx-mbm";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import type { ValidationIssue } from "@/core/validation/issue";
import { getProjectStore } from "../persistence";
import type { ProjectMeta, ProjectSource } from "../persistence/types";

export interface ProjectView {
  meta: ProjectMeta;
  project: KnxMbmProject;
  issues: ValidationIssue[];
  /** Whether the original gateway "complete" blob is available for round-trip. */
  hasCompleteBlob: boolean;
}

/** Patch operations accepted by the API (validated with zod at the edge). */
export type ProjectPatch =
  | { type: "setGeneralInfo"; name?: string; description?: string }
  | { type: "setGatewayInfo"; name?: string; ip?: string; netmask?: string; gateway?: string; dhcp?: boolean }
  | { type: "setKnxPhysicalAddress"; address: number }
  | { type: "setKnxExtendedAddresses"; enabled: boolean }
  | { type: "addSignal" }
  | { type: "removeSignal"; id: number }
  | { type: "updateSignal"; id: number; patch: SignalPatch };

export async function listProjects(): Promise<ProjectMeta[]> {
  return getProjectStore().list();
}

export async function getProjectView(id: string): Promise<ProjectView> {
  const store = getProjectStore();
  const meta = await store.get(id);
  if (!meta) throw new ProjectServiceError(404, `Project "${id}" not found`);
  const xml = await store.readXml(id);
  const doc = XmlDocument.parse(xml);
  const project = projectFromXml(doc);
  return {
    meta,
    project,
    issues: validateProject(project),
    hasCompleteBlob: await store.hasCompleteBlob(id),
  };
}

/** Open a local .ibmaps XML text as a project. */
export async function openIbmaps(
  xml: string,
  opts: { id: string; name?: string; source?: ProjectSource },
): Promise<ProjectMeta> {
  const doc = XmlDocument.parse(xml);
  if (!isKnxMbmProject(doc)) {
    throw new ProjectServiceError(
      422,
      "The file is not a KNX ↔ Modbus Master project (IN-KNX-MBM).",
    );
  }
  return persistNewProject(opts.id, xml, { name: opts.name ?? opts.id, source: opts.source ?? "file" });
}

/** Open a gateway "complete" blob: validates length/CRC32/ZIP and extracts the XML. */
export async function openCompleteBlob(
  data: Uint8Array,
  opts: { id: string; name?: string; source?: ProjectSource },
): Promise<ProjectMeta> {
  const blob = parseCompleteBlob(data); // throws on bad length/CRC
  const ibmaps = extractIbmaps(blob.zip);
  const meta = await openIbmaps(ibmaps.xml, { ...opts, name: opts.name ?? ibmaps.name });
  await getProjectStore().writeCompleteBlob(meta.id, data);
  return meta;
}

/** Explicit demo project from the synthetic fixture — always labelled demo. */
export async function loadDemoProject(): Promise<ProjectMeta> {
  return persistNewProject("demo", SYNTHETIC_KNX_MBM_XML, {
    name: "Demo project (synthetic)",
    source: "demo",
  });
}

export async function applyPatches(id: string, patches: ProjectPatch[]): Promise<ProjectView> {
  const store = getProjectStore();
  const xml = await store.readXml(id);
  const doc = XmlDocument.parse(xml);
  for (const patch of patches) {
    applyPatch(doc, patch);
  }
  const serialized = doc.serialize();
  await store.writeXml(id, serialized);
  const meta = await store.get(id);
  if (meta) await store.upsert({ ...meta, updatedAt: new Date().toISOString() });
  return getProjectView(id);
}

/** Rebuild the "complete" blob with the current XML and the ORIGINAL XBL. */
export async function exportCompleteBlob(id: string): Promise<Uint8Array> {
  const store = getProjectStore();
  const xml = await store.readXml(id);
  const zip = buildProjectZip(`${id}.ibmaps`, xml);
  if (await store.hasCompleteBlob(id)) {
    const original = parseCompleteBlob(await store.readCompleteBlob(id));
    return buildCompleteBlob(original.xbl, zip);
  }
  // No XBL available (file-opened projects): export is the ZIP alone.
  return zip;
}

function applyPatch(doc: XmlDocument, patch: ProjectPatch): void {
  switch (patch.type) {
    case "setGeneralInfo":
      setGeneralInfo(doc, patch);
      break;
    case "setGatewayInfo":
      setGatewayInfo(doc, patch);
      break;
    case "setKnxPhysicalAddress":
      setKnxPhysicalAddress(doc, patch.address);
      break;
    case "setKnxExtendedAddresses":
      setKnxExtendedAddresses(doc, patch.enabled);
      break;
    case "addSignal":
      addSignal(doc);
      break;
    case "removeSignal":
      removeSignal(doc, patch.id);
      break;
    case "updateSignal":
      updateSignal(doc, patch.id, patch.patch);
      break;
  }
}

async function persistNewProject(
  id: string,
  xml: string,
  opts: { name: string; source: ProjectSource },
): Promise<ProjectMeta> {
  const store = getProjectStore();
  const meta: ProjectMeta = {
    id,
    name: opts.name,
    description: XmlDocument.parse(xml).getAttr([], "ProjectDescription") ?? "",
    source: opts.source,
    updatedAt: new Date().toISOString(),
  };
  await store.writeXml(id, xml);
  await store.upsert(meta);
  return meta;
}

export class ProjectServiceError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProjectServiceError";
  }
}
