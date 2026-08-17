import { XmlDocument } from "@/core/project-format";

/**
 * An .ibmaps belongs to the KNX ↔ Modbus Master family when the root element
 * declares InternalProtocol="KNX" and ExternalProtocol="Modbus Master".
 * (CompatibilityID/AppId 4 is not relied upon: the XML is authoritative.)
 */
export function isKnxMbmProject(doc: XmlDocument): boolean {
  if (doc.root.tag !== "Project") return false;
  return (
    doc.getAttr([], "InternalProtocol") === "KNX" &&
    doc.getAttr([], "ExternalProtocol") === "Modbus Master"
  );
}

/** Human-readable identity of the project family, for error messages. */
export function describeProjectFamily(doc: XmlDocument): string {
  const internal = doc.getAttr([], "InternalProtocol") ?? "?";
  const external = doc.getAttr([], "ExternalProtocol") ?? "?";
  return `${internal} ↔ ${external}`;
}
