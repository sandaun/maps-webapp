/**
 * `generateMbsKnxXbl` — KNX ↔ Modbus Slave (IN701KNX,
 * `IntesisProjectMBSKNX_RT`) XBL generator: PreXBLActions pipeline → header
 * (tag 1) → IBOX (tag 2) → MBS internal (tag 9) → KNX external (tag 4).
 * Pure and deterministic; the generation timestamp comes from `options.now`.
 * Returns the raw XBL TLV payload (without the length/CRC framing).
 */

import { XmlDocument } from "@/core/project-format";
import {
  buildHeaderNode,
  buildIboxNode,
  DEFAULT_SW_VERSION,
  serializeElements,
  type XblElementSpec,
} from "@/core/xbl";
import { buildKnxNode } from "@/protocols/knx/xbl";
import { buildMbsNode } from "@/protocols/modbus/slave/xbl";
import { isMbsKnxProject } from "../detect";
import { runMbsKnxXblPipeline } from "./pipeline";

/** AppId IBOX_MBS_KNX = 7 (IntesisBoxMAPS/AppId.cs:19). */
export const APP_ID_MBS_KNX = 7;

export interface GenerateMbsKnxXblOptions {
  /** Generation timestamp for header tag 4. Defaults to the current time. */
  now?: Date;
  /** MAPS tool version quad for header tag 2 (not derivable from the XML). */
  swVersion?: readonly [number, number, number, number];
  /** AppId for header tag 6: the connected device's, else the project class's (7). */
  appId?: number;
}

export function generateMbsKnxXbl(projectXml: string, options: GenerateMbsKnxXblOptions = {}): Uint8Array {
  const doc = XmlDocument.parse(projectXml);
  if (!isMbsKnxProject(doc)) {
    throw new Error("Not a KNX ↔ Modbus Slave project");
  }
  const pipeline = runMbsKnxXblPipeline(doc);
  const elements: XblElementSpec[] = [
    buildHeaderNode(
      pipeline.header,
      options.now ?? new Date(),
      options.swVersion ?? DEFAULT_SW_VERSION,
      options.appId ?? APP_ID_MBS_KNX,
    ),
    // USBHostAvailable(IBOX_MBS_KNX, RT) = true; ActiveMappings stays empty
    // (IntesisProjectMBSKNX_RT.cs:199-211).
    buildIboxNode({
      ibox: pipeline.ibox,
      activeConversions: pipeline.activeConversions,
      activeMappings: [],
      usbAvailable: true,
    }),
    buildMbsNode(pipeline.mbs),
    buildKnxNode(pipeline.knx),
  ];
  return serializeElements(elements);
}
