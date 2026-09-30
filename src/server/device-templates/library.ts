import "server-only";
import { z } from "zod";
import type { TemplateLibrary, TemplateLibraryEntry } from "@/core/device-templates/types";
import { ProjectServiceError } from "@/server/projects/errors";
import { MAX_TEMPLATE_BYTES } from "./crypto";

const BASE = "https://api-tools.intesis.com/v1";
const reference = z.object({ name: z.string(), slug: z.string() });
const entrySchema = z.object({
  id: z.string().min(1), manufacturer: reference,
  model: reference.extend({ version: z.string() }), version: z.string(),
  internalProtocol: reference, externalProtocol: reference, file: z.string().url(),
});
const pageSchema = z.object({ items: z.array(entrySchema) });
type OfficialEntry = z.infer<typeof entrySchema>;
type Cached = { expires: number; entries: OfficialEntry[] };
const state = globalThis as typeof globalThis & { mapsTemplateLibrary?: Map<string, Cached> };
const cache = state.mapsTemplateLibrary ??= new Map();

async function responseBytes(url: string, max: number): Promise<Uint8Array> {
  try {
    const signal = AbortSignal.timeout(15000);
    let response: Response | undefined;
    // The API canonicalizes collection URLs with a trailing slash (HTTP 301).
    // Validate every hop so redirects cannot escape the official API.
    for (let hop = 0; hop < 4; hop++) {
      const parsed = new URL(url);
      if (parsed.origin !== "https://api-tools.intesis.com" || !parsed.pathname.startsWith("/v1/"))
        throw new ProjectServiceError(502, "Unexpected template download address.");
      response = await fetch(url, { signal, redirect: "manual", cache: "no-store", headers: { "User-Agent": "IntesisMAPS" } });
      if (![301,302,303,307,308].includes(response.status)) break;
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("redirect");
      url = new URL(location,url).href;
      response = undefined;
    }
    if (!response) throw new Error("redirect limit");
    if (!response.ok || !response.body) throw new Error("http");
    const reader = response.body.getReader(), parts: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        total += result.value.length;
        if (total > max) throw new ProjectServiceError(413, "Template library response is too large.");
        parts.push(result.value);
      }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    return bytes;
  } catch (error) {
    if (error instanceof ProjectServiceError) throw error;
    throw new ProjectServiceError(502, "HMS template library is unavailable. Retry or import a local template file.");
  }
}

async function officialEntries(protocol: "knx" | "bacnet"): Promise<OfficialEntry[]> {
  const cached = cache.get(protocol);
  if (cached && cached.expires > Date.now()) return cached.entries;
  const unique = new Map<string, OfficialEntry>();
  // The observed total is the page size. Never stop at pagination.total.
  for (let offset = 0; offset < 10000; offset += 100) {
    const query = new URLSearchParams({
      "filters[internalProtocol]": protocol, "filters[externalProtocol]": "modbus-mbm",
      "pagination[limit]": "100", "pagination[offset]": String(offset),
    });
    const bytes = await responseBytes(`${BASE}/templates/?${query}`, 4 * 1024 * 1024);
    let page: z.infer<typeof pageSchema>;
    try { page = pageSchema.parse(JSON.parse(new TextDecoder().decode(bytes))); }
    catch { throw new ProjectServiceError(502, "Invalid response from HMS template library."); }
    let added = 0;
    for (const entry of page.items) {
      if (entry.internalProtocol.slug !== protocol || entry.externalProtocol.slug !== "modbus-mbm") continue;
      if (!unique.has(entry.id)) { unique.set(entry.id, entry); added++; }
    }
    if (page.items.length < 100) {
      const entries = [...unique.values()];
      cache.set(protocol, { expires: Date.now() + 5 * 60 * 1000, entries });
      return entries;
    }
    if (!added) throw new ProjectServiceError(502, "HMS template library repeated a page. Retry later.");
  }
  throw new ProjectServiceError(502, "HMS template library exceeded the page limit.");
}

export async function getTemplateLibrary(protocol: "knx" | "bacnet" = "knx"): Promise<TemplateLibrary> {
  const rows = await officialEntries(protocol);
  const entries: TemplateLibraryEntry[] = rows.map((e) => ({
    id: e.id, manufacturer: e.manufacturer.name, manufacturerSlug: e.manufacturer.slug,
    model: e.model.name, modelVersion: e.model.version, version: e.version, protocol,
  })).sort((a,b) => a.manufacturer.localeCompare(b.manufacturer) || a.model.localeCompare(b.model));
  return { entries, manufacturers: [...new Set(entries.map((e) => e.manufacturer))] };
}

export async function downloadLibraryTemplate(id: string, protocol: "knx" | "bacnet" = "knx") {
  const entry = (await officialEntries(protocol)).find((e) => e.id === id);
  if (!entry) throw new ProjectServiceError(404, "Template is not in the HMS library for this protocol.");
  if (!new URL(entry.file).pathname.startsWith(`/v1/templates/${encodeURIComponent(entry.id)}/files/`))
    throw new ProjectServiceError(502, "Unexpected template download address.");
  return { bytes: await responseBytes(entry.file, MAX_TEMPLATE_BYTES), manufacturer: entry.manufacturer.name,
    fileName: `${entry.manufacturer.name} - ${entry.model.name}.${protocol === "knx" ? "knxmbm" : "bacmbm"}` };
}
