/**
 * XBL writer for the Modbus Master external protocol node (tag 6).
 *
 * Provenance: `ExternalMbm.CreateExternalXBLNode` and helpers
 * (temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS.Protocols.MB.External/ExternalMbm.cs:363-549),
 * `MbmRtuNode.CreateRtuConfigXblNode` / `CreateXblNodeList` /
 * `GetContainedDevicesXblNode` / `GetConfigXblNodes`
 * (IntesisBoxMAPS.Protocols.MB/MbmRtuNode.cs:111-203), `MbmTcpNode.CreateXblNodeList`
 * (MbmTcpNode.cs:127-164), `MbmDevice.GetMyXblNodeList` (MbmDevice.cs:100-129)
 * and `MbmObject.GenerateXBLItem` (MbmObject.cs:94-179).
 */

import type {
  EnabledDevice,
  EnabledMbmObject,
  EnabledRtuNode,
  EnabledTcpNode,
  XblPipelineResult,
} from "./pipeline";
import {
  array,
  container,
  externalIdBytes,
  f32le,
  ipv4Bytes,
  node,
  shrunkU16be,
  u16be,
  u32be,
  type XblElementSpec,
} from "@/core/xbl";

/** MbmDevice.GetMyXblNodeList; RTU and TCP devices use different tags. */
function deviceItemList(dev: EnabledDevice, isRtu: boolean): XblElementSpec[] {
  const tagFirstLast = isRtu ? 3 : 2;
  const tagErr = isRtu ? 4 : 3;
  const out: XblElementSpec[] = [node(1, new Uint8Array([dev.slave & 0xff]))];
  if (dev.timeout !== 0 && isRtu) {
    out.push(node(2, u16be(dev.timeout)));
  }
  const firstLast = new Uint8Array(4);
  firstLast.set(u16be(dev.firstIndex), 0);
  firstLast.set(u16be(dev.lastIndex), 2);
  out.push(node(tagFirstLast, firstLast));
  if (dev.errExternalId !== -1) {
    out.push(node(tagErr, externalIdBytes(dev.errExternalId)));
  }
  return out;
}

/**
 * Devices container. Empty RTU lists get a placeholder device (slave 1,
 * timeout 1000, first 65535, last 0) — MbmRtuNode.GetContainedDevicesXblNode
 * (MbmRtuNode.cs:150-174).
 */
function devicesNode(devices: EnabledDevice[], tag: number): XblElementSpec {
  const items =
    devices.length > 0
      ? devices.map((d) => deviceItemList(d, true))
      : [deviceItemList({ slave: 1, base: 0, timeout: 1000, enabled: true, firstIndex: 65535, lastIndex: 0, errExternalId: -1 }, true)];
  return container(tag, [array(items)]);
}

/** RTU config nodes; includePhysicalPort only in the multi-node array form. */
function rtuConfigNodes(rtu: EnabledRtuNode, includePhysicalPort: boolean): XblElementSpec[] {
  const out: XblElementSpec[] = [
    node(1, u32be(rtu.baudrate)),
    node(2, new Uint8Array([rtu.dataBits & 0xff])),
    node(3, new Uint8Array([rtu.parity & 0xff])),
    node(4, new Uint8Array([rtu.stopBits & 0xff])),
    node(5, u32be(rtu.timeInterFrame)),
    node(6, new Uint8Array([rtu.pollAfterWrite ? 1 : 0])),
  ];
  if (rtu.idxPollReadSignal !== -1) {
    out.push(node(7, externalIdBytes(rtu.idxPollReadSignal)));
  }
  if (includePhysicalPort) {
    out.push(node(9, new Uint8Array([rtu.physicalPort & 0xff])));
  }
  return out;
}

/** Single-RTU-node path: config container (tag 2) + devices (tag 3). */
function rtuSingleConfigNode(rtu: EnabledRtuNode, media: number): XblElementSpec | null {
  if (media === 1) return null;
  return container(2, rtuConfigNodes(rtu, false));
}

/** Multi-node path: tag 9 container with one array item per RTU node. */
function rtuNodesArrayNode(mbm: XblPipelineResult["mbm"]): XblElementSpec | null {
  if (mbm.media === 1) return null;
  if (mbm.rtuNodes.length === 0) return null;
  return container(9, [
    array(
      mbm.rtuNodes.map((rtu) => [...rtuConfigNodes(rtu, true), devicesNode(rtu.devices, 8)]),
    ),
  ]);
}

/** MbmTcpNode.CreateXblNodeList (MbmTcpNode.cs:127-164). */
function tcpNodeItemList(tcp: EnabledTcpNode): XblElementSpec[] {
  const devices =
    tcp.devices.length > 0
      ? tcp.devices.map((d) => deviceItemList(d, false))
      : // Empty TCP node placeholder: slave 1 + first/last 0xFFFF/0x0000.
        [
          [
            node(1, new Uint8Array([1])),
            node(2, new Uint8Array([255, 255, 0, 0])),
          ],
        ];
  return [
    node(1, ipv4Bytes(tcp.ip)),
    node(2, u16be(tcp.port)),
    node(3, u16be(tcp.timeInterFrameOnSlaveChange)),
    node(4, u16be(tcp.retryTimeout)),
    node(5, u16be(tcp.connTimeout)),
    node(6, u16be(tcp.rxTimeout)),
    container(7, [array(devices)]),
    node(8, u32be(tcp.timeInterFrame)),
  ];
}

function tcpNodesArrayNode(mbm: XblPipelineResult["mbm"]): XblElementSpec | null {
  if (mbm.media === 0) return null;
  if (mbm.tcpNodes.length === 0) return null;
  return container(5, [array(mbm.tcpNodes.map(tcpNodeItemList))]);
}

/** MbmObject.GenerateXBLItem (MbmObject.cs:94-179). */
function signalItemList(obj: EnabledMbmObject, rtuNodesCount: number): XblElementSpec[] {
  // Port mapping: RTU port 0 → 0, further RTU ports → +10, TCP → 1-based.
  let port = obj.port;
  if (obj.port > 0 && obj.port < rtuNodesCount) port = obj.port + 10;
  else if (obj.port >= rtuNodesCount) port = obj.port - rtuNodesCount + 1;
  const out: XblElementSpec[] = [
    node(1, new Uint8Array([port & 0xff])),
    node(2, new Uint8Array([obj.deviceIndex & 0xff])),
  ];
  if (obj.readFunc !== -1) out.push(node(3, new Uint8Array([obj.readFunc & 0xff])));
  if (obj.writeFunc !== -1) out.push(node(4, new Uint8Array([obj.writeFunc & 0xff])));
  out.push(node(5, new Uint8Array([obj.dataLength & 0xff])));
  // NO_FORMAT (-1) is written as 0 (MbmObject.cs:128).
  out.push(node(6, new Uint8Array([obj.format === -1 ? 0 : obj.format & 0xff])));
  out.push(node(7, new Uint8Array([obj.byteOrder & 0xff])));
  if (obj.bit !== -1) out.push(node(8, new Uint8Array([obj.bit & 0xff])));
  // Base-1 devices address registers from 1; the wire address is one less.
  const address = obj.base === 1 ? obj.address - 1 : obj.address;
  out.push(node(9, shrunkU16be(address)));
  out.push(node(10, externalIdBytes(obj.externalId)));
  out.push(node(11, shrunkU16be(obj.configId)));
  if (obj.readFunc !== -1 && obj.conversionId !== 255) {
    out.push(node(12, new Uint8Array([obj.conversionId & 0xff])));
  }
  if (obj.numOfBits !== -1) out.push(node(13, new Uint8Array([obj.numOfBits & 0xff])));
  if (obj.isBroadcast) out.push(node(14, new Uint8Array([1])));
  return out;
}

function signalsNode(mbm: XblPipelineResult["mbm"]): XblElementSpec | null {
  if (mbm.signals.length === 0) return null;
  return container(6, [
    array(mbm.signals.map((obj) => signalItemList(obj, mbm.rtuNodes.length))),
  ]);
}

/** ExternalMbm.CreatePollRecordsNode (ExternalMbm.cs:521-549). */
function pollRecordsNode(mbm: XblPipelineResult["mbm"]): XblElementSpec | null {
  if (mbm.pollRecords.length === 0) return null;
  return container(7, [
    array(
      mbm.pollRecords.map((rec) => {
        const firstLast = new Uint8Array(4);
        firstLast.set(u16be(rec.indexFirst), 0);
        firstLast.set(u16be(rec.indexLast), 2);
        return [
          node(1, firstLast),
          node(2, u16be(rec.regStop - rec.regStart + 1)),
        ];
      }),
    ),
  ]);
}

/**
 * Port of ExternalMbm.CreateExternalXBLNode (:363-462). Returns null when
 * nothing is enabled (the whole tag-6 subtree is then omitted).
 */
export function buildMbmNode(mbm: XblPipelineResult["mbm"]): XblElementSpec | null {
  if (!mbm.nodeEmitted) return null;

  // Media 2 (Both) resolves to the actually-enabled side (:381-402).
  let media = mbm.media;
  if (media === 2) {
    if (mbm.rtuNodes.length === 0) media = 1;
    else if (mbm.tcpNodes.length === 0) media = 0;
  }

  const children: XblElementSpec[] = [node(1, new Uint8Array([media & 0xff]))];
  // Deadband is a little-endian float (plain BitConverter) — an explicit
  // endianness exception of the format (:405-409).
  if (mbm.deadband !== 0) {
    children.push(node(8, f32le(mbm.deadband)));
  }
  if (mbm.rtuNodes.length === 1 && mbm.rtuNodes[0].physicalPort === 0) {
    const config = rtuSingleConfigNode(mbm.rtuNodes[0], mbm.media);
    if (config) children.push(config);
    children.push(devicesNode(mbm.rtuNodes[0].devices, 3));
  } else {
    const rtuArray = rtuNodesArrayNode(mbm);
    if (rtuArray) children.push(rtuArray);
  }
  children.push(node(4, new Uint8Array([mbm.pollRecordsEnabled ? 1 : 0])));
  const tcpArray = tcpNodesArrayNode(mbm);
  if (tcpArray) children.push(tcpArray);
  const signals = signalsNode(mbm);
  if (signals) children.push(signals);
  const pollRecords = pollRecordsNode(mbm);
  if (pollRecords) children.push(pollRecords);
  // Device count across enabled nodes (the C# Select(...).Count() counts all
  // devices contained in enabled nodes, :448-451).
  const deviceCount =
    mbm.rtuNodes.reduce((n, r) => n + r.devices.length, 0) +
    mbm.tcpNodes.reduce((n, t) => n + t.devices.length, 0);
  children.push(node(11, u16be(deviceCount)));
  return container(6, children);
}
