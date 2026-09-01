import "server-only";
import { buildCompleteBlob, buildProjectZip, parseCompleteBlob } from "@/core/project-format";
import { decodeElements, DEFAULT_SW_VERSION } from "@/core/xbl";
import { APP_ID_KNX_MBM, generateKnxMbmXbl } from "@/gateway-families/knx-mbm";
import { APP_ID_ME_AC_XXX, generateMeMbsXbl } from "@/gateway-families/me-mbs";
import { getGatewaySessionManager, type GatewaySessions } from "../intesis-transport";
import { getProjectStore } from "../persistence";
import { getProjectView, snapshotDeploy } from "../projects/service";
import { defaultCapabilitiesPath, hasCapability } from "./capabilities";

/**
 * Deploy service: writes a (possibly modified) project to a gateway via
 * SENDCMPLT. Gated at every layer (docs/knx-mbm-mvp.md, Pas 2.6 / 3.4):
 *
 * 1. `family` — the project's family must have a deploy descriptor below
 *    (knx-mbm and me-mbs today; anything else stays 422).
 * 2. `capability` — `.local-data/capabilities.json` must hold a genuine
 *    per-family entry (`knxMbmXblVerified` / `meMbsXblVerified`), written only
 *    by scripts/verify-xbl.ts after a byte-exact match against a real fixture.
 *    Read from disk here; no client flag is ever trusted.
 * 3. `session-appid` — the live session's gateway INFO must report the
 *    family's unit AppId (4 for KNX–MBM, 64 for ME–MBS on the 770 Air), so a
 *    project can never be pushed to a gateway of a different family.
 *
 * The XBL is REGENERATED from the current project XML (never the original
 * blob's XBL) so user edits take effect; the firmware only runs config from
 * the XBL (PROTOCOL.md §10, SENDPROJ experiment).
 */

export type DeployGateId = "family" | "capability" | "session-appid";

/** Gate failure carrying an HTTP status, rendered by projects/http.ts. */
export class DeployGateError extends Error {
  constructor(
    readonly status: number,
    readonly gate: DeployGateId,
    message: string,
  ) {
    super(message);
    this.name = "DeployGateError";
  }
}

export interface DeployGateCheck {
  id: DeployGateId;
  ok: boolean;
  detail: string;
}

export interface DeployStatus {
  deployable: boolean;
  checks: DeployGateCheck[];
}

export interface DeployResult {
  projectId: string;
  sessionId: string;
  /** Total blob bytes sent over XMODEM-1K. */
  bytes: number;
  xblBytes: number;
  zipBytes: number;
  appId: number;
  swVersion: string;
}

export interface DeployDeps {
  /** Defaults to the process-wide session manager singleton. */
  sessions?: GatewaySessions;
  /** Defaults to `.local-data/capabilities.json`. */
  capabilitiesPath?: string;
}

type XblGenerator = (
  projectXml: string,
  options: {
    now?: Date;
    swVersion?: readonly [number, number, number, number];
    appId?: number;
  },
) => Uint8Array;

/** Everything the deploy path needs to know about a gateway family. */
export interface DeployFamilyDescriptor {
  /** Project family id (`ProjectView.family`). */
  family: string;
  /** Human-readable family name for gate details. */
  displayName: string;
  /** Capability key in `.local-data/capabilities.json` gating this family. */
  capabilityKey: string;
  /** AppId the connected gateway's INFO must report for this family. */
  expectedAppId: number;
  /** Short unit label for gate details (e.g. "ME unit"). */
  unitLabel: string;
  /** Byte-exact verified XBL generator for this family. */
  generateXbl: XblGenerator;
}

/**
 * Families allowed to deploy, keyed by family id. A family only appears here
 * once its XBL generator is byte-exact verified against a real fixture; the
 * `family` gate rejects everything else with 422. Exported (and mutable) so
 * tests can exercise the unsupported-family path.
 */
export const DEPLOY_FAMILIES: Partial<Record<string, DeployFamilyDescriptor>> = {
  "knx-mbm": {
    family: "knx-mbm",
    displayName: "KNX ↔ Modbus Master",
    capabilityKey: "knxMbmXblVerified",
    expectedAppId: APP_ID_KNX_MBM, // 4 — IN701KNX reports AppId 4
    unitLabel: "KNX–MBM unit",
    generateXbl: generateKnxMbmXbl,
  },
  "me-mbs": {
    family: "me-mbs",
    displayName: "Mitsubishi Electric AC ↔ Modbus Slave",
    capabilityKey: "meMbsXblVerified",
    expectedAppId: APP_ID_ME_AC_XXX, // 64 — ME_AC_XXX on the 770 Air
    unitLabel: "ME unit",
    generateXbl: generateMeMbsXbl,
  },
};

/**
 * MAPS tool version quad for the XBL header tag 2. MAPS writes the version of
 * the tool that compiled the XBL; it is not derivable from the project XML.
 * When the project keeps its original gateway blob we reuse that blob's
 * header version (same convention as scripts/verify-xbl.ts); otherwise the
 * generator default (DEFAULT_SW_VERSION, the verified fixture's 1.2.31.0).
 */
function swVersionFromOriginalBlob(xbl: Uint8Array): [number, number, number, number] | undefined {
  try {
    const header = decodeElements(xbl).find((el) => el.tag === 1 && el.kind === "container");
    const sw = header?.children?.find((c) => c.tag === 2);
    if (!sw || sw.contentLength !== 4) return undefined;
    return Array.from(xbl.subarray(sw.contentOffset, sw.contentOffset + 4)) as [
      number,
      number,
      number,
      number,
    ];
  } catch {
    return undefined;
  }
}

async function runGates(
  projectId: string,
  sessionId: string,
  deps: DeployDeps,
): Promise<{ checks: DeployGateCheck[]; appId?: number; descriptor?: DeployFamilyDescriptor }> {
  const view = await getProjectView(projectId); // 404 propagates
  const checks: DeployGateCheck[] = [];

  const descriptor = DEPLOY_FAMILIES[view.family];
  checks.push({
    id: "family",
    ok: descriptor !== undefined,
    detail: descriptor
      ? `${descriptor.displayName} project`
      : "Only projects of a family with a verified XBL generator can be deployed",
  });

  const capabilityOk =
    descriptor !== undefined &&
    hasCapability(descriptor.capabilityKey, deps.capabilitiesPath ?? defaultCapabilitiesPath());
  checks.push({
    id: "capability",
    ok: capabilityOk,
    detail: !descriptor
      ? "No deployable family — capability not evaluated"
      : capabilityOk
        ? `XBL generator byte-exact verified (${descriptor.capabilityKey})`
        : `Missing verified XBL capability (${descriptor.capabilityKey}) — run pnpm verify:xbl against a real fixture`,
  });

  let appId: number | undefined;
  let sessionOk = false;
  let sessionDetail = "No gateway session";
  try {
    const status = (deps.sessions ?? getGatewaySessionManager()).getStatus(sessionId);
    appId = status.gateway?.appId;
    if (!status.connected) {
      sessionDetail = "The gateway session is not connected";
    } else if (!descriptor) {
      sessionDetail = "No deployable family — session AppId not evaluated";
    } else if (appId === descriptor.expectedAppId) {
      sessionOk = true;
      sessionDetail = `Gateway reports AppId ${descriptor.expectedAppId} (${descriptor.unitLabel})`;
    } else {
      sessionDetail = `Gateway AppId ${appId ?? "unknown"} does not match the ${descriptor.unitLabel} AppId ${descriptor.expectedAppId}`;
    }
  } catch {
    sessionDetail = "Gateway session not found";
  }
  checks.push({ id: "session-appid", ok: sessionOk, detail: sessionDetail });

  return { checks, appId, descriptor };
}

/** Evaluate the deploy gates without side effects (drives the UI state). */
export async function getDeployStatus(
  projectId: string,
  sessionId: string,
  deps: DeployDeps = {},
): Promise<DeployStatus> {
  const { checks } = await runGates(projectId, sessionId, deps);
  return { deployable: checks.every((c) => c.ok), checks };
}

/**
 * Regenerate the XBL and deploy the project to the session's gateway.
 * Throws `DeployGateError` (typed per gate) when any gate fails.
 */
export async function deployProject(
  projectId: string,
  sessionId: string,
  deps: DeployDeps = {},
): Promise<DeployResult> {
  const sessions = deps.sessions ?? getGatewaySessionManager();
  const { checks, appId, descriptor } = await runGates(projectId, sessionId, deps);
  for (const check of checks) {
    if (check.ok) continue;
    const status =
      check.id === "capability" ? 403 : check.id === "session-appid" ? 409 : 422;
    throw new DeployGateError(status, check.id, check.detail);
  }
  // All gates passed, so the family gate passed: the descriptor exists.
  if (!descriptor) throw new DeployGateError(422, "family", "Unsupported family");

  const store = getProjectStore();
  const xml = await store.readXml(projectId);

  let swVersion: readonly [number, number, number, number] = DEFAULT_SW_VERSION;
  if (await store.hasCompleteBlob(projectId)) {
    const original = parseCompleteBlob(await store.readCompleteBlob(projectId));
    swVersion = swVersionFromOriginalBlob(original.xbl) ?? DEFAULT_SW_VERSION;
  }

  const xbl = descriptor.generateXbl(xml, { appId, swVersion });
  const zip = buildProjectZip(`${projectId}.ibmaps`, xml);
  const blob = buildCompleteBlob(xbl, zip);

  const view = await getProjectView(projectId);
  await sessions.sendComplete(sessionId, blob, {
    name: view.meta.name,
    comments: "maps-webapp deploy",
  });

  await snapshotDeploy(projectId);

  return {
    projectId,
    sessionId,
    bytes: blob.length,
    xblBytes: xbl.length,
    zipBytes: zip.length,
    appId: appId ?? descriptor.expectedAppId,
    swVersion: swVersion.join("."),
  };
}
