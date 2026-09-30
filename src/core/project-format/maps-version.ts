import type { XmlDocument } from "./xml/document";

/**
 * The MAPS desktop release MAPS Web has been checked against (the decompiled
 * source in docs/reference). MAPS Web keeps its own version (package.json);
 * this one only names the desktop behaviour we reproduce.
 */
export const MAPS_REFERENCE_VERSION = "1.2.34.0";

/** A MAPS version as `System.Version` writes it: four numbers, e.g. "1.2.34.0". */
export function isMapsVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+\.\d+$/.test(value.trim());
}

/** Negative, zero or positive, like a comparator. Both must pass `isMapsVersion`. */
export function compareMapsVersions(a: string, b: string): number {
  const pa = a.trim().split(".").map(Number);
  const pb = b.trim().split(".").map(Number);
  for (let i = 0; i < 4; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * The MAPS version that last saved the project (`<Header Version>`), which is
 * the version of MAPS its user works with; the reference version when missing.
 */
export function projectMapsVersion(doc: XmlDocument): string {
  const version = doc.getAttr(["Header"], "Version") ?? "";
  return isMapsVersion(version) ? version.trim() : MAPS_REFERENCE_VERSION;
}
