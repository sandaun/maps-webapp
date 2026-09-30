import { isS700Platform, projectPlatform, XmlDocument } from "@/core/project-format";

/**
 * The root declares InternalProtocol="KNX" and ExternalProtocol="Modbus Master",
 * whatever the platform. (CompatibilityID/AppId 4 is not relied upon: the XML
 * is authoritative.)
 */
export function hasKnxMbmProtocols(doc: XmlDocument): boolean {
  if (doc.root.tag !== "Project") return false;
  return (
    doc.getAttr([], "InternalProtocol") === "KNX" &&
    doc.getAttr([], "ExternalProtocol") === "Modbus Master"
  );
}

/**
 * An .ibmaps belongs to the KNX ↔ Modbus Master family (IN701KNX, variant
 * `IntesisProjectKnxMbm_RT`) when it has the family protocols on a 700 Series
 * platform: MAPS opens Platform 2 and 3 with that class (`ProjectParser.GetProject`).
 * The legacy `IntesisProjectKnxMbm` (KTS, V6) is not supported.
 */
export function isKnxMbmProject(doc: XmlDocument): boolean {
  return hasKnxMbmProtocols(doc) && isS700Platform(projectPlatform(doc));
}

/** Human-readable identity of the project family, for error messages. */
export function describeProjectFamily(doc: XmlDocument): string {
  const internal = doc.getAttr([], "InternalProtocol") ?? "?";
  const external = doc.getAttr([], "ExternalProtocol") ?? "?";
  return `${internal} ↔ ${external}`;
}
