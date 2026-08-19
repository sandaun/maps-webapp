/**
 * XBL writers for the family-independent nodes: header (tag 1) and IBOX
 * (tag 2, incl. conversions tag 7, link tables tag 8, remapping tag 9, USB
 * tags 10/11, timezone/NTP tags 12/13, DNS tag 14, security tag 15, custom
 * ports 17/18).
 *
 * Provenance: `IntesisXBL.CreateXBLHeaderNode` / `CreateXBLIBOXNode` /
 * `CreateConversionsXBLNode` / `CreateRemappingXBLNode` /
 * `CreateUSBConfigXBLNode` / `CreateUSBAdvancedXBLNode`
 * (temp/maps-cloud/xbl-spec/src/IntesisXBL.cs:124-365, 378-423),
 * `TimeConfiguration.GetTimeZoneXbl`/`GetNtpXbl`
 * (IntesisBoxMAPS/TimeConfiguration.cs:76-127), `SecurityConfig.GetSecurityXbl`/
 * `GetPortXbl` (IntesisBoxMAPS/SecurityConfig.cs:73-117).
 *
 * Moved from `gateway-families/knx-mbm/xbl/` in step 2.4 and generalized:
 * - the header AppId is a parameter (it is the CONNECTED DEVICE's AppId when
 *   one is connected — `IntesisXBL.cs:149` — e.g. 64 `ME_AC_XXX` on a 770
 *   Air, while the project class declares 8 `ME_AC_MBS`);
 * - the IBOX writer takes the active remap LUTs (tag 9) and a USB-availability
 *   flag (`IntesisLicense.USBHostAvailable` — false on RT_AIR, true for
 *   IBOX_KNX_MBM on KTS).
 */

import type { ActiveConversion, ParsedRemapLut } from "./conversions";
import {
  container,
  f32le,
  ipv4Bytes,
  node,
  nullTerminatedUtf8,
  u16be,
  u32be,
  u32le,
  type XblElementSpec,
} from "./tlv";

/**
 * MAPS version quad written into header tag 2. MAPS writes the CURRENT tool
 * version (`VersioningUtils.GetSWVersionString()` parsed as an IP); the
 * project XML's ToolVersion is NOT used. It cannot be derived from the
 * project, so the generator takes it as an option and the verification
 * harness extracts it from the reference XBL. Default observed in the real
 * ME–MBS and BACnet–MBM reference XBLs: 1.2.31.0.
 */
export const DEFAULT_SW_VERSION: readonly [number, number, number, number] = [1, 2, 31, 0];

/** Header fields the XBL header node needs (parsed from the XML `<Header>`). */
export interface XblHeaderFields {
  description: string;
  compVersion: string;
  endianess: boolean;
}

/** IBOX fields the XBL IBOX node needs (parsed from the XML `<IBOX>`). */
export interface XblIboxFields {
  ip: string;
  netmask: string;
  gateway: string;
  dhcp: boolean;
  pwd: string;
  name: string;
  dns: string;
  dns2: string;
  usb: {
    getLogs: boolean;
    getProject: boolean;
    saveProject: boolean;
    saveFirm: boolean;
    spons: boolean;
    comms: boolean;
    debugLevel: number;
    verboseLevel: number;
  };
  security: { tcpDisabled: boolean; udpDisabled: boolean; customPort: boolean; port: number };
}

export interface XblIboxOptions {
  ibox: XblIboxFields;
  activeConversions: ActiveConversion[];
  /**
   * Active remap LUTs → IBOX tag 9. Empty when the family's PreXBLActions
   * leaves ActiveMappings empty (KNX–MBM); ME–MBS passes ALL the project's
   * LUTs (`ActiveMappings = mRemappings`, IntesisProjectMbsMe_RT.cs:446).
   */
  activeMappings: ParsedRemapLut[];
  /**
   * `IntesisLicense.USBHostAvailable(appId, platform)`: gates USB tags 10/11.
   * True for KNX–MBM (KTS), false on RT_AIR (770 Air).
   */
  usbAvailable: boolean;
}

/** Version quad → 4 bytes (C# IPAddress.Parse(version.ToString())). */
function versionBytes(version: readonly [number, number, number, number]): Uint8Array {
  return new Uint8Array(version);
}

/**
 * Dotted version string ("1.0.0.0") → 4 bytes. UNVERIFIED edge: C# parses
 * `new Version(s).ToString()` as an IP; partial versions ("1.0") go through
 * IPAddress.Parse's legacy short forms — here missing parts pad with 0 at the
 * end instead.
 */
function versionStringBytes(value: string): Uint8Array {
  const parts = value.split(".").map((p) => Number(p));
  if (parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    throw new Error(`Invalid version quad for XBL header: "${value}"`);
  }
  while (parts.length < 4) parts.push(0);
  return new Uint8Array(parts.slice(0, 4));
}

/**
 * Port of IntesisXBL.CreateXBLHeaderNode (IntesisXBL.cs:124-172). `appId` is
 * the value C# resolves at runtime: the connected device's AppId when a device
 * is connected, otherwise the project class's ApplicationID.
 */
export function buildHeaderNode(
  header: XblHeaderFields,
  now: Date,
  swVersion: readonly [number, number, number, number],
  appId: number,
): XblElementSpec {
  return container(1, [
    // HeaderDescription, max 32 UTF-8 bytes + NUL.
    node(1, nullTerminatedUtf8(header.description, 32, 33)),
    node(2, versionBytes(swVersion)),
    node(3, versionStringBytes(header.compVersion)),
    // Volatile 6-byte timestamp: day, month, 2-digit year, hour, min, sec
    // (local time, like C# DateTime.Now).
    node(
      4,
      new Uint8Array([
        now.getDate(),
        now.getMonth() + 1,
        now.getFullYear() % 100,
        now.getHours(),
        now.getMinutes(),
        now.getSeconds(),
      ]),
    ),
    node(5, new Uint8Array([header.endianess ? 1 : 0])),
    node(6, new Uint8Array([appId & 0xff])),
  ]);
}

/** Port of IntesisXBL.CreateConversionsXBLNode (IntesisXBL.cs:378-423). */
function buildConversionsNode(active: ActiveConversion[]): XblElementSpec | null {
  if (active.length === 0) return null;
  const out = new Uint8Array(active.length * 17);
  active.forEach((conv, i) => {
    const base = i * 17;
    out[base] = (conv.type & 0x7f) | (conv.isLast ? 0x80 : 0);
    // Params are 4B little-endian; FILTER/LUT_REMAP/LOGICAL take P1/P2 as
    // uint, LOGICAL takes P3 as uint, ARITH/LOGICAL take P4 as uint; the rest
    // are floats (IntesisXBL.cs:394-419).
    const asUint1 = conv.type === 0 || conv.type === 4 || conv.type === 3;
    const p1 = asUint1 ? u32le(Math.trunc(conv.params[0]) >>> 0) : f32le(conv.params[0]);
    const p2 = asUint1 ? u32le(Math.trunc(conv.params[1]) >>> 0) : f32le(conv.params[1]);
    const p3 = conv.type === 3 ? u32le(Math.trunc(conv.params[2]) >>> 0) : f32le(conv.params[2]);
    const p4 =
      conv.type === 2 || conv.type === 3
        ? u32le(Math.trunc(conv.params[3]) >>> 0)
        : f32le(conv.params[3]);
    out.set(p1, base + 1);
    out.set(p2, base + 5);
    out.set(p3, base + 9);
    out.set(p4, base + 13);
  });
  return node(7, out);
}

/**
 * Port of IntesisXBL.CreateRemappingXBLNode (IntesisXBL.cs:335-366): per LUT,
 * an 11-byte header (count, u32 BE default, 0, u32 BE invDefault, 0) followed
 * by 10 bytes per element (u32 BE in, 0, u32 BE out, 0). C# casts the float
 * values to uint (truncation toward zero).
 */
function buildRemappingNode(mappings: ParsedRemapLut[]): XblElementSpec | null {
  if (mappings.length === 0) return null;
  const total = mappings.reduce((n, m) => n + 11 + m.numberOfElements * 10, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  const putU32 = (value: number, at: number): void => {
    out.set(u32be(Math.trunc(value) >>> 0), at);
  };
  for (const lut of mappings) {
    out[offset] = lut.numberOfElements & 0xff;
    putU32(lut.defaultInput, offset + 1);
    // out[offset + 5] = 0 (already zeroed)
    putU32(lut.invDefault, offset + 6);
    // out[offset + 10] = 0
    offset += 11;
    for (let i = 0; i < lut.numberOfElements; i++) {
      putU32(lut.inputValues[i] ?? 0, offset);
      putU32(lut.outputValues[i] ?? 0, offset + 5);
      offset += 10;
    }
  }
  return node(9, out);
}

function buildUsbConfigNode(usb: XblIboxFields["usb"]): XblElementSpec {
  let flags = 0;
  if (usb.getLogs) flags += 1;
  if (usb.getProject) flags += 2;
  if (usb.saveProject) flags += 4;
  if (usb.saveFirm) flags += 8;
  return node(10, new Uint8Array([flags]));
}

function buildUsbAdvancedNode(usb: XblIboxFields["usb"]): XblElementSpec | null {
  if (!usb.getLogs) return null;
  let flags = 0;
  if (usb.spons) flags += 1;
  if (usb.comms) flags += 2;
  // C# builds [verbose, debug, flags] and then reverses the array.
  return node(11, new Uint8Array([flags, usb.debugLevel & 0xff, usb.verboseLevel & 0xff]));
}

/**
 * Timezone/NTP placeholder nodes. Both families exercised so far have
 * TimeConfiguration.Enabled=False, which takes the placeholder branch of
 * GetTimeZoneXbl/GetNtpXbl regardless of TimeZoneAvailable. UNVERIFIED edge:
 * with Enabled=True on RT/RT_AIR (TimeZoneAvailable=true) the real timezone
 * table content would be emitted instead — not ported (no sample).
 */
function buildTimeZoneNode(): XblElementSpec {
  return container(12, [
    node(1, new Uint8Array(16)),
    node(2, new Uint8Array(256)),
    node(3, new Uint8Array(44)),
  ]);
}

function buildNtpNode(): XblElementSpec {
  return container(13, [node(1, new Uint8Array(4)), node(2, new Uint8Array(256))]);
}

/** Port of IntesisXBL.CreateXBLIBOXNode (IntesisXBL.cs:174-281). */
export function buildIboxNode(options: XblIboxOptions): XblElementSpec {
  const { ibox } = options;
  const children: XblElementSpec[] = [
    node(1, ipv4Bytes(ibox.ip)),
    node(2, ipv4Bytes(ibox.netmask)),
    node(3, ipv4Bytes(ibox.gateway)),
    node(4, new Uint8Array([ibox.dhcp ? 1 : 0])),
    node(5, nullTerminatedUtf8(ibox.pwd, 8, 9)),
    node(6, nullTerminatedUtf8(ibox.name, 32, 33)),
  ];
  const conversions = buildConversionsNode(options.activeConversions);
  if (conversions) children.push(conversions);
  // Link tables (tag 8) are never emitted by the families exercised so far:
  // PreXBLActions clears ProjectLinkTable (IntesisProjectKnxMbm.cs:387-389,
  // IntesisProjectMbsMe_RT.cs:326).
  const remapping = buildRemappingNode(options.activeMappings);
  if (remapping) children.push(remapping);
  if (options.usbAvailable) {
    children.push(buildUsbConfigNode(ibox.usb));
    const usbAdvanced = buildUsbAdvancedNode(ibox.usb);
    if (usbAdvanced) children.push(usbAdvanced);
  }
  children.push(buildTimeZoneNode());
  children.push(buildNtpNode());
  const dns = new Uint8Array(8);
  dns.set(ipv4Bytes(ibox.dns), 0);
  dns.set(ipv4Bytes(ibox.dns2), 4);
  children.push(node(14, dns));
  const { security } = ibox;
  if (security.tcpDisabled || security.udpDisabled) {
    // GetSecurityXbl; IsLow is false for the families exercised so far.
    children.push(
      container(15, [
        node(1, new Uint8Array([security.tcpDisabled ? 1 : 0])),
        node(2, new Uint8Array([security.udpDisabled ? 1 : 0])),
      ]),
    );
  }
  if (security.customPort) {
    // GetPortXbl is emitted twice, tags 17 and 18 (IntesisXBL.cs:248-257).
    children.push(node(17, u16be(security.port)));
    children.push(node(18, u16be(security.port)));
  }
  // GetLedConfigXblNode is not overridden by the ported families → null.
  // CertificatesConfig only applies with UsesCloudConection() → false.
  return container(2, children);
}
