import { GROUP_TYPES, type MEGroupType } from "@/protocols/me/types";

/**
 * Parser for the M-NET bus scan stream (`1ME:CMD:BUSSCAN,<typeIndex>,<ip>:<port>`,
 * docs/reference/console-protocol.md). Mirrors the desktop implementation
 * (`IntesisBoxMAPS.Protocols.ME`: frmDiscoverMe.cs ParseScannedGroup /
 * ValidateScannedLine, IntesisMe.cs GetModelIdxFromString /
 * GetFanSpeedFromString). Pure functions: no I/O, no server-only imports.
 */

/** One group reported by the controller during a bus scan. */
export interface ScannedMeGroup {
  /** M-NET group index, 1-based (`GROUP[n]` token). */
  group: number;
  /** M-NET unit addresses of the group (`ADDRESS[x]` tokens, deduped). */
  addresses: number[];
  /** Raw `MODEL[...]` value as read from the controller. */
  model: string;
  /** Mapped group type (`GROUP_TYPES`, from the model string). */
  type: MEGroupType;
  /** Mapped `NumOfFanSpeeds` (0 = none, 2/3/4 stages). */
  fanSpeeds: number;
  fanAuto: string;
  fanExlow: string;
  /** URC = remote controller with humidity/brightness/occupancy sensors. */
  urc: boolean;
  /** -1 = unknown. */
  capacity: number;
}

export type BusScanLineKind = "ok" | "end" | "error" | "group" | "progress" | "other";

export interface BusScanResult {
  ok: boolean;
  groups: ScannedMeGroup[];
  error?: string;
}

const INTEGER_RE = /^-?\d+$/;

/** Extracts the value of a `KEY[value]` token (desktop `TypeUtils.ParseParameter`). */
function tokenValue(token: string): string | null {
  const open = token.indexOf("[");
  const close = token.lastIndexOf("]");
  if (open === -1 || close === -1 || close <= open) return null;
  return token.slice(open + 1, close);
}

/** Desktop `IntesisMe.GetModelIdxFromString`. */
function meGroupTypeFromModel(model: string): MEGroupType {
  switch (model) {
    case "IC":
    case "KIC":
    case "AIC":
      return GROUP_TYPES.IC;
    case "LC":
      return GROUP_TYPES.LC;
    case "FU":
      return GROUP_TYPES.FU;
    case "BU":
      return GROUP_TYPES.BU;
    case "WH":
      return GROUP_TYPES.WH;
    case "CEh":
      return GROUP_TYPES.CEH;
    default:
      return GROUP_TYPES.SYS_COMPONENT;
  }
}

/** Desktop `IntesisMe.GetFanSpeedFromString`: an enabled EXLOW switch forces 3. */
function meFanSpeedsFromScan(fanSpeed: string, fanExlow: string): number {
  if (fanExlow === "ENABLE") return 3;
  switch (fanSpeed) {
    case "2STAGES":
      return 2;
    case "3STAGES":
      return 3;
    case "4STAGES":
      return 4;
    default: // NONE or unknown
      return 0;
  }
}

/**
 * Classifies one line of the BUSSCAN response stream. Terminators are checked
 * first: a `CMD:BUSSCAN:END` line must never fall through to "progress".
 */
export function classifyBusScanLine(line: string): BusScanLineKind {
  if (line.includes("BUSSCAN:ERR") || line.includes("1ME:CMD:ERR")) return "error";
  if (line.includes("CMD:BUSSCAN:END")) return "end";
  if (line.includes("CMD:BUSSCAN:GROUP")) return "group";
  if (line.includes("1ME:CMD:OK")) return "ok";
  if (line.includes("%")) return "progress";
  return "other";
}

/**
 * Parses one `...CMD:BUSSCAN:GROUP[...]` line. Returns null when the line
 * fails the desktop validation (ValidateScannedLine) or the URC rule: an
 * address > 50 flags the outdoor/URC side, and the next MODEL token must then
 * be `URC` — any other model makes the line invalid.
 */
export function parseBusScanGroupLine(line: string): ScannedMeGroup | null {
  const tokens = line.split(":");
  if (tokens.length < 5) return null;
  if (!line.includes("GROUP[")) return null;
  if (!line.includes("ADDRESS[") && !line.includes("FANSPEEDSW[")) return null;
  const groupValue = tokenValue(tokens[3] ?? "");
  if (groupValue === null || !INTEGER_RE.test(groupValue)) return null;
  const capacityToken = tokens.find((token) => token.startsWith("CAPACITY["));
  if (capacityToken) {
    const value = tokenValue(capacityToken);
    if (value === null || !INTEGER_RE.test(value)) return null;
  }

  const group = Number.parseInt(groupValue, 10);
  const addresses: number[] = [];
  let model = "";
  let fanSpeed = "";
  let fanAuto = "";
  let fanExlow = "";
  let urc = false;
  let capacity = -1;
  let outdoorFlag = false;

  for (const token of tokens) {
    if (token.startsWith("ADDRESS[")) {
      const value = tokenValue(token);
      if (value === null || !INTEGER_RE.test(value)) return null;
      const address = Number.parseInt(value, 10);
      if (address > 50) outdoorFlag = true;
      if (!addresses.includes(address)) addresses.push(address);
    } else if (token.startsWith("MODEL[")) {
      const value = tokenValue(token) ?? "";
      if (outdoorFlag) {
        if (value === "URC") {
          urc = true;
          continue;
        }
        return null; // outdoor-side flag followed by a non-URC model
      }
      model = value;
    } else if (token.startsWith("FANSPEEDSW[")) {
      fanSpeed = tokenValue(token) ?? "";
    } else if (token.startsWith("FANAUTOSW[")) {
      fanAuto = tokenValue(token) ?? "";
    } else if (token.startsWith("FANEXLOWSW[")) {
      fanExlow = tokenValue(token) ?? "";
    } else if (token.startsWith("CAPACITY[")) {
      capacity = Number.parseInt(tokenValue(token) ?? "", 10);
    }
  }

  return {
    group,
    addresses,
    model,
    type: meGroupTypeFromModel(model),
    fanSpeeds: meFanSpeedsFromScan(fanSpeed, fanExlow),
    fanAuto,
    fanExlow,
    urc,
    capacity,
  };
}

/**
 * Reduces a whole BUSSCAN response to the scan outcome. Group lines that fail
 * validation are discarded; repeated lines for the same group merge their
 * address lists (the gateway may emit a group in chunks). `ok` requires the
 * `CMD:BUSSCAN:END` terminator and no error line.
 */
export function parseBusScanResult(lines: string[]): BusScanResult {
  const byGroup = new Map<number, ScannedMeGroup>();
  let ended = false;
  let error: string | undefined;

  for (const line of lines) {
    const kind = classifyBusScanLine(line);
    if (kind === "error") {
      error = error ?? line.trim();
      continue;
    }
    if (kind === "end") {
      ended = true;
      continue;
    }
    if (kind !== "group") continue;
    const parsed = parseBusScanGroupLine(line);
    if (!parsed) continue;
    const existing = byGroup.get(parsed.group);
    if (existing) {
      parsed.addresses = [...new Set([...existing.addresses, ...parsed.addresses])];
    }
    byGroup.set(parsed.group, parsed);
  }

  const groups = [...byGroup.values()].sort((a, b) => a.group - b.group);
  if (error) return { ok: false, groups, error };
  if (!ended) {
    return { ok: false, groups, error: "Scan did not complete (no CMD:BUSSCAN:END received)" };
  }
  return { ok: true, groups };
}
