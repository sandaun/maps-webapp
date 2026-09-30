import type { GatewayInfoSummary } from "../intesis-transport";

/**
 * Gateway compatibility of a 700 Series project, as MAPS decides it before
 * connecting and sending (`frmMain.ButtonConnect`, `IntesisProject.EvaluateConnectionWithGw`
 * and `IntesisLicense.CheckDeviceAppId`), and the per-signal deadband firmware
 * warning (`IntesisProject.CheckDeadbandFwCompatibility`).
 *
 * The three supported classes have no `AllowedCompIds` and no project license
 * (`GetProjectLicense` = -1), so the compId and license checks never reject.
 * MAPS Web has no firmware catalog: where MAPS would change the gateway
 * firmware (`NEED_SWAP`), the deploy is rejected with the reason. The license
 * fix MAPS applies to some units first (`LICENSE_FIX_REQUIRED`: license 4 and
 * a serial number in its embedded list, `LicenseFixManager`) is not checked.
 */

/** The MAPS project class the gateway must accept. */
export interface ProjectClassIdentity {
  displayName: string;
  unitLabel: string;
  /** `ApplicationIDs` of the class. */
  applicationIds: readonly number[];
  /** The blank firmware `CheckDeviceAppId` accepts for the class (IN_XXX_XXX 63, XX_AC_XXX 61). */
  blankAppId: number;
}

export interface GatewayCompatibility {
  ok: boolean;
  detail: string;
}

/** `IntesisLicense.IsFwBlanco`: XX_AC_XXX, IN_XXX_XXX and XX_CTR_XXX. */
const BLANK_FIRMWARE_APP_IDS = new Set([61, 63, 80]);

/** The platform `DiscoveredDevice` reports for S700 units. */
const SERIES_700 = "700 Series";

export function evaluateGatewayCompatibility(
  project: ProjectClassIdentity,
  gateway: GatewayInfoSummary | undefined,
): GatewayCompatibility {
  if (gateway?.noApp || gateway?.bootloader) {
    return { ok: false, detail: "Gateway is in Bootloader Mode. Please, download a valid firmware." };
  }
  if (gateway?.platform === undefined) {
    // `message_v6projectNecessary`: a 700 Series project on a gateway without a platform.
    return {
      ok: false,
      detail:
        "Current 700 Series project is not compatible with legacy gateways. " +
        "Please, create a new legacy project to configure this gateway",
    };
  }
  if (gateway.platform !== SERIES_700) {
    return {
      ok: false,
      detail: `The gateway reports platform "${gateway.platform}": a 700 Series project needs a 700 Series gateway.`,
    };
  }
  const appId = gateway.appId;
  if (appId !== undefined && project.applicationIds.includes(appId)) {
    return { ok: true, detail: `Gateway reports AppId ${appId} (${project.unitLabel})` };
  }
  if (appId === project.blankAppId) {
    return {
      ok: false,
      detail:
        `The gateway has no application firmware (AppId ${appId}). MAPS loads the ${project.displayName} ` +
        "firmware before sending the project; MAPS Web cannot change the gateway firmware yet.",
    };
  }
  const expected = project.applicationIds.join(" or ");
  const firmwareSwap = appId !== undefined && !BLANK_FIRMWARE_APP_IDS.has(appId)
    ? " MAPS offers to change the gateway firmware when it has one for this project; MAPS Web cannot change it yet."
    : "";
  return {
    ok: false,
    detail:
      `Gateway AppId ${appId ?? "unknown"} is not compatible with a ${project.displayName} project ` +
      `(AppId ${expected}).${firmwareSwap}`,
  };
}

/**
 * `System.Version.TryParse`: two to four non-negative integers; the missing
 * components are -1, so "2.0.2" sorts before "2.0.2.0".
 */
function parseVersion(value: string): number[] | undefined {
  const parts = value.trim().split(".");
  if (parts.length < 2 || parts.length > 4 || parts.some((part) => !/^\d+$/.test(part.trim()))) return undefined;
  const numbers = parts.map((part) => Number(part.trim()));
  while (numbers.length < 4) numbers.push(-1);
  return numbers;
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * `CheckDeadbandFwCompatibility`: the connected gateway runs a firmware older
 * than the class's `MinFwVersionForPerSignalDeadband`. Like MAPS, it does not
 * look at the signal values, and says nothing when there is no minimum, no
 * gateway or a version it cannot parse.
 */
export function deadbandFirmwareWarning(
  minVersion: string | undefined,
  appVersion: string | undefined,
): string | undefined {
  if (!minVersion || appVersion === undefined) return undefined;
  const min = parseVersion(minVersion);
  const current = parseVersion(appVersion);
  if (!min || !current || compareVersions(current, min) >= 0) return undefined;
  // `message_deadbandFwTooOld`.
  return "You need the newest version of FW for the deadband feature to operate, please update and try again.";
}
