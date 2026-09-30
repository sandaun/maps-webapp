import { isS700Platform, projectPlatform, XmlDocument } from "@/core/project-format";

/** The root declares InternalProtocol "Modbus Slave" + ExternalProtocol "Mitsubishi Electric", whatever the platform. */
export function hasMeMbsProtocols(doc: XmlDocument): boolean {
  if (doc.root.tag !== "Project") return false;
  return (
    doc.getAttr([], "InternalProtocol") === "Modbus Slave" &&
    doc.getAttr([], "ExternalProtocol") === "Mitsubishi Electric"
  );
}

/**
 * An .ibmaps belongs to the ME AC ↔ Modbus Slave family (770 Air, variant
 * `IntesisProjectMbsMe_RT`, saved as Platform 3 RT_AIR) when it has the family
 * protocols on a 700 Series platform: MAPS opens Platform 2 and 3 with that
 * class (`ProjectParser.GetProject`). The legacy `IntesisProjectMbsMe` (KTS, V6)
 * is not supported. Detection keys per docs/reference/ac-me-mbs-analisi.md §1.
 */
export function isMeMbsProject(doc: XmlDocument): boolean {
  return hasMeMbsProtocols(doc) && isS700Platform(projectPlatform(doc));
}

/** Human-readable identity of the project family, for error messages. */
export function describeProjectFamily(doc: XmlDocument): string {
  const internal = doc.getAttr([], "InternalProtocol") ?? "?";
  const external = doc.getAttr([], "ExternalProtocol") ?? "?";
  return `${internal} ↔ ${external}`;
}
