export { crc32 } from "./crc32";
export { buildCompleteBlob, parseCompleteBlob, type CompleteBlob } from "./complete-blob";
export { buildProjectZip, extractIbmaps, type IbmapsFile } from "./zip";
export { XmlDocument } from "./xml/document";
export { appendChildIndented } from "./xml/append-indented";
export { compareMapsVersions, isMapsVersion, MAPS_REFERENCE_VERSION, projectMapsVersion } from "./maps-version";
export {
  appendChild,
  element,
  find,
  findAll,
  getAttr,
  getText,
  remove,
  setAttr,
  setText,
  text,
  type PathSegment,
  type XmlElement,
  type XmlNode,
  type XmlText,
} from "./xml/model";
