import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

/**
 * The project ZIP embedded in the "complete" blob holds one `.ibmaps` file
 * (XML, UTF-8 with BOM as written by the desktop MAPS tool).
 */
export interface IbmapsFile {
  /** Entry name inside the ZIP, e.g. "MyProject.ibmaps". */
  name: string;
  /** Full XML text, BOM included if present. */
  xml: string;
}

export function extractIbmaps(zip: Uint8Array): IbmapsFile {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip);
  } catch (cause) {
    throw new Error("Invalid project ZIP", { cause });
  }
  const names = Object.keys(entries).filter((n) => n.toLowerCase().endsWith(".ibmaps"));
  if (names.length !== 1) {
    throw new Error(`Expected exactly one .ibmaps entry in the ZIP, found ${names.length}`);
  }
  const bytes = entries[names[0]];
  // TextDecoder strips a leading UTF-8 BOM; restore it so the XML text is
  // byte-faithful to the original .ibmaps.
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  return { name: names[0], xml: (hasBom ? "\uFEFF" : "") + strFromU8(bytes) };
}

/**
 * Deterministic ZIP: fixed entry and fixed mtime so identical input produces
 * identical bytes (required by the round-trip stability criterion).
 */
export function buildProjectZip(name: string, xml: string): Uint8Array {
  const entryName = name.toLowerCase().endsWith(".ibmaps") ? name : `${name}.ibmaps`;
  return zipSync(
    { [entryName]: [strToU8(xml), { level: 6, mtime: new Date(1980, 0, 1, 0, 0, 0) }] },
    { level: 6 },
  );
}
