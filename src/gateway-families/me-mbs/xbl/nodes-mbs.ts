/**
 * XBL writer for the MBS internal node (top-level tag 9).
 *
 * Provenance: `InternalMbs.CreateInternalXBLNode` / `CreateRTUConfigNode` /
 * `CreateTCPConfigNode` / `CreateSignalsNode` / `CresateSlavesNode`
 * (temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS.Protocols.MB.Internal/
 * InternalMbs.cs:646-769), `MbsObject.GenerateXblItem`
 * (IntesisBoxMAPS.Protocols.MB/MbsObject.cs:209-283) and
 * `MBSlave.GenerateXblItem` (MBSlave.cs:38-54).
 *
 * Byte-exact against the real 770 Air fixture
 * (.local-data/fixtures/770air-me-mbs-2026-08-18.bin) — see
 * docs/knx-mbm-mvp.md, Pas 2.4.
 */

import {
  array,
  container,
  externalIdBytes,
  node,
  shrunkU16be,
  u16be,
  u32be,
  type XblElementSpec,
} from "@/core/xbl";
import type { EnabledMbsSignal, EnabledMbSlave, MeMbsXblPipelineResult } from "./pipeline";

/** MbmObjectType.STRING = 5 (MbmObjectType.cs). */
const FORMAT_STRING = 5;
/** SlaveAddressMode.MULTIPLE = 1 (SlaveAddressMode.cs). */
const SLAVE_MODE_MULTIPLE = 1;

/**
 * Port of MbsObject.GenerateXblItem (MbsObject.cs:209-283): tags 1 LenBits,
 * 2 Format, 3 Bit (when ≠ -1), 4 Address (shrunk u16 BE, −1 on BASE_1),
 * 5 ReadWrite+1, 6 ExternalID (shrunk u16 BE), 7 ConfigID (shrunk u16 BE),
 * 8 ConversionID (when ≠ 255), 9 StringLength (STRING only), 11 SlaveIndex
 * (when ≠ -1).
 */
export function buildMbsSignalItem(signal: EnabledMbsSignal, registerBase: number): XblElementSpec[] {
  const out: XblElementSpec[] = [
    node(1, new Uint8Array([signal.lenBits & 0xff])),
    node(2, new Uint8Array([signal.format & 0xff])),
  ];
  if (signal.bit !== -1) {
    out.push(node(3, new Uint8Array([signal.bit & 0xff])));
  }
  const address = registerBase === 1 ? signal.address - 1 : signal.address;
  out.push(node(4, shrunkU16be(address & 0xffff)));
  out.push(node(5, new Uint8Array([(signal.readWrite + 1) & 0xff])));
  out.push(node(6, externalIdBytes(signal.externalId, false)));
  out.push(node(7, shrunkU16be(signal.configId & 0xffff)));
  if (signal.conversionId !== 255) {
    out.push(node(8, new Uint8Array([signal.conversionId & 0xff])));
  }
  if (signal.format === FORMAT_STRING && signal.stringLength > 0) {
    out.push(node(9, new Uint8Array([signal.stringLength & 0xff])));
  }
  if (signal.slaveIndex !== -1) {
    out.push(node(11, new Uint8Array([signal.slaveIndex & 0xff])));
  }
  return out;
}

/** Port of InternalMbs.CreateRTUConfigNode (InternalMbs.cs:716-738). */
function buildRtuConfigNode(rtu: MeMbsXblPipelineResult["mbs"]["rtu"]): XblElementSpec {
  return container(4, [
    node(1, u32be(rtu.baudrate)),
    node(2, new Uint8Array([rtu.dataBits & 0xff])),
    node(3, new Uint8Array([rtu.parity & 0xff])),
    node(4, new Uint8Array([rtu.stopBits & 0xff])),
    node(5, new Uint8Array([rtu.slaveNumber & 0xff])),
    node(6, new Uint8Array([rtu.connectionType & 0xff])),
  ]);
}

/** Port of InternalMbs.CreateTCPConfigNode (InternalMbs.cs:740-760). */
function buildTcpConfigNode(tcp: MeMbsXblPipelineResult["mbs"]["tcp"]): XblElementSpec {
  return container(5, [node(1, u16be(tcp.port)), node(2, u16be(tcp.keepAlive))]);
}

/**
 * Port of MBSlave.GenerateXblItem (MBSlave.cs:38-54). UNVERIFIED: only
 * exercised in MULTIPLE slave mode; the real fixture runs SINGLE mode, which
 * omits the whole slaves node.
 */
function buildSlaveItem(slave: EnabledMbSlave): XblElementSpec[] {
  return [
    node(1, new Uint8Array([slave.address & 0xff])),
    node(2, u16be(slave.indexFirst & 0xffff)),
    node(3, u16be(slave.indexLast & 0xffff)),
  ];
}

/** Port of InternalMbs.CreateInternalXBLNode (InternalMbs.cs:646-694). */
export function buildMbsNode(mbs: MeMbsXblPipelineResult["mbs"]): XblElementSpec {
  const children: XblElementSpec[] = [
    node(1, new Uint8Array([mbs.media & 0xff])),
    node(2, new Uint8Array([mbs.byteOrder & 0xff])),
    node(3, new Uint8Array([mbs.updateCOV ? 1 : 0])),
  ];
  // NOTE the positional order: tag 7 sits between tags 3 and 4 in the C#
  // emission order (InternalMbs.cs:658-672) — XBL tags are NOT sorted.
  if (mbs.commErrorTout !== -1) {
    children.push(node(7, u32be((mbs.commErrorTout * 1000) >>> 0)));
  }
  if (mbs.media !== 1) {
    children.push(buildRtuConfigNode(mbs.rtu));
  }
  if (mbs.media !== 0) {
    children.push(buildTcpConfigNode(mbs.tcp));
  }
  if (mbs.signals.length > 0) {
    children.push(
      container(6, [array(mbs.signals.map((s) => buildMbsSignalItem(s, mbs.registerBase)))]),
    );
  }
  if (mbs.slaveAddressMode === SLAVE_MODE_MULTIPLE && mbs.slaves.length > 0) {
    children.push(container(8, [array(mbs.slaves.map(buildSlaveItem))]));
  }
  return container(9, children);
}
