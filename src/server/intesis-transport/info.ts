import "server-only";

/**
 * Parser for the `INFO?` multiline response and the UDP discovery payload.
 * Format (PROTOCOL.md §8.5, live-validated): lines `INFO:KEY:VALUE`, closed by
 * `INFO:END`. The UDP discovery datagram adds a leading `IntesisBox` banner
 * line before the INFO lines (PROTOCOL.md §2.1).
 */

export interface GatewayInfo {
  /** All `INFO:KEY:VALUE` pairs, in arrival order (later duplicates win in `byKey`). */
  entries: { key: string; value: string }[];
  byKey: Record<string, string>;
  /** True when the response was properly closed with INFO:END. */
  complete: boolean;
}

/** Common typed accessors (all optional — firmware/model dependent). */
export interface GatewayInfoSummary {
  name?: string;
  serial?: string;
  appName?: string;
  appId?: number;
  appVersion?: string;
  platform?: string;
  mac?: string;
  ip?: string;
  netmask?: string;
  gateway?: string;
  dhcp?: boolean;
  status?: string;
  /** True when the unit reports bootloader mode (INFO:STATUS:BL). */
  bootloader: boolean;
  /** True when the unit has no application running (INFO:NOAPP). */
  noApp: boolean;
}

export function parseInfoLines(text: string): GatewayInfo {
  const entries: { key: string; value: string }[] = [];
  const byKey: Record<string, string> = {};
  let complete = false;
  for (const rawLine of text.split(/\r\n|\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("INFO:")) continue;
    const rest = line.slice("INFO:".length);
    if (rest === "END") {
      complete = true;
      continue;
    }
    const sep = rest.indexOf(":");
    // Key-only lines (e.g. INFO:NOAPP) are kept with an empty value.
    const key = sep < 0 ? rest : rest.slice(0, sep);
    const value = sep < 0 ? "" : rest.slice(sep + 1);
    entries.push({ key, value });
    byKey[key] = value;
  }
  return { entries, byKey, complete };
}

export function summarizeInfo(info: GatewayInfo): GatewayInfoSummary {
  const k = info.byKey;
  const appId = k["APPID"] !== undefined ? Number.parseInt(k["APPID"], 10) : NaN;
  return {
    name: k["GWNAME"],
    serial: k["SN"],
    appName: k["APPNAME"],
    appId: Number.isNaN(appId) ? undefined : appId,
    appVersion: k["APPVERSION"],
    platform: k["PLATFORM"],
    mac: k["ETHMAC"],
    ip: k["NETIP"],
    netmask: k["NETMASK"],
    gateway: k["NETGW"],
    dhcp: k["NETDHCP"] === undefined ? undefined : k["NETDHCP"] === "1" || /^true$/i.test(k["NETDHCP"]),
    status: k["STATUS"],
    bootloader: "BL" in k || k["STATUS"] === "BL",
    noApp: "NOAPP" in k,
  };
}
