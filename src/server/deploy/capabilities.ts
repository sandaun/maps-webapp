import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Reader for `.local-data/capabilities.json` — the artefact written ONLY by
 * `scripts/verify-xbl.ts` after a byte-exact XBL match against a real fixture
 * (docs/knx-mbm-mvp.md, Pas 2.4). The deploy path gates on the presence of a
 * genuine entry; nothing else in the app writes this file.
 */

const HEX_64 = /^[0-9a-f]{64}$/;

export function defaultCapabilitiesPath(): string {
  return path.join(process.cwd(), ".local-data", "capabilities.json");
}

/** Raw capabilities map ({} when the file is missing or unparseable). */
export function readCapabilities(filePath = defaultCapabilitiesPath()): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf-8"));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * A capability entry is considered genuine when it has the exact shape the
 * verify script writes: an ISO `verifiedAt`, matching 64-hex SHA-256 hashes
 * of project and reference, and a positive `xblLength`. A hand-written
 * placeholder (or a client-supplied flag) does not satisfy this.
 */
export function isGenuineCapability(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Record<string, unknown>;
  if (typeof e.verifiedAt !== "string" || Number.isNaN(new Date(e.verifiedAt).getTime())) {
    return false;
  }
  if (
    typeof e.projectSha256 !== "string" ||
    typeof e.referenceSha256 !== "string" ||
    !HEX_64.test(e.projectSha256) ||
    e.projectSha256 !== e.referenceSha256
  ) {
    return false;
  }
  return typeof e.xblLength === "number" && Number.isInteger(e.xblLength) && e.xblLength > 0;
}

/** True when `.local-data/capabilities.json` holds a genuine `meMbsXblVerified`. */
export function hasMeMbsXblVerified(filePath = defaultCapabilitiesPath()): boolean {
  return isGenuineCapability(readCapabilities(filePath)["meMbsXblVerified"]);
}
