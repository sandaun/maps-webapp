/**
 * MBS–KNX XBL pipeline: parse the .ibmaps XML into the structures the MAPS
 * XBL writers consume and port `IntesisProjectMBSKNX_RT.PreXBLActions`
 * (temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS.Projects/IntesisProjectMBSKNX_RT.cs:158-211).
 * Both protocol sides come from `src/protocols`: Modbus Slave is the
 * internal element, KNX the external one.
 */

import { XmlDocument } from "@/core/project-format";
import {
  createConversionList,
  parseConversions,
  parseXblHeader,
  parseXblIbox,
  type ActiveConversion,
  type XblHeaderFields,
  type XblIboxFields,
} from "@/core/xbl";
import { parseKnxObjects, parseKnxXblSettings, type EnabledKnxObject, type KnxXblNode } from "@/protocols/knx/xbl";
import {
  parseMbsSignals,
  parseMbsXblSettings,
  type EnabledMbsSignal,
  type MbsXblNode,
} from "@/protocols/modbus/slave/xbl";

export interface MbsKnxXblPipelineResult {
  header: XblHeaderFields;
  ibox: XblIboxFields;
  activeConversions: ActiveConversion[];
  mbs: MbsXblNode;
  knx: KnxXblNode;
}

/** Port of `PreXBLActions` plus the XML parsing that feeds it. Throws on malformed input. */
export function runMbsKnxXblPipeline(doc: XmlDocument): MbsKnxXblPipelineResult {
  const internal = doc.find(["InternalProtocol"]);
  const external = doc.find(["ExternalProtocol"]);
  if (!internal || !external) {
    throw new Error("Project XML lacks InternalProtocol/ExternalProtocol");
  }
  const mbsConfig = parseMbsXblSettings(internal);
  const mbsSignals = parseMbsSignals(internal);
  const knxObjects = parseKnxObjects(external);
  if (mbsSignals.length !== knxObjects.length) {
    // C# indexes KnxObjects[i] from the MbsObjects loop: a count mismatch throws there too.
    throw new Error(`MBS/KNX signal count mismatch: ${mbsSignals.length} vs ${knxObjects.length}`);
  }

  // Split enabled: only the Modbus side's isEnabled counts; the KNX object at
  // the same position follows (IntesisProjectMBSKNX_RT.cs:166-176).
  const enabledMbs: EnabledMbsSignal[] = [];
  const enabledKnx: EnabledKnxObject[] = [];
  for (let i = 0; i < mbsSignals.length; i++) {
    if (!mbsSignals[i].isEnabled) continue;
    enabledMbs.push({ ...mbsSignals[i], externalId: enabledMbs.length, conversionId: 255 });
    enabledKnx.push({ ...knxObjects[i], externalId: 0, conversionId: 255 });
  }

  // OrderBy(Bit) then OrderBy(Address), both stable: one stable sort by (address, bit).
  enabledMbs.sort((a, b) => a.address - b.address || a.bit - b.bit);

  // Re-link: each KNX object points at its Modbus signal's sorted position (:179-188).
  for (let i = 0; i < enabledMbs.length; i++) {
    const externalId = enabledMbs[i].externalId;
    if (externalId !== -1) enabledKnx[externalId] = { ...enabledKnx[externalId], externalId: i };
  }

  // CreateConversionsTable (:199-211): Modbus first (sorted order), then KNX;
  // ActiveMappings stays empty.
  const { filters, operations } = parseConversions(doc);
  const activeConversions: ActiveConversion[] = [];
  for (const obj of [...enabledMbs, ...enabledKnx]) {
    obj.conversionId =
      obj.filterIds.length > 0 || obj.operationIds.length > 0
        ? createConversionList(obj.filterIds, obj.operationIds, filters, operations, activeConversions)
        : 255;
  }

  return {
    header: parseXblHeader(doc),
    ibox: parseXblIbox(doc),
    activeConversions,
    mbs: { ...mbsConfig, slaves: [], signals: enabledMbs },
    knx: { ...parseKnxXblSettings(external), objects: enabledKnx },
  };
}
