import { XmlDocument } from "@/core/project-format";

/**
 * An .ibmaps belongs to the KNX ↔ Modbus Slave family (IN701KNX, variant
 * `IntesisProjectMBSKNX_RT`) when the root declares InternalProtocol
 * "Modbus Slave" + ExternalProtocol "KNX" on Platform 2 (RT). The plain
 * `IntesisProjectMBSKNX` (KTS, `INMBSKNX…`) is not supported.
 * UNVERIFIED: the Platform value, until a project saved by MAPS confirms it
 * (docs/reference/mbs-knx-analisi.md §1).
 */
export function isMbsKnxProject(doc: XmlDocument): boolean {
  if (doc.root.tag !== "Project") return false;
  return (
    doc.getAttr([], "InternalProtocol") === "Modbus Slave" &&
    doc.getAttr([], "ExternalProtocol") === "KNX" &&
    doc.getAttr([], "Platform") === "2"
  );
}

/** Human-readable identity of the project family, for error messages. */
export function describeProjectFamily(doc: XmlDocument): string {
  const internal = doc.getAttr([], "InternalProtocol") ?? "?";
  const external = doc.getAttr([], "ExternalProtocol") ?? "?";
  return `${internal} ↔ ${external}`;
}
