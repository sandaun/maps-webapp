import { APP_ID_KNX_MBM } from "@/gateway-families/knx-mbm";
import { APP_ID_ME_AC_XXX } from "@/gateway-families/me-mbs";

/** Console protocol prefixes of a gateway application: port 0 (internal) and 1 (external). */
export type ConsolePrefixes = readonly [internal: string, external: string];

/**
 * Per-AppId console prefixes (docs/reference/console-protocol.md §2): the
 * monitor toggles are `<port><PREFIX>:SPONS=1` — the firmware ignores the
 * unprefixed `0:SPONS=1` in silence (live-validated 2026-09-25 on the
 * KNX–MBM). Values are the decompiled MAPS `GetPrefix()` of each protocol
 * (frmMain.cs:2153 builds `"0" + GetInternalPrefix() + ":SPONS=1"`).
 */
const CONSOLE_PREFIXES: Partial<Record<number, ConsolePrefixes>> = {
  [APP_ID_KNX_MBM]: ["KX", "MM"], // InternalKnx / ExternalMbm
  [APP_ID_ME_AC_XXX]: ["MS", "ME"], // InternalMbs / ExternalME
};

/** Prefixes for the connected gateway's AppId; undefined when unknown. */
export function consolePrefixesFor(appId: number | undefined): ConsolePrefixes | undefined {
  return appId === undefined ? undefined : CONSOLE_PREFIXES[appId];
}
