/**
 * `generateKnxMbmXbl` — KNX ↔ Modbus Master XBL generator.
 *
 * Ports `IntesisXBL.GenerateXBLFile` (temp/maps-cloud/xbl-spec/src/IntesisXBL.cs:31-122)
 * for the KNX–MBM family: PreXBLActions pipeline → header (tag 1) → IBOX
 * (tag 2) → KNX internal (tag 4) → MBM external (tag 6, omitted when nothing
 * is enabled).
 *
 * The module is pure and deterministic: no fs/net access, and the only
 * volatile field (the 6-byte generation timestamp in the header) is injected
 * via `options.now`.
 *
 * Returns the raw XBL TLV payload (the `n` bytes). The
 * `[4B BE len][XBL][4B BE CRC32]` framing is applied by
 * `buildCompleteBlob` (src/core/project-format/complete-blob.ts).
 *
 * STATUS: UNVERIFIED against a real KNX–MBM gateway — no real fixture exists
 * yet. scripts/verify-xbl.ts is the harness that will close this gap (see
 * docs/knx-mbm-mvp.md, Iteració 8).
 */

import { XmlDocument } from "@/core/project-format";
import { isKnxMbmProject } from "../detect";
import { buildHeaderNode, buildIboxNode, DEFAULT_SW_VERSION } from "./nodes-common";
import { buildKnxNode } from "./nodes-knx";
import { buildMbmNode } from "./nodes-mbm";
import { runXblPipeline } from "./pipeline";
import { serializeElements, type XblElementSpec } from "./tlv";

export interface GenerateKnxMbmXblOptions {
  /** Generation timestamp for header tag 4. Defaults to the current time. */
  now?: Date;
  /**
   * MAPS tool version quad for header tag 2. MAPS writes the version of the
   * tool that compiles the XBL; it is not derivable from the project XML.
   */
  swVersion?: readonly [number, number, number, number];
}

export function generateKnxMbmXbl(
  projectXml: string,
  options: GenerateKnxMbmXblOptions = {},
): Uint8Array {
  const doc = XmlDocument.parse(projectXml);
  if (!isKnxMbmProject(doc)) {
    throw new Error("Not a KNX ↔ Modbus Master project");
  }
  const pipeline = runXblPipeline(doc);
  const elements: XblElementSpec[] = [
    buildHeaderNode(pipeline.header, options.now ?? new Date(), options.swVersion ?? DEFAULT_SW_VERSION),
    buildIboxNode(pipeline),
    buildKnxNode(pipeline.knx),
  ];
  const mbmNode = buildMbmNode(pipeline.mbm);
  if (mbmNode) elements.push(mbmNode);
  return serializeElements(elements);
}
