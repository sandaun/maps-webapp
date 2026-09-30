import { isS700Platform, projectPlatform, XmlDocument } from "@/core/project-format";

/** The root declares InternalProtocol "Modbus Slave" + ExternalProtocol "KNX", whatever the platform. */
export function hasMbsKnxProtocols(doc: XmlDocument): boolean {
  if (doc.root.tag !== "Project") return false;
  return doc.getAttr([], "InternalProtocol") === "Modbus Slave" && doc.getAttr([], "ExternalProtocol") === "KNX";
}

/**
 * An .ibmaps belongs to the KNX ↔ Modbus Slave family (IN701KNX, variant
 * `IntesisProjectMBSKNX_RT`) when it has the family protocols on a 700 Series
 * platform: MAPS opens Platform 2 and 3 with that class (`ProjectParser.GetProject`).
 * The legacy `IntesisProjectMBSKNX` (KTS, `INMBSKNX…`) is not supported.
 * Confirmed with projects saved by MAPS (docs/reference/mbs-knx-analisi.md §1).
 */
export function isMbsKnxProject(doc: XmlDocument): boolean {
  return hasMbsKnxProtocols(doc) && isS700Platform(projectPlatform(doc));
}

/** Human-readable identity of the project family, for error messages. */
export function describeProjectFamily(doc: XmlDocument): string {
  const internal = doc.getAttr([], "InternalProtocol") ?? "?";
  const external = doc.getAttr([], "ExternalProtocol") ?? "?";
  return `${internal} ↔ ${external}`;
}
