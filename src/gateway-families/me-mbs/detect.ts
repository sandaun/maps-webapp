import { XmlDocument } from "@/core/project-format";

/**
 * An .ibmaps belongs to the ME AC ↔ Modbus Slave family (770 Air, variant
 * `IntesisProjectMbsMe_RT`) when the root declares InternalProtocol
 * "Modbus Slave" + ExternalProtocol "Mitsubishi Electric" on Platform 3
 * (RT_AIR). Detection keys per docs/ac-me-mbs-analisi.md §1.
 */
export function isMeMbsProject(doc: XmlDocument): boolean {
  if (doc.root.tag !== "Project") return false;
  return (
    doc.getAttr([], "InternalProtocol") === "Modbus Slave" &&
    doc.getAttr([], "ExternalProtocol") === "Mitsubishi Electric" &&
    doc.getAttr([], "Platform") === "3"
  );
}

/** Human-readable identity of the project family, for error messages. */
export function describeProjectFamily(doc: XmlDocument): string {
  const internal = doc.getAttr([], "InternalProtocol") ?? "?";
  const external = doc.getAttr([], "ExternalProtocol") ?? "?";
  return `${internal} ↔ ${external}`;
}
