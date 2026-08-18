/**
 * KNX–MBM XBL pipeline: parse the .ibmaps XML into the exact intermediate
 * structures the MAPS XBL writers consume, porting
 * `IntesisProjectKnxMbm.PreXBLActions`
 * (temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS.Projects/IntesisProjectKnxMbm.cs:310-396)
 * and the parsers in `InternalKnx.ParseProtocolXML` / `KnxComObject(XmlNode)` /
 * `ExternalMbm.ParseProtocolXML` / `ParseMBMObjects` / `MbmRtuNode(XmlNode)` /
 * `MbmTcpNode(XmlNode)` / `MbmDevice(XmlNode)`.
 *
 * The generator works from the XmlDocument directly (not the UI model in
 * `../model.ts`) because the writers need fields the model deliberately drops
 * (`UpdateGA`, per-side `Virtual` flags, gateway `Pwd`, USB/security config).
 */

import {
  getAttr,
  getText,
  XmlDocument,
  type XmlElement,
} from "@/core/project-format";
import { parseGroupAddress } from "@/protocols/knx";

// --- parsed (pre-XBL) structures -------------------------------------------

export interface ConversionIdRef {
  index: number;
  inverted: boolean;
}

export interface ParsedConversion {
  type: number;
  params: [number, number, number, number];
}

export interface ActiveConversion extends ParsedConversion {
  isLast: boolean;
}

export interface KnxObjectParsed {
  active: boolean;
  dpt: number;
  sendingGA: number;
  listeningGAs: number[];
  flags: { u: boolean; t: boolean; ri: boolean; w: boolean; r: boolean };
  priority: number;
  updateGA: number;
  isVirtual: boolean;
  filterIds: ConversionIdRef[];
  operationIds: ConversionIdRef[];
}

export interface MbmObjectParsed {
  configId: number;
  port: number;
  deviceIndex: number;
  isBroadcast: boolean;
  readFunc: number;
  writeFunc: number;
  dataLength: number;
  format: number;
  byteOrder: number;
  bit: number;
  numOfBits: number;
  address: number;
  base: number;
  isVirtual: boolean;
  filterIds: ConversionIdRef[];
  operationIds: ConversionIdRef[];
}

export interface DeviceParsed {
  slave: number;
  base: number;
  timeout: number;
  enabled: boolean;
}

export interface RtuNodeParsed {
  baudrate: number;
  dataBits: number;
  parity: number;
  stopBits: number;
  timeInterFrame: number;
  /** In MAPS the XML attribute is ignored: the node index wins (see below). */
  physicalPort: number;
  pollAfterWrite: boolean;
  pollReadSignal: boolean;
  devices: DeviceParsed[];
}

export interface TcpNodeParsed {
  ip: string;
  port: number;
  /** XML attr `TimeInterFrame` → C# TimeInterFrameOnSlvChg (XBL tag 3). */
  timeInterFrameOnSlaveChange: number;
  retryTimeout: number;
  connTimeout: number;
  rxTimeout: number;
  /** XML attr `TimeInterFrameNode` → C# TimeInterFrame (XBL tag 8). */
  timeInterFrame: number;
  devices: DeviceParsed[];
}

// --- enabled (post-PreXBLActions) structures --------------------------------

export interface EnabledKnxObject extends KnxObjectParsed {
  externalId: number;
  conversionId: number;
}

export interface EnabledMbmObject extends MbmObjectParsed {
  externalId: number;
  conversionId: number;
}

export interface EnabledDevice extends DeviceParsed {
  firstIndex: number;
  lastIndex: number;
  errExternalId: number;
}

export interface EnabledRtuNode extends RtuNodeParsed {
  devices: EnabledDevice[];
  idxPollReadSignal: number;
}

export interface EnabledTcpNode extends TcpNodeParsed {
  devices: EnabledDevice[];
}

export interface PollRecordOut {
  indexFirst: number;
  indexLast: number;
  regStart: number;
  regStop: number;
}

export interface XblPipelineResult {
  header: { description: string; compVersion: string; endianess: boolean };
  ibox: {
    ip: string;
    netmask: string;
    gateway: string;
    dhcp: boolean;
    pwd: string;
    name: string;
    dns: string;
    dns2: string;
    usb: {
      getLogs: boolean;
      getProject: boolean;
      saveProject: boolean;
      saveFirm: boolean;
      spons: boolean;
      comms: boolean;
      debugLevel: number;
      verboseLevel: number;
    };
    security: { tcpDisabled: boolean; udpDisabled: boolean; customPort: boolean; port: number };
  };
  activeConversions: ActiveConversion[];
  knx: {
    physicalAddress: number;
    keys: [string, string, string];
    objects: EnabledKnxObject[];
  };
  mbm: {
    nodeEmitted: boolean;
    media: number;
    deadband: number;
    pollRecordsEnabled: boolean;
    rtuNodes: EnabledRtuNode[];
    tcpNodes: EnabledTcpNode[];
    signals: EnabledMbmObject[];
    pollRecords: PollRecordOut[];
  };
}

// --- entry point -------------------------------------------------------------

/**
 * Port of `IntesisProjectKnxMbm.PreXBLActions` plus the XML parsing that
 * feeds it. Throws on malformed input (like the C# generators, which fail the
 * whole generation on parse errors).
 */
export function runXblPipeline(doc: XmlDocument): XblPipelineResult {
  const internal = doc.find(["InternalProtocol"]);
  const external = doc.find(["ExternalProtocol"]);
  if (!internal || !external) {
    throw new Error("Project XML lacks InternalProtocol/ExternalProtocol");
  }

  const knxObjects = parseKnxObjects(internal);
  const mbmObjects = parseMbmObjects(external);
  if (knxObjects.length !== mbmObjects.length) {
    // C# indexes MbmObjects[i] from the KnxObjects loop — a count mismatch
    // throws there too.
    throw new Error(
      `KNX/MBM signal count mismatch: ${knxObjects.length} vs ${mbmObjects.length}`,
    );
  }
  const rtuNodes = parseRtuNodes(external);
  const tcpNodes = parseTcpNodes(external);
  const media = parseIntText(external, "Media", 0);
  const deadband = parseFloatText(external, "Deadband", 0);
  const poll = external.children.find(
    (c): c is XmlElement => c.kind === "element" && c.tag === "PollRecords",
  );
  const pollRecordsEnabled = parseBoolAttr(poll, "Enabled", false);
  const pollRecordMissReg = parseBoolAttr(poll, "UseMissingReg", false);
  const pollRecordMaxReg = parseNumberAttr(poll, "MaxRegisters", 100);

  const { filters, operations } = parseConversions(doc);

  // --- PreXBLActions (IntesisProjectKnxMbm.cs:310-381) ----------------------
  const enabledKnx: EnabledKnxObject[] = [];
  const enabledMbm: EnabledMbmObject[] = [];
  const enabledError: EnabledMbmObject[] = [];
  for (let i = 0; i < knxObjects.length; i++) {
    const knx = knxObjects[i];
    const mbm: EnabledMbmObject = { ...mbmObjects[i], externalId: 0, conversionId: 255 };
    if (knx.active && !knx.isVirtual && isEnabledDevice(mbm, rtuNodes, tcpNodes, media)) {
      const obj: EnabledKnxObject = { ...knx, externalId: enabledKnx.length, conversionId: 255 };
      enabledKnx.push(obj);
      mbm.externalId = enabledKnx.length - 1;
      enabledMbm.push(mbm);
    } else if (knx.active && knx.isVirtual && isEnabledDevice(mbm, rtuNodes, tcpNodes, media)) {
      const obj: EnabledKnxObject = { ...knx, externalId: -1, conversionId: 255 };
      enabledKnx.push(obj);
      mbm.externalId = enabledKnx.length - 1;
      enabledError.push(mbm);
    }
  }

  const { enabledRtu, enabledTcp } = createEnabledDevicesLists(
    rtuNodes,
    tcpNodes,
    media,
    enabledMbm,
    enabledError,
  );

  sortMbmArray(enabledMbm, enabledRtu, enabledTcp, pollRecordsEnabled);

  // Re-link KNX ExternalIDs to the sorted MBM positions
  // (IntesisProjectKnxMbm.cs:347-356).
  for (let j = 0; j < enabledMbm.length; j++) {
    const externalId = enabledMbm[j].externalId;
    if (externalId !== -1 && externalId !== 65535) {
      enabledKnx[externalId].externalId = j;
    }
  }
  // Error (virtual) objects without device: point the KNX object at the MBM
  // error external-id space (IntesisProjectKnxMbm.cs:357-366 +
  // IntesisMb.ConstructMBMExternalID).
  for (const err of enabledError) {
    if (err.deviceIndex === -1) {
      enabledKnx[err.externalId].externalId = constructMbmExternalId(err, -1, enabledRtu.length);
    }
  }

  // CreateConversionsTable (IntesisProjectKnxMbm.cs:383-396): KNX first, then MBM.
  const activeConversions: ActiveConversion[] = [];
  for (const obj of enabledKnx) {
    obj.conversionId =
      obj.filterIds.length > 0 || obj.operationIds.length > 0
        ? createConversionList(obj.filterIds, obj.operationIds, filters, operations, activeConversions)
        : 255;
  }
  for (const obj of enabledMbm) {
    obj.conversionId =
      obj.filterIds.length > 0 || obj.operationIds.length > 0
        ? createConversionList(obj.filterIds, obj.operationIds, filters, operations, activeConversions)
        : 255;
  }

  const pollRecords = pollRecordsEnabled
    ? generateAllPollRecords(enabledMbm, enabledRtu, enabledTcp, pollRecordMaxReg, pollRecordMissReg)
    : [];

  const nodeEmitted =
    enabledRtu.length > 0 ||
    enabledTcp.length > 0 ||
    enabledMbm.length > 0 ||
    enabledError.length > 0;

  return {
    header: parseHeader(doc),
    ibox: parseIbox(doc),
    activeConversions,
    knx: {
      physicalAddress: parseIntText(internal, "IndAddress", 65535),
      keys: parseKeys(internal),
      objects: enabledKnx,
    },
    mbm: {
      nodeEmitted,
      media,
      deadband,
      pollRecordsEnabled,
      rtuNodes: enabledRtu,
      tcpNodes: enabledTcp,
      signals: enabledMbm,
      pollRecords,
    },
  };
}

// --- XML parsing -------------------------------------------------------------

function childrenOf(el: XmlElement, tag: string): XmlElement[] {
  return el.children.filter((c): c is XmlElement => c.kind === "element" && c.tag === tag);
}

function child(el: XmlElement, tag: string): XmlElement | undefined {
  return el.children.find((c): c is XmlElement => c.kind === "element" && c.tag === tag);
}

function textOf(el: XmlElement | undefined, tag: string): string | undefined {
  if (!el) return undefined;
  const c = child(el, tag);
  return c ? getText(c) : undefined;
}

function parseIntText(el: XmlElement, tag: string, fallback: number): number {
  const v = textOf(el, tag);
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function parseFloatText(el: XmlElement, tag: string, fallback: number): number {
  const v = textOf(el, tag);
  if (v === undefined || v === "") return fallback;
  const n = parseFloatLenient(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Port of IntesisXML.GetFloatValue (accepts both "." and "," decimals). */
function parseFloatLenient(value: string): number {
  return Number(value.replace(",", "."));
}

function parseBoolText(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() === "true";
}

function parseBoolAttr(el: XmlElement | undefined, name: string, fallback: boolean): boolean {
  return parseBoolText(el ? getAttr(el, name) : undefined, fallback);
}

function parseNumberAttr(el: XmlElement | undefined, name: string, fallback: number): number {
  const v = el ? getAttr(el, name) : undefined;
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseStringAttr(el: XmlElement | undefined, name: string, fallback: string): string {
  const v = el ? getAttr(el, name) : undefined;
  return v ?? fallback;
}

/**
 * Port of IntesisConversion.ParseConversionIDs. DEVIATION: empty segments
 * (e.g. a trailing ";") are skipped instead of throwing — the C# parser would
 * fail the whole project load on them.
 */
function parseConversionIds(value: string | undefined): ConversionIdRef[] {
  if (!value) return [];
  const out: ConversionIdRef[] = [];
  for (const segment of value.split(";")) {
    if (segment === "") continue;
    const [idx, inv] = segment.split(",");
    out.push({ index: Number(idx), inverted: Number(inv) === 1 });
  }
  return out;
}

/** GroupAddress(XmlNode): invalid/empty values decode to address 0. */
function parseGaAttr(el: XmlElement | undefined): number {
  const v = el ? getAttr(el, "Value") : undefined;
  if (v === undefined) return 0;
  return parseGroupAddress(v) ?? 0;
}

function parseKnxObjects(internal: XmlElement): KnxObjectParsed[] {
  return childrenOf(internal, "KNXObject").map((el) => {
    const flagsEl = child(el, "Flags");
    const virtEl = child(el, "Virtual");
    const listeningEl = child(el, "ListeningAddresses");
    return {
      active: parseBoolText(textOf(el, "Active"), true),
      dpt: parseNumberAttr(child(el, "DPT"), "Value", 0),
      sendingGA: parseGaAttr(child(el, "SendingAddress")),
      listeningGAs: listeningEl ? childrenOf(listeningEl, "Address").map(parseGaAttr) : [],
      flags: {
        u: parseBoolAttr(flagsEl, "U", false),
        t: parseBoolAttr(flagsEl, "T", false),
        ri: parseBoolAttr(flagsEl, "Ri", false),
        w: parseBoolAttr(flagsEl, "W", false),
        r: parseBoolAttr(flagsEl, "R", false),
      },
      priority: parseIntText(el, "Priority", 3),
      updateGA: parseIntText(el, "UpdateGA", 0),
      isVirtual: parseBoolAttr(virtEl, "Status", false),
      filterIds: parseConversionIds(textOf(el, "IdxFilters")),
      operationIds: parseConversionIds(textOf(el, "IdxOperations")),
    };
  });
}

function parseMbmObjects(external: XmlElement): MbmObjectParsed[] {
  const signals = childrenOf(external, "Signals").flatMap((c) => childrenOf(c, "Signal"));
  return signals.map((el) => {
    // ParseMBMObjects (ExternalMbm.cs:737-792).
    let port = parseIntText(el, "Port", 0);
    if (port === 255) port = -1;
    let format = parseIntText(el, "Format", 0);
    if (format === 5) format = -1; // STRING → NO_FORMAT
    let numOfBits = parseIntText(el, "NumOfBits", 0);
    if (numOfBits === 0) numOfBits = 1;
    const virtEl = child(el, "Virtual");
    const isVirtual = parseBoolAttr(virtEl, "Status", false);
    return {
      configId: parseIntText(el, "idxConfig", 0),
      port,
      deviceIndex: parseIntText(el, "DeviceIndex", 0),
      isBroadcast: parseBoolText(textOf(el, "IsBroadcast"), false),
      readFunc: parseIntText(el, "ReadFunc", -1),
      writeFunc: parseIntText(el, "WriteFunc", -1),
      // Virtual objects get DataLength -1 (ExternalMbm.cs:786-789).
      dataLength: isVirtual ? -1 : parseIntText(el, "LenBits", 0),
      format,
      byteOrder: parseIntText(el, "ByteOrder", 0),
      bit: parseIntText(el, "Bit", 0),
      numOfBits,
      address: parseIntText(el, "Address", 0),
      base: 0,
      isVirtual,
      filterIds: parseConversionIds(textOf(el, "IdxFilters")),
      operationIds: parseConversionIds(textOf(el, "IdxOperations")),
    };
  });
}

function parseDevice(el: XmlElement): DeviceParsed {
  return {
    slave: parseNumberAttr(el, "SlaveNum", 1),
    base: parseNumberAttr(el, "BaseRegister", 0),
    // MbmDevice(XmlNode) clamps timeout to a 100 ms minimum.
    timeout: Math.max(100, parseNumberAttr(el, "Timeout", 1000)),
    enabled: parseBoolAttr(el, "Enabled", true),
  };
}

function parseRtuNodes(external: XmlElement): RtuNodeParsed[] {
  return childrenOf(external, "RtuNodes")
    .flatMap((c) => childrenOf(c, "RtuNode"))
    .map((el, i) => ({
      baudrate: parseNumberAttr(el, "Baudrate", 9600),
      dataBits: parseNumberAttr(el, "DataBits", 8),
      parity: parseNumberAttr(el, "Parity", 0),
      stopBits: parseNumberAttr(el, "StopBits", 1),
      timeInterFrame: parseNumberAttr(el, "TimeInterFrame", 60),
      // UNVERIFIED edge: ExternalMbm.ParseRtuNodes (ExternalMbm.cs:681-697)
      // builds MbmRtuNode(node, i) and then OVERRIDES PhysicalPort with the
      // node index `i`, ignoring the XML attribute.
      physicalPort: i,
      pollAfterWrite: parseBoolAttr(el, "PollAfterWrite", false),
      pollReadSignal: parseBoolAttr(el, "PollReadSignal", false),
      devices: childrenOf(el, "Device").map(parseDevice),
    }));
}

function parseTcpNodes(external: XmlElement): TcpNodeParsed[] {
  return childrenOf(external, "TCPNodes")
    .flatMap((c) => childrenOf(c, "TCPNode"))
    .map((el) => ({
      ip: parseStringAttr(el, "IP", "0.0.0.0"),
      port: parseNumberAttr(el, "Port", 502),
      // MbmTcpNode(XmlNode): "TimeInterFrame" feeds TimeInterFrameOnSlvChg,
      // clamped to ≥100; "TimeInterFrameNode" feeds TimeInterFrame (default 10).
      timeInterFrameOnSlaveChange: Math.max(100, parseNumberAttr(el, "TimeInterFrame", 0)),
      retryTimeout: parseNumberAttr(el, "RetryTimeout", 5000),
      connTimeout: parseNumberAttr(el, "ConnTimeout", 10000),
      rxTimeout: parseNumberAttr(el, "RxTimeout", 5000),
      timeInterFrame: parseNumberAttr(el, "TimeInterFrameNode", 10),
      devices: childrenOf(el, "Device").map(parseDevice),
    }));
}

function parseConversions(doc: XmlDocument): {
  filters: ParsedConversion[];
  operations: ParsedConversion[];
} {
  // IntesisXML.ParseConversionsFromXML: FILTER (0) → filters, rest → operations.
  const containerEl = doc.find(["IBOX", "Conversions"]);
  const filters: ParsedConversion[] = [];
  const operations: ParsedConversion[] = [];
  if (!containerEl) return { filters, operations };
  for (const el of childrenOf(containerEl, "Conversion")) {
    const conv: ParsedConversion = {
      type: parseNumberAttr(el, "Type", 0),
      params: [
        parseFloatLenient(parseStringAttr(el, "Param1", "0")),
        parseFloatLenient(parseStringAttr(el, "Param2", "0")),
        parseFloatLenient(parseStringAttr(el, "Param3", "0")),
        parseFloatLenient(parseStringAttr(el, "Param4", "0")),
      ],
    };
    (conv.type === 0 ? filters : operations).push(conv);
  }
  return { filters, operations };
}

function parseHeader(doc: XmlDocument): XblPipelineResult["header"] {
  return {
    description: doc.getAttr(["Header"], "Description") ?? "",
    compVersion: doc.getAttr(["Header"], "CompatibilityVersion") ?? "0.0.0.0",
    // C# uses Convert.ToBoolean ("True"/"False"); tolerate "1"/"0" too.
    endianess: ["true", "1"].includes(
      (doc.getAttr(["Header"], "Endianess") ?? "").toLowerCase(),
    ),
  };
}

function parseKeys(internal: XmlElement): [string, string, string] {
  const keys = child(internal, "Keys");
  return [
    parseStringAttr(keys, "Key1", "0001"),
    parseStringAttr(keys, "Key2", "0002"),
    parseStringAttr(keys, "Key3", "0003"),
  ];
}

function parseIbox(doc: XmlDocument): XblPipelineResult["ibox"] {
  const usbEl = doc.find(["IBOX", "USBConfig"]);
  const secEl = doc.find(["IBOX", "SecurityConfiguration"]);
  return {
    ip: doc.getAttr(["IBOX"], "IP") ?? "",
    netmask: doc.getAttr(["IBOX"], "NetMask") ?? "",
    gateway: doc.getAttr(["IBOX"], "Gateway") ?? "",
    dhcp: parseBoolText(doc.getAttr(["IBOX"], "DHCP"), false),
    // The gateway password is part of the compiled XBL (IBOX tag 5). The
    // generator reads it straight from the XML — never from the UI model.
    pwd: doc.getAttr(["IBOX"], "Pwd") ?? "",
    name: doc.getAttr(["IBOX"], "Name") ?? "",
    dns: doc.getAttr(["IBOX"], "DNS") ?? "",
    dns2: doc.getAttr(["IBOX"], "DNS2") ?? "",
    // UsbConfig(XmlNode) defaults: all flags true, levels 1.
    usb: {
      getLogs: parseBoolAttr(usbEl, "GetLogs", true),
      getProject: parseBoolAttr(usbEl, "GetProject", true),
      saveProject: parseBoolAttr(usbEl, "SaveProject", true),
      saveFirm: parseBoolAttr(usbEl, "SaveFirm", true),
      spons: parseBoolAttr(usbEl, "SponsEnabled", true),
      comms: parseBoolAttr(usbEl, "CommsEnabled", true),
      debugLevel: parseNumberAttr(usbEl, "DebugLevel", 1),
      verboseLevel: parseNumberAttr(usbEl, "VerboseLevel", 1),
    },
    // SecurityConfig(XmlNode) defaults: all false, port 23. IsLow is a
    // runtime-only property (IntesisLicense.IsLowProject) — false for
    // IBOX_KNX_MBM.
    security: {
      tcpDisabled: parseBoolAttr(secEl, "TCPDisabled", false),
      udpDisabled: parseBoolAttr(secEl, "UDPDisabled", false),
      customPort: parseBoolAttr(secEl, "CustomPort", false),
      port: parseNumberAttr(secEl, "Port", 23),
    },
  };
}

// --- PreXBLActions helpers ---------------------------------------------------

/** Port of ExternalMbm.IsEnabledDevice (ExternalMbm.cs:1981-2021). */
function isEnabledDevice(
  obj: MbmObjectParsed,
  rtuNodes: RtuNodeParsed[],
  tcpNodes: TcpNodeParsed[],
  media: number,
): boolean {
  if (obj.port < rtuNodes.length && media === 1) return false;
  if (obj.port >= rtuNodes.length && media === 0) return false;
  const deviceIndex = obj.deviceIndex;
  if (deviceIndex === -1) {
    if (obj.isVirtual) return true;
    if (obj.isBroadcast) return true;
    return false;
  }
  if (obj.port < rtuNodes.length) {
    return rtuNodes[obj.port]?.devices[deviceIndex]?.enabled ?? false;
  }
  return tcpNodes[obj.port - rtuNodes.length]?.devices[deviceIndex]?.enabled ?? false;
}

/** Port of ExternalMbm.CreateEnabledDevicesList (+ Rtu/Tcp) (ExternalMbm.cs:3251-3323). */
function createEnabledDevicesLists(
  rtuNodes: RtuNodeParsed[],
  tcpNodes: TcpNodeParsed[],
  media: number,
  enabledMbm: EnabledMbmObject[],
  enabledError: EnabledMbmObject[],
): { enabledRtu: EnabledRtuNode[]; enabledTcp: EnabledTcpNode[] } {
  let enabledRtu: EnabledRtuNode[] = [];
  if (media !== 1) {
    enabledRtu = buildEnabledRtu(rtuNodes, enabledMbm, enabledError);
  }
  if (enabledRtu.length < rtuNodes.length) {
    // Skipped RTU nodes shift the TCP port space down (ExternalMbm.cs:3258-3268).
    const shift = rtuNodes.length - enabledRtu.length;
    for (const obj of enabledMbm) if (obj.port >= rtuNodes.length) obj.port -= shift;
    for (const obj of enabledError) if (obj.port >= rtuNodes.length) obj.port -= shift;
  }
  let enabledTcp: EnabledTcpNode[] = [];
  if (media !== 0) {
    enabledTcp = buildEnabledTcp(tcpNodes, enabledRtu.length, enabledMbm, enabledError);
  }
  return { enabledRtu, enabledTcp };
}

function cloneDevice(d: DeviceParsed): EnabledDevice {
  return { ...d, firstIndex: 0, lastIndex: 0, errExternalId: -1 };
}

function buildEnabledRtu(
  rtuNodes: RtuNodeParsed[],
  enabledMbm: EnabledMbmObject[],
  enabledError: EnabledMbmObject[],
): EnabledRtuNode[] {
  const out: EnabledRtuNode[] = [];
  for (let i = 0; i < rtuNodes.length; i++) {
    let referenced = false;
    const devices: EnabledDevice[] = [];
    for (let j = 0; j < rtuNodes[i].devices.length; j++) {
      const used =
        enabledMbm.some((x) => x.port === i && x.deviceIndex === j) ||
        enabledError.some((x) => x.port === i && x.deviceIndex === j);
      if (!used) continue;
      referenced = true;
      const dev = cloneDevice(rtuNodes[i].devices[j]);
      for (const obj of enabledMbm.filter((x) => x.port === i && x.deviceIndex === j)) {
        obj.port = out.length;
        obj.deviceIndex = devices.length;
        obj.base = dev.base;
      }
      for (const obj of enabledError.filter((x) => x.port === i && x.deviceIndex === j)) {
        obj.port = out.length;
        obj.deviceIndex = devices.length;
        obj.base = dev.base;
        dev.errExternalId = obj.externalId;
      }
      devices.push(dev);
    }
    for (const obj of enabledMbm.filter((x) => x.port === i && x.isBroadcast)) {
      referenced = true;
      obj.port = out.length;
    }
    if (!referenced) continue;
    // UNVERIFIED edge: MAPS compares the error object's (unremapped, original)
    // port against the NEW node index; identical unless earlier RTU nodes were
    // skipped (ExternalMbm.cs:3370-3374).
    const pollRead = enabledError.find((x) => x.port === out.length && x.deviceIndex === -1);
    out.push({
      ...rtuNodes[i],
      devices,
      idxPollReadSignal: pollRead ? pollRead.externalId : -1,
    });
  }
  return out;
}

function buildEnabledTcp(
  tcpNodes: TcpNodeParsed[],
  rtuOffset: number,
  enabledMbm: EnabledMbmObject[],
  enabledError: EnabledMbmObject[],
): EnabledTcpNode[] {
  const out: EnabledTcpNode[] = [];
  for (let i = 0; i < tcpNodes.length; i++) {
    let referenced = false;
    const devices: EnabledDevice[] = [];
    for (let j = 0; j < tcpNodes[i].devices.length; j++) {
      const used =
        enabledMbm.some((x) => x.port === rtuOffset + i && x.deviceIndex === j) ||
        enabledError.some((x) => x.port === rtuOffset + i && x.deviceIndex === j);
      if (!used) continue;
      referenced = true;
      const dev = cloneDevice(tcpNodes[i].devices[j]);
      for (const obj of enabledMbm.filter((x) => x.port === rtuOffset + i && x.deviceIndex === j)) {
        obj.port = rtuOffset + out.length;
        obj.deviceIndex = devices.length;
        obj.base = dev.base;
      }
      for (const obj of enabledError.filter((x) => x.port === rtuOffset + i && x.deviceIndex === j)) {
        obj.port = rtuOffset + out.length;
        obj.deviceIndex = devices.length;
        obj.base = dev.base;
        dev.errExternalId = obj.externalId;
      }
      devices.push(dev);
    }
    // UNVERIFIED (verbatim port): MAPS sets a broadcast signal's port to the
    // bare TCP index WITHOUT the RTU offset (ExternalMbm.cs:3310-3314) — this
    // makes TCP broadcast signals look like RTU ones when RTU nodes exist.
    for (const obj of enabledMbm.filter(
      (x) => x.port === rtuOffset + out.length && x.isBroadcast,
    )) {
      referenced = true;
      obj.port = out.length;
    }
    if (referenced) {
      out.push({ ...tcpNodes[i], devices });
    }
  }
  return out;
}

/**
 * Port of ExternalMbm.SortMBMArray (ExternalMbm.cs:551-619): read signals
 * first, then write-only; each group sorted by Port → DeviceIndex (→ ReadFunc
 * → Address → Bit when poll records are enabled). JS sort is stable, like
 * LINQ OrderBy/ThenBy.
 */
function sortMbmArray(
  enabledMbm: EnabledMbmObject[],
  enabledRtu: EnabledRtuNode[],
  enabledTcp: EnabledTcpNode[],
  pollRecordsEnabled: boolean,
): void {
  const cmp = (a: EnabledMbmObject, b: EnabledMbmObject): number => {
    if (a.port !== b.port) return a.port - b.port;
    if (a.deviceIndex !== b.deviceIndex) return a.deviceIndex - b.deviceIndex;
    if (pollRecordsEnabled) {
      if (a.readFunc !== b.readFunc) return a.readFunc - b.readFunc;
      if (a.address !== b.address) return a.address - b.address;
      return a.bit - b.bit;
    }
    return 0;
  };
  const read = enabledMbm.filter((o) => o.readFunc !== -1).sort(cmp);
  const writeOnly = enabledMbm.filter((o) => o.readFunc === -1).sort(cmp);

  // Device FirstIndex/LastIndex are computed against the READ list only.
  const assignIndexes = (devices: EnabledDevice[], portIndex: number): void => {
    for (const dev of devices) {
      const first = read.findIndex((x) => x.deviceIndex === devices.indexOf(dev) && x.port === portIndex);
      const last = read.findLastIndex((x) => x.deviceIndex === devices.indexOf(dev) && x.port === portIndex);
      dev.firstIndex = first === -1 ? 65535 : first;
      dev.lastIndex = last === -1 ? 0 : last;
    }
  };
  enabledRtu.forEach((node, i) => assignIndexes(node.devices, i));
  enabledTcp.forEach((node, i) => assignIndexes(node.devices, i + enabledRtu.length));

  enabledMbm.length = 0;
  enabledMbm.push(...read, ...writeOnly);
}

/** Port of IntesisMb.ConstructMBMExternalID (IntesisMb.cs:224-262). */
function constructMbmExternalId(
  obj: MbmObjectParsed,
  index: number,
  rtuNodesOffset: number,
): number {
  if (!obj.isVirtual) return index;
  if (obj.port === -1 && obj.deviceIndex === -1) return 63488;
  const portIndex = externalIdPortIndex(obj.port, rtuNodesOffset);
  if (obj.port !== -1 && obj.deviceIndex === -1) return 32768 + 2040 + portIndex;
  if (obj.port !== -1 && obj.deviceIndex !== -1) {
    return 32768 + portIndex + (obj.deviceIndex << 3);
  }
  return -1;
}

function externalIdPortIndex(port: number, rtuNodesOffset: number): number {
  let p = port;
  if (p !== 0) {
    if (p < rtuNodesOffset) p += 10;
    else if (rtuNodesOffset > 1) p--;
  }
  return p << 11;
}

// --- conversions table --------------------------------------------------------

function cloneConversion(c: ParsedConversion, isLast: boolean): ActiveConversion {
  return { type: c.type, params: [...c.params], isLast };
}

/**
 * Port of IntesisConversion.CreateConversion(conversion, isInverted,
 * isLastConversion) (IntesisConversion.cs:134-179).
 */
function transformConversion(
  c: ParsedConversion,
  isInverted: boolean,
  isLast: boolean,
): ActiveConversion {
  if (!isInverted) return cloneConversion(c, isLast);
  switch (c.type) {
    case 1: // SCALE: swap directions
      return { type: c.type, params: [c.params[2], c.params[3], c.params[0], c.params[1]], isLast };
    case 2: // ARITH
      return { type: c.type, params: [c.params[0], c.params[1], c.params[2], 1], isLast };
    case 4: // LUT_REMAP
      return {
        type: c.type,
        params: [c.params[0], Math.trunc(c.params[1]) | 8, c.params[2], 1],
        isLast,
      };
    default:
      return cloneConversion(c, isLast);
  }
}

function conversionEquals(a: ActiveConversion, b: ActiveConversion): boolean {
  return (
    a.type === b.type &&
    a.isLast === b.isLast &&
    a.params[0] === b.params[0] &&
    a.params[1] === b.params[1] &&
    a.params[2] === b.params[2] &&
    a.params[3] === b.params[3]
  );
}

/**
 * Port of IntesisConversion.CreateConversionList (IntesisConversion.cs:220-290):
 * non-inverted filters → operations (inversion-transformed) → inverted
 * filters; the chain is deduplicated against `activeConversions`; returns the
 * chain's start index there, or 255 when empty.
 */
function createConversionList(
  filterIds: ConversionIdRef[],
  operationIds: ConversionIdRef[],
  filters: ParsedConversion[],
  operations: ParsedConversion[],
  activeConversions: ActiveConversion[],
): number {
  const chain: ActiveConversion[] = [];
  for (const f of filterIds) {
    if (!f.inverted) chain.push(cloneConversion(filters[f.index], false));
  }
  for (const o of operationIds) {
    chain.push(transformConversion(operations[o.index], o.inverted, false));
  }
  for (const f of filterIds) {
    if (f.inverted) chain.push(cloneConversion(filters[f.index], false));
  }
  if (chain.length === 0) return 255;
  chain[chain.length - 1].isLast = true;

  let found = -1;
  for (let i = 0; i < activeConversions.length; i++) {
    if (!conversionEquals(activeConversions[i], chain[0])) continue;
    let match = true;
    for (let j = 1; j < chain.length; j++) {
      if (activeConversions.length > i + j && conversionEquals(activeConversions[i + j], chain[j])) {
        continue;
      }
      match = false;
      break;
    }
    if (match) {
      found = i;
      break;
    }
  }
  if (found === -1) {
    found = activeConversions.length;
    for (let k = 0; k < chain.length; k++) {
      activeConversions.push(cloneConversion(chain[k], k === chain.length - 1));
    }
  }
  return found;
}

// --- poll records --------------------------------------------------------------

interface PollingCandidate {
  startRegister: number;
  endRegister: number;
}

/**
 * Port of ExternalMbm.GenerateAllPollRecords (ExternalMbm.cs:2377-2500):
 * poll records are derived from the (sorted) enabled signals — never stored
 * in the XML.
 */
function generateAllPollRecords(
  enabledMbm: EnabledMbmObject[],
  enabledRtu: EnabledRtuNode[],
  enabledTcp: EnabledTcpNode[],
  maxElements: number,
  allowMissRegisters: boolean,
): PollRecordOut[] {
  const readFuncs = [...new Set(enabledMbm.map((x) => x.readFunc))].filter((f) => f !== -1);
  const out: PollRecordOut[] = [];

  const collect = (
    devices: EnabledDevice[],
    portIndex: number,
  ): void => {
    for (let devIndex = 0; devIndex < devices.length; devIndex++) {
      for (const fn of readFuncs) {
        const group = enabledMbm
          .filter((x) => x.deviceIndex === devIndex && x.port === portIndex && x.readFunc === fn)
          .sort((a, b) => a.address - b.address);
        if (group.length === 0) continue;
        const candidates = group.map((x) => {
          // GeneratePollCandidatesList (ExternalMbm.cs:2502-2525).
          let end = x.address;
          if (x.dataLength === 32) end += 1;
          else if (x.dataLength === 48) end += 2;
          else if (x.dataLength === 64) end += 3;
          return { startRegister: x.address, endRegister: end };
        });
        const records = generatePollRecordsV2(candidates, maxElements, allowMissRegisters);
        for (const rec of records) {
          const indexFirst = enabledMbm.findIndex(
            (x) =>
              x.address === rec.regStart &&
              x.deviceIndex === devIndex &&
              x.port === portIndex &&
              x.readFunc === fn,
          );
          // IndexLast: exact match, else multi-register signal ending at RegStop.
          let indexLast = 0;
          const byEnd = (offset: number, len: number): number =>
            enabledMbm.findLastIndex(
              (x) =>
                x.address + offset === rec.regStop &&
                x.dataLength === len &&
                x.deviceIndex === devIndex &&
                x.port === portIndex &&
                x.readFunc === fn,
            );
          const exactIdx = enabledMbm.findLastIndex(
            (x) =>
              x.address === rec.regStop &&
              x.deviceIndex === devIndex &&
              x.port === portIndex &&
              x.readFunc === fn,
          );
          if (exactIdx !== -1) indexLast = exactIdx;
          else if (byEnd(1, 32) !== -1) indexLast = byEnd(1, 32);
          else if (byEnd(2, 48) !== -1) indexLast = byEnd(2, 48);
          else if (byEnd(3, 64) !== -1) indexLast = byEnd(3, 64);
          out.push({ indexFirst, indexLast, regStart: rec.regStart, regStop: rec.regStop });
        }
      }
    }
  };

  enabledRtu.forEach((node, i) => collect(node.devices, i));
  enabledTcp.forEach((node, i) => collect(node.devices, i + enabledRtu.length));
  return out;
}

/**
 * Port of ExternalMbm.GeneratePollRecordsV2 (ExternalMbm.cs:2553-2604),
 * verbatim — including the post-record cursor adjustments, which only
 * influence where the NEXT record starts.
 */
function generatePollRecordsV2(
  registers: PollingCandidate[],
  maxElements: number,
  allowMissingRegisters: boolean,
): { regStart: number; regStop: number }[] {
  const out: { regStart: number; regStop: number }[] = [];
  const max = Math.max(...registers.map((x) => x.endRegister));
  const min = Math.min(...registers.map((x) => x.startRegister));
  const contains = (r: number): boolean =>
    registers.some((x) => r >= x.startRegister && r <= x.endRegister);
  let i = min;
  while (i <= max) {
    if (!registers.some((x) => x.startRegister === i)) {
      i++;
      continue;
    }
    const start = i;
    let stop = -1;
    while (i <= max && i < maxElements + start) {
      if (!contains(i) && !allowMissingRegisters) {
        stop = i - 1;
        break;
      }
      if (i - start === maxElements - 1 || i === max) {
        while (!registers.some((x) => x.endRegister === i)) {
          i--;
        }
        stop = i;
        i++;
        break;
      }
      i++;
    }
    out.push({ regStart: start, regStop: stop });
    while (!registers.some((x) => i >= x.startRegister && x.endRegister <= i)) {
      i++;
    }
    while (
      registers.some((x) => x.endRegister > stop + 1 && x.endRegister > i && x.startRegister <= i) &&
      i > start + 1
    ) {
      i--;
    }
  }
  return out;
}
