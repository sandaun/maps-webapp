import type { XmlDocument } from "./xml/document";

/** `PlatformGw` (IntesisBoxMAPS/PlatformGw.cs), with its XML values 0–3. */
export type MapsPlatform = "NONE" | "KTS" | "RT" | "RT_AIR";

const PLATFORMS: readonly MapsPlatform[] = ["NONE", "KTS", "RT", "RT_AIR"];

/**
 * The project platform as MAPS reads it (`ProjectParser.InitializeProject_getPlatform`):
 * the root `Platform` attribute, and KTS when it is missing, not an integer
 * or not a `PlatformGw` value.
 */
export function projectPlatform(doc: XmlDocument): MapsPlatform {
  const value = doc.getAttr([], "Platform");
  // `int.TryParse` accepts surrounding white space and a sign.
  if (value === undefined || !/^\s*[+-]?\d+\s*$/.test(value)) return "KTS";
  return PLATFORMS[Number(value)] ?? "KTS";
}

/**
 * True when MAPS opens the project with its 700 Series class: `ProjectParser.GetProject`
 * shares one branch for RT and RT_AIR, and another for NONE and KTS (legacy V6).
 */
export function isS700Platform(platform: MapsPlatform): boolean {
  return platform === "RT" || platform === "RT_AIR";
}

/** The XML value MAPS writes for a platform (`SaveConfiguration`, `(int)Platform`). */
export function platformXmlValue(platform: MapsPlatform): string {
  return String(PLATFORMS.indexOf(platform));
}
