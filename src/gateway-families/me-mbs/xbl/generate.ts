/**
 * `generateMeMbsXbl` — Mitsubishi Electric AC ↔ Modbus Slave (770 Air,
 * `IntesisProjectMbsMe_RT`) XBL generator.
 *
 * Ports `IntesisXBL.GenerateXBLFile` (temp/maps-cloud/xbl-spec/src/
 * IntesisXBL.cs:31-122) as wired by the _RT project class: PreXBLActions
 * pipeline → header (tag 1) → IBOX (tag 2) → MBS internal (tag 9) → ME
 * external (tag 8). Top-level order verified against the real fixture
 * (docs/ac-me-mbs-analisi.md §7).
 *
 * The module is pure and deterministic: no fs/net access, and the only
 * volatile field (the 6-byte generation timestamp in the header) is injected
 * via `options.now`.
 *
 * Returns the raw XBL TLV payload (the `n` bytes). The
 * `[4B BE len][XBL][4B BE CRC32]` framing is applied by
 * `buildCompleteBlob` (src/core/project-format/complete-blob.ts).
 */

import { XmlDocument } from "@/core/project-format";
import {
  buildHeaderNode,
  buildIboxNode,
  DEFAULT_SW_VERSION,
  serializeElements,
  type XblElementSpec,
} from "@/core/xbl";
import { isMeMbsProject } from "../detect";
import { buildMbsNode } from "./nodes-mbs";
import { buildMeNode } from "./nodes-me";
import { runMeMbsXblPipeline } from "./pipeline";

/**
 * AppId ME_AC_XXX = 64 (IntesisBoxMAPS/AppId.cs:131): the universal ME
 * firmware running on the 770 Air. The XBL header carries the CONNECTED
 * DEVICE's AppId when one is connected (IntesisXBL.cs:149); the project
 * class's ApplicationID is ME_AC_MBS = 8 (the XML `CompatibilityID`).
 */
export const APP_ID_ME_AC_XXX = 64;

export interface GenerateMeMbsXblOptions {
  /** Generation timestamp for header tag 4. Defaults to the current time. */
  now?: Date;
  /**
   * MAPS tool version quad for header tag 2. MAPS writes the version of the
   * tool that compiles the XBL; it is not derivable from the project XML.
   */
  swVersion?: readonly [number, number, number, number];
  /**
   * AppId for header tag 6 (IntesisXBL.cs:149): the connected device's AppId
   * when one is connected (64 on a 770 Air — the default here), otherwise the
   * project class's ApplicationID (ME_AC_MBS = 8).
   */
  appId?: number;
}

export function generateMeMbsXbl(
  projectXml: string,
  options: GenerateMeMbsXblOptions = {},
): Uint8Array {
  const doc = XmlDocument.parse(projectXml);
  if (!isMeMbsProject(doc)) {
    throw new Error("Not a Mitsubishi Electric AC ↔ Modbus Slave project");
  }
  const pipeline = runMeMbsXblPipeline(doc);
  const elements: XblElementSpec[] = [
    buildHeaderNode(
      pipeline.header,
      options.now ?? new Date(),
      options.swVersion ?? DEFAULT_SW_VERSION,
      options.appId ?? APP_ID_ME_AC_XXX,
    ),
    // USBHostAvailable(...) is false on RT_AIR (770 Air has no USB host);
    // ActiveMappings takes ALL the project's remap LUTs
    // (IntesisProjectMbsMe_RT.cs:446).
    buildIboxNode({
      ibox: pipeline.ibox,
      activeConversions: pipeline.activeConversions,
      activeMappings: pipeline.activeMappings,
      usbAvailable: false,
    }),
    buildMbsNode(pipeline.mbs),
    buildMeNode(pipeline.me),
  ];
  return serializeElements(elements);
}
