import "server-only";
import { buildCompleteBlob, buildProjectZip, parseCompleteBlob, XmlDocument } from "@/core/project-format";
import { decodeElements, DEFAULT_SW_VERSION } from "@/core/xbl";
import { APP_ID_KNX_MBM, generateKnxMbmXbl } from "@/gateway-families/knx-mbm";
import { APP_ID_ME_AC_XXX, generateMeMbsXbl, validateSlaveIndices } from "@/gateway-families/me-mbs";
import { APP_ID_MBS_KNX, generateMbsKnxXbl } from "@/gateway-families/mbs-knx";
import { getGatewaySessionManager, type GatewaySessions } from "../intesis-transport";
import { getProjectStore } from "../persistence";
import { beginProjectDeploy, getProjectSnapshot, snapshotDeploy, type ProjectView } from "../projects/service";
import { hasValidProjectPassword } from "../projects/password";
import { defaultCapabilitiesPath, hasCapability } from "./capabilities";
import { evaluateGatewayCompatibility, type ProjectClassIdentity } from "./gateway-compat";

/**
 * Deploy service: writes a (possibly modified) project to a gateway via
 * SENDCMPLT. Gated at every layer (docs/plans/knx-mbm-mvp.md, Pas 2.6 / 3.4):
 *
 * 1. `family` — the project's family must have a deploy descriptor below
 *    (knx-mbm, me-mbs and mbs-knx; anything else stays 422).
 * 2. `capability` — `.local-data/capabilities.json` must hold a genuine
 *    per-family entry (`knxMbmXblVerified` / `meMbsXblVerified`), written only
 *    by scripts/verify-xbl.ts after a byte-exact match against a real fixture.
 *    Read from disk here; no client flag is ever trusted.
 * 3. `session-appid` — the live session's gateway must accept the project as
 *    MAPS decides it (`gateway-compat.ts`): a 700 Series gateway whose INFO
 *    AppId is one of the class's `ApplicationIDs` (4 for KNX–MBM, 7 for
 *    MBS–KNX, 8 or 64 for ME–MBS), so a project can never be pushed to a
 *    legacy gateway or a gateway of a different family.
 * 4. `project` — families with deploy blockers (me-mbs: signals left on the
 *    wrong Modbus slave, `validateSlaveIndices`) must have none.
 * 5. `password` — MAPS requires a nonempty ASCII IBOX/Pwd for every supported family.
 *
 * The XBL is REGENERATED from the current project XML (never the original
 * blob's XBL) so user edits take effect; the firmware only runs config from
 * the XBL (PROTOCOL.md §10, SENDPROJ experiment).
 */

export type DeployGateId = "family" | "capability" | "session-appid" | "project" | "password";

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
export interface DeployFamilyDescriptor extends ProjectClassIdentity {
  /** Project family id (`ProjectView.family`). */
  family: string;
  /** Capability key in `.local-data/capabilities.json` gating this family. */
  capabilityKey: string;
  /** Byte-exact verified XBL generator for this family. */
  generateXbl: XblGenerator;
  /** Why the project must not reach the gateway, if anything. */
  deployBlocker?: (view: ProjectView) => string | undefined;
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
    applicationIds: [APP_ID_KNX_MBM], // 4 — IN701KNX reports AppId 4
    blankAppId: 63, // IN_XXX_XXX
    unitLabel: "KNX–MBM unit",
    generateXbl: generateKnxMbmXbl,
  },
  "me-mbs": {
    family: "me-mbs",
    displayName: "Mitsubishi Electric AC ↔ Modbus Slave",
    capabilityKey: "meMbsXblVerified",
    // IntesisProjectMbsMe_RT.ApplicationIDs: ME_AC_XXX (64, the 770 Air) and ME_AC_MBS (8).
    applicationIds: [APP_ID_ME_AC_XXX, 8],
    blankAppId: 61, // XX_AC_XXX
    unitLabel: "ME unit",
    generateXbl: generateMeMbsXbl,
    deployBlocker: (view) =>
      view.family === "me-mbs" ? validateSlaveIndices(view.project)[0]?.message : undefined,
  },
  "mbs-knx": {
    family: "mbs-knx",
    displayName: "KNX ↔ Modbus Slave",
    capabilityKey: "mbsKnxXblVerified",
    applicationIds: [APP_ID_MBS_KNX], // 7 — IN701KNX running the MBS–KNX application
    blankAppId: 63, // IN_XXX_XXX
    unitLabel: "MBS–KNX unit",
    generateXbl: generateMbsKnxXbl,
    // MAPS does not send a project that fails CheckProject (IntesisProjectMBSKNX_RT.cs:633-662).
    deployBlocker: (view) => view.issues.find((issue) => issue.severity === "error")?.message,
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
): Promise<{
  checks: DeployGateCheck[];
  view: ProjectView;
  xml: string;
  appId?: number;
  descriptor?: DeployFamilyDescriptor;
}> {
  // Validate precisely the XML that will be compiled and sent: a later project
  // edit must not substitute an unchecked project between gates and generation.
  const { view, xml } = await getProjectSnapshot(projectId); // 404 / 422 propagate
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
    } else {
      const compatibility = evaluateGatewayCompatibility(descriptor, status.gateway);
      sessionOk = compatibility.ok;
      sessionDetail = compatibility.detail;
    }
  } catch {
    sessionDetail = "Gateway session not found";
  }
  checks.push({ id: "session-appid", ok: sessionOk, detail: sessionDetail });

  if (descriptor?.deployBlocker) {
    const blocker = descriptor.deployBlocker(view);
    checks.push({ id: "project", ok: blocker === undefined, detail: blocker ?? "No project issue blocks the deploy" });
  }

  const passwordOk = hasValidProjectPassword(XmlDocument.parse(xml));
  checks.push({
    id: "password",
    ok: passwordOk,
    detail: passwordOk
      ? "Project password is valid"
      : "Set a valid project password in Configuration → Security before deploying.",
  });

  return { checks, view, xml, appId, descriptor };
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
  const finishDeploy = await beginProjectDeploy(projectId);
  try {
    const { checks, view, xml, appId, descriptor } = await runGates(projectId, sessionId, deps);
    for (const check of checks) {
      if (check.ok) continue;
      const status =
        check.id === "capability" ? 403 : check.id === "session-appid" ? 409 : 422;
      throw new DeployGateError(status, check.id, check.detail);
    }
    // All gates passed, so the family gate passed: the descriptor exists.
    if (!descriptor) throw new DeployGateError(422, "family", "Unsupported family");

    const store = getProjectStore();

    let swVersion: readonly [number, number, number, number] = DEFAULT_SW_VERSION;
    if (await store.hasCompleteBlob(projectId)) {
      const original = parseCompleteBlob(await store.readCompleteBlob(projectId));
      swVersion = swVersionFromOriginalBlob(original.xbl) ?? DEFAULT_SW_VERSION;
    }

    const xbl = descriptor.generateXbl(xml, { appId, swVersion });
    const zip = buildProjectZip(`${projectId}.ibmaps`, xml);
    const blob = buildCompleteBlob(xbl, zip);

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
      appId: appId ?? descriptor.applicationIds[0],
      swVersion: swVersion.join("."),
    };
  } finally {
    finishDeploy();
  }
}
