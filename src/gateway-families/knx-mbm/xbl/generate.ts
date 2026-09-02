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
 * STATUS: VERIFIED byte-exact against the real KNX–MBM fixture
 * (.local-data/fixtures/knx-mbm-2026-09-01.bin, IN701KNX, AppId 4) on
 * 2026-09-01 via scripts/verify-xbl.ts with --mask-timestamp; capability
 * `knxMbmXblVerified` recorded (docs/plans/knx-mbm-mvp.md, Pas 3.4).
 */

import { XmlDocument } from "@/core/project-format";
import {
  buildHeaderNode,
  buildIboxNode,
  DEFAULT_SW_VERSION,
  serializeElements,
  type XblElementSpec,
} from "@/core/xbl";
import { isKnxMbmProject } from "../detect";
import { buildKnxNode } from "./nodes-knx";
import { buildMbmNode } from "./nodes-mbm";
import { runXblPipeline } from "./pipeline";

/** AppId IBOX_KNX_MBM = 4 (IntesisBoxMAPS/AppId.cs:13). */
export const APP_ID_KNX_MBM = 4;

export interface GenerateKnxMbmXblOptions {
  /** Generation timestamp for header tag 4. Defaults to the current time. */
  now?: Date;
  /**
   * MAPS tool version quad for header tag 2. MAPS writes the version of the
   * tool that compiles the XBL; it is not derivable from the project XML.
   */
  swVersion?: readonly [number, number, number, number];
  /**
   * AppId for header tag 6 (IntesisXBL.cs:149): the connected device's AppId
   * when one is connected, otherwise the project class's ApplicationID
   * (IBOX_KNX_MBM = 4 — the default here).
   */
  appId?: number;
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
    buildHeaderNode(
      pipeline.header,
      options.now ?? new Date(),
      options.swVersion ?? DEFAULT_SW_VERSION,
      options.appId ?? APP_ID_KNX_MBM,
    ),
    // USBHostAvailable(IBOX_KNX_MBM, KTS) = true; ActiveMappings stays empty
    // (IntesisProjectKnxMbm.cs:387-389).
    buildIboxNode({
      ibox: pipeline.ibox,
      activeConversions: pipeline.activeConversions,
      activeMappings: [],
      usbAvailable: true,
    }),
    buildKnxNode(pipeline.knx),
  ];
  const mbmNode = buildMbmNode(pipeline.mbm);
  if (mbmNode) elements.push(mbmNode);
  return serializeElements(elements);
}
