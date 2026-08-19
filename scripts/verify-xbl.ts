/**
 * verify-xbl — compares a TypeScript XBL generator against a reference XBL
 * produced by the real MAPS desktop tool for the same project.
 *
 * Usage:
 *   pnpm verify:xbl <project.(ibmaps|zip)> <reference.(bin|xbl)> \
 *     [--family knx-mbm|me-mbs] [--app-id N] [--mask-timestamp] \
 *     [--sw-version a.b.c.d] [--now ISO-8601]
 *
 * - `project`: the MAPS project. Either the raw .ibmaps XML or a ZIP/complete
 *   blob containing exactly one .ibmaps entry.
 * - `reference`: the MAPS-generated XBL. Either a complete blob
 *   (`[4B len][XBL][4B CRC32][zip]`) or a raw XBL TLV payload.
 * - `--family`: which generator to exercise (default `knx-mbm`). The recorded
 *   capability key is per family (`knxMbmXblVerified` / `meMbsXblVerified`).
 * - `--app-id`: AppId for header tag 6 (IntesisXBL.cs:149). Default is the
 *   family's connected-device AppId (4 for KNX–MBM, 64 for ME–MBS on a 770
 *   Air). The ME–MBS project XML only carries the project CompatibilityID
 *   (8), never the unit's AppId, so 64 cannot be derived from the project.
 * - `--sw-version`: MAPS tool version quad written into header tag 2. The
 *   generator cannot derive it from the project XML (MAPS writes the tool's
 *   own version), so by default it is EXTRACTED from the reference header
 *   (top-level tag 1 → child tag 2). This flag overrides that. Intentionally
 *   not masked: a version mismatch is a real difference to investigate.
 * - `--mask-timestamp`: zero the volatile 6-byte generation timestamp (header
 *   tag 4, located structurally in both buffers) before comparing. Without
 *   it, pass `--now` matching the reference's generation time instead.
 * - `--now`: timestamp injected into the generator (defaults to current time).
 *
 * Exit codes: 0 = byte-identical match; 1 = divergence; 2 = usage/setup error.
 *
 * On a full match, the result is recorded in `.local-data/capabilities.json`
 * under the family's capability key (see docs/knx-mbm-mvp.md, Iteració 8 /
 * Pas 2.4). Nothing reads that artefact yet; the deploy UI stays disabled
 * until a follow-up iteration wires it up.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractIbmaps, parseCompleteBlob } from "@/core/project-format";
import { decodeElements, type DecodedElement } from "@/core/xbl";
import { generateKnxMbmXbl } from "@/gateway-families/knx-mbm";
import { generateMeMbsXbl } from "@/gateway-families/me-mbs";

interface FamilySpec {
  generate: (projectXml: string, options: { now: Date; swVersion: [number, number, number, number]; appId?: number }) => Uint8Array;
  capabilityKey: string;
}

const FAMILIES: Record<string, FamilySpec> = {
  "knx-mbm": { generate: generateKnxMbmXbl, capabilityKey: "knxMbmXblVerified" },
  "me-mbs": { generate: generateMeMbsXbl, capabilityKey: "meMbsXblVerified" },
};

interface CliOptions {
  projectPath: string;
  referencePath: string;
  family: string;
  appId?: number;
  maskTimestamp: boolean;
  swVersion?: [number, number, number, number];
  now?: Date;
}

function usage(): never {
  console.error(
    "Usage: pnpm verify:xbl <project.(ibmaps|zip)> <reference.(bin|xbl)> " +
      "[--family knx-mbm|me-mbs] [--app-id N] [--mask-timestamp] " +
      "[--sw-version a.b.c.d] [--now ISO-8601]",
  );
  process.exit(2);
}

function fail(message: string): never {
  console.error(`verify-xbl: ${message}`);
  process.exit(2);
}

function parseSwVersion(value: string): [number, number, number, number] {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    fail(`invalid --sw-version "${value}" (expected a.b.c.d with bytes 0-255)`);
  }
  return parts as [number, number, number, number];
}

function parseArgs(argv: string[]): CliOptions {
  const positional: string[] = [];
  const opts: Partial<CliOptions> = { maskTimestamp: false, family: "knx-mbm" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--mask-timestamp") {
      opts.maskTimestamp = true;
    } else if (arg === "--family") {
      const value = argv[++i];
      if (!value || !(value in FAMILIES)) {
        fail(`invalid --family "${value ?? ""}" (expected one of: ${Object.keys(FAMILIES).join(", ")})`);
      }
      opts.family = value;
    } else if (arg === "--app-id") {
      const value = argv[++i];
      const appId = Number(value);
      if (!value || !Number.isInteger(appId) || appId < 0 || appId > 255) {
        fail(`invalid --app-id "${value ?? ""}" (expected a byte 0-255)`);
      }
      opts.appId = appId;
    } else if (arg === "--sw-version") {
      const value = argv[++i];
      if (!value) usage();
      opts.swVersion = parseSwVersion(value);
    } else if (arg === "--now") {
      const value = argv[++i];
      if (!value) usage();
      const now = new Date(value);
      if (Number.isNaN(now.getTime())) fail(`invalid --now "${value}"`);
      opts.now = now;
    } else if (arg.startsWith("--")) {
      fail(`unknown option "${arg}"`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 2) usage();
  return {
    projectPath: positional[0],
    referencePath: positional[1],
    family: opts.family ?? "knx-mbm",
    appId: opts.appId,
    maskTimestamp: opts.maskTimestamp ?? false,
    swVersion: opts.swVersion,
    now: opts.now,
  };
}

/** Reads the project XML from a raw .ibmaps file, a project ZIP or a complete blob. */
function readProjectXml(filePath: string): string {
  const bytes = new Uint8Array(readFileSync(filePath));
  // A standalone project ZIP starts with PK.
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return extractIbmaps(bytes).xml;
  }
  // A complete blob ([4B len][XBL][4B CRC][zip]) embeds the project ZIP.
  try {
    return extractIbmaps(parseCompleteBlob(bytes).zip).xml;
  } catch {
    return Buffer.from(bytes).toString("utf-8");
  }
}

/** Extracts the XBL payload from a complete blob, or takes the file as-is. */
function readReferenceXbl(filePath: string): Uint8Array {
  const bytes = new Uint8Array(readFileSync(filePath));
  try {
    return parseCompleteBlob(bytes).xbl;
  } catch {
    return bytes;
  }
}

function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function tryDecode(xbl: Uint8Array, what: string): DecodedElement[] {
  try {
    return decodeElements(xbl);
  } catch (cause) {
    fail(`cannot decode ${what} as XBL: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/** Locates the 6-byte generation timestamp (header tag 1 → child tag 4). */
function timestampOffset(xbl: Uint8Array): number {
  const top = tryDecode(xbl, "XBL payload");
  const header = top.find((el) => el.tag === 1 && el.kind === "container");
  if (!header) fail("XBL has no header container (top-level tag 1)");
  const ts = header.children?.find((c) => c.tag === 4);
  if (!ts || ts.contentLength !== 6) {
    fail("header has no 6-byte timestamp node (tag 4)");
  }
  return ts.contentOffset;
}

function swVersionFromReference(xbl: Uint8Array): [number, number, number, number] {
  const top = tryDecode(xbl, "reference");
  const header = top.find((el) => el.tag === 1 && el.kind === "container");
  const sw = header?.children?.find((c) => c.tag === 2);
  if (!sw || sw.contentLength !== 4) {
    fail("cannot extract SW version from reference (header tag 2); pass --sw-version");
  }
  return Array.from(
    xbl.subarray(sw.contentOffset, sw.contentOffset + 4),
  ) as [number, number, number, number];
}

function hexContext(data: Uint8Array, offset: number): string {
  const start = Math.max(0, offset - 16);
  const end = Math.min(data.length, offset + 16);
  return Array.from(data.subarray(start, end))
    .map((b, i) => (start + i === offset ? `[${b.toString(16).padStart(2, "0")}]` : b.toString(16).padStart(2, "0")))
    .join(" ");
}

function recordCapability(
  capabilityKey: string,
  input: {
    projectSha256: string;
    referenceSha256: string;
    xblLength: number;
    maskedTimestamp: boolean;
    swVersion: string;
    appId?: number;
  },
): string {
  const dir = path.join(process.cwd(), ".local-data");
  const file = path.join(dir, "capabilities.json");
  let capabilities: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      capabilities = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
    } catch {
      fail(`.local-data/capabilities.json exists but is not valid JSON`);
    }
  }
  capabilities[capabilityKey] = {
    verifiedAt: new Date().toISOString(),
    ...input,
  };
  mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.capabilities.json.tmp-${process.pid}-${Date.now()}`);
  writeFileSync(tmp, JSON.stringify(capabilities, null, 2) + "\n");
  renameSync(tmp, file);
  return file;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const family = FAMILIES[opts.family];
  const projectXml = readProjectXml(opts.projectPath);
  const reference = readReferenceXbl(opts.referencePath);
  const swVersion = opts.swVersion ?? swVersionFromReference(reference);

  let generated: Uint8Array;
  try {
    generated = family.generate(projectXml, {
      now: opts.now ?? new Date(),
      swVersion,
      appId: opts.appId,
    });
  } catch (cause) {
    fail(`generation failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  const generatedCmp = new Uint8Array(generated);
  const referenceCmp = new Uint8Array(reference);
  if (opts.maskTimestamp) {
    generatedCmp.fill(0, timestampOffset(generatedCmp), timestampOffset(generatedCmp) + 6);
    referenceCmp.fill(0, timestampOffset(referenceCmp), timestampOffset(referenceCmp) + 6);
  }

  if (
    generatedCmp.length !== referenceCmp.length ||
    !generatedCmp.every((b, i) => b === referenceCmp[i])
  ) {
    console.error(`verify-xbl: XBL DIVERGES (generated ${generatedCmp.length}B vs reference ${referenceCmp.length}B)`);
    const firstDiff =
      generatedCmp.length === referenceCmp.length
        ? generatedCmp.findIndex((b, i) => b !== referenceCmp[i])
        : Math.min(generatedCmp.length, referenceCmp.length);
    if (firstDiff >= 0 && generatedCmp.length === referenceCmp.length) {
      console.error(`first difference at offset ${firstDiff}:`);
      console.error(`  generated: ${hexContext(generatedCmp, firstDiff)}`);
      console.error(`  reference: ${hexContext(referenceCmp, firstDiff)}`);
    }
    process.exit(1);
  }

  const file = recordCapability(family.capabilityKey, {
    projectSha256: sha256(readFileSync(opts.projectPath)),
    referenceSha256: sha256(readFileSync(opts.referencePath)),
    xblLength: generated.length,
    maskedTimestamp: opts.maskTimestamp,
    swVersion: swVersion.join("."),
    appId: opts.appId,
  });
  console.log(`verify-xbl: MATCH — ${generated.length} bytes identical to reference.`);
  console.log(`verify-xbl: capability "${family.capabilityKey}" recorded in ${file}`);
}

main();
