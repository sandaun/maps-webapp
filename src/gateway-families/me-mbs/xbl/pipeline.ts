/**
 * ME–MBS XBL pipeline: parse the .ibmaps XML into the exact intermediate
 * structures the MAPS XBL writers consume, porting
 * `IntesisProjectMbsMe_RT.PreXBLActions`
 * (temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS.Projects/
 * IntesisProjectMbsMe_RT.cs:321-441) and the parsers in
 * `InternalMbs.ParseProtocolXML` / `MbsObject(XmlNode)`
 * (IntesisBoxMAPS.Protocols.MB.Internal/InternalMbs.cs:900-956,
 * IntesisBoxMAPS.Protocols.MB/MbsObject.cs:92-132) and
 * `ExternalME.ParseProtocolXML` / `ParseMEObjects` / `ParseControllers`
 * (IntesisBoxMAPS.Protocols.ME/ExternalME.cs:574-646,
 * IntesisBoxMAPS.Protocols.ME/MeController.cs:72-99,
 * IntesisBoxMAPS.Protocols.ME/MeGroup.cs:33-47).
 *
 * Like the KNX–MBM pipeline, the generator works from the XmlDocument
 * directly (not the UI model in `../model.ts`) because the writers need
 * fields the model deliberately drops (gateway `Pwd`, per-side conversion id
 * refs, G50 auth fields).
 */

import {
  getAttr,
  getText,
  XmlDocument,
  type XmlElement,
} from "@/core/project-format";
import {
  createConversionList,
  parseConversionIds,
  parseConversions,
  parseRemapLuts,
  parseXblHeader,
  parseXblIbox,
  type ActiveConversion,
  type ConversionIdRef,
  type ParsedRemapLut,
  type XblHeaderFields,
  type XblIboxFields,
} from "@/core/xbl";

// --- parsed (pre-XBL) structures -------------------------------------------

/** Port of `MbsObject` (MbsObject.cs:17-55) limited to the XBL-relevant fields. */
export interface MbsSignalParsed {
  configId: number;
  isEnabled: boolean;
  lenBits: number;
  format: number;
  bit: number;
  address: number;
  readWrite: number;
  stringLength: number;
  slaveIndex: number;
  isVirtual: boolean;
  filterIds: ConversionIdRef[];
  operationIds: ConversionIdRef[];
}

/** Port of `MeObject` (MeObject.cs:10-38) limited to the XBL-relevant fields. */
export interface MeSignalParsed {
  configId: number;
  unitId: number;
  isIndoorSignal: boolean;
  groupId: number;
  g50Id: number;
  isStatus: boolean;
  signalIndex: number;
  signalSpecIndex: number;
  isVirtual: boolean;
  filterIds: ConversionIdRef[];
  operationIds: ConversionIdRef[];
}

/** Port of `MeGroup` (MeGroup.cs). */
export interface MeGroupParsed {
  idx: number;
  enabled: boolean;
  type: number;
  fanSpeed: number;
  dualSetPoint: boolean;
  urc: boolean;
  meterIndex: number;
}

/** Port of `MeController` (MeController.cs). */
export interface MeControllerParsed {
  index: number;
  enabled: boolean;
  ip: string;
  port: number;
  typeIndex: number;
  model: number;
  compatibility: number;
  setPoint05Support: number;
  addErrorSignals: boolean;
  authUserId: string;
  authPassword: string;
  certDownloadPort: number;
  persistentConnection: boolean;
  groups: MeGroupParsed[];
}

/** Port of `MBSlave` (MBSlave.cs). */
export interface MbSlaveParsed {
  address: number;
}

// --- enabled (post-PreXBLActions) structures --------------------------------

export interface EnabledMbsSignal extends MbsSignalParsed {
  externalId: number;
  conversionId: number;
}

export interface EnabledMeSignal extends MeSignalParsed {
  externalId: number;
  conversionId: number;
}

export interface EnabledMbSlave extends MbSlaveParsed {
  indexFirst: number;
  indexLast: number;
}

export interface EnabledMeController extends MeControllerParsed {
  indexCommErr: number;
}

export interface MeMbsXblPipelineResult {
  header: XblHeaderFields;
  ibox: XblIboxFields;
  activeConversions: ActiveConversion[];
  activeMappings: ParsedRemapLut[];
  mbs: {
    media: number;
    byteOrder: number;
    updateCOV: boolean;
    commErrorTout: number;
    registerBase: number;
    rtu: {
      connectionType: number;
      baudrate: number;
      dataBits: number;
      parity: number;
      stopBits: number;
      slaveNumber: number;
    };
    tcp: { port: number; keepAlive: number };
    slaveAddressMode: number;
    slaves: EnabledMbSlave[];
    signals: EnabledMbsSignal[];
  };
  me: {
    pollPeriod: number;
    ansTimeout: number;
    controllerTout: number;
    readCyclesPerAlarm: number;
    writeMaxBurst: number;
    temperatureMode: number;
    controllers: EnabledMeController[];
    signals: EnabledMeSignal[];
  };
}

// --- entry point -------------------------------------------------------------

/**
 * Port of `IntesisProjectMbsMe_RT.PreXBLActions` plus the XML parsing that
 * feeds it. Throws on malformed input (like the C# generators, which fail the
 * whole generation on parse errors).
 */
export function runMeMbsXblPipeline(doc: XmlDocument): MeMbsXblPipelineResult {
  const internal = doc.find(["InternalProtocol"]);
  const external = doc.find(["ExternalProtocol"]);
  if (!internal || !external) {
    throw new Error("Project XML lacks InternalProtocol/ExternalProtocol");
  }

  const mbsConfig = parseMbsConfig(internal);
  const mbsSignals = parseMbsSignals(internal);
  const meConfig = parseMeConfig(external);
  const meSignals = parseMeSignals(external);
  if (mbsSignals.length !== meSignals.length) {
    // C# indexes MeObjects[num] from the MbsObjects loop — a count mismatch
    // throws there too.
    throw new Error(
      `MBS/ME signal count mismatch: ${mbsSignals.length} vs ${meSignals.length}`,
    );
  }
  if (meConfig.consumptionEnabled) {
    // UNVERIFIED: with the consumption function enabled, MAPS adds an extra
    // top-level node (BI or MBM meter) and per-group meter tags — no sample
    // project exercises this, so the generator refuses instead of silently
    // producing a wrong XBL.
    throw new Error(
      "XBL generation with an enabled consumption function is not supported (no reference sample)",
    );
  }

  // --- PreXBLActions (IntesisProjectMbsMe_RT.cs:366-440) ----------------------
  // Split enabled: MBS signals with isEnabled; ME signals follow the same
  // 1:1 position.
  const enabledMbs: EnabledMbsSignal[] = [];
  const enabledMe: EnabledMeSignal[] = [];
  for (let i = 0; i < mbsSignals.length; i++) {
    if (!mbsSignals[i].isEnabled) continue;
    enabledMbs.push({ ...mbsSignals[i], externalId: enabledMbs.length, conversionId: 255 });
    enabledMe.push({ ...meSignals[i], externalId: 0, conversionId: 255 });
  }

  // OrderBy(Bit) then OrderBy(Address) — both stable, so a single stable
  // sort by (address, bit) is equivalent.
  enabledMbs.sort((a, b) => a.address - b.address || a.bit - b.bit);

  const slaves: EnabledMbSlave[] = mbsConfig.slaves.map((s) => ({
    ...s,
    indexFirst: -1,
    indexLast: -1,
  }));
  // MBSlave.SetIndexFirstLast (MBSlave.cs:56-60). C# calls it twice (before
  // and after the external-id relink); SlaveIndex never changes in between,
  // so one pass is equivalent.
  for (let i = 0; i < slaves.length; i++) {
    slaves[i].indexFirst = enabledMbs.findIndex((x) => x.slaveIndex === i);
    slaves[i].indexLast = enabledMbs.findLastIndex((x) => x.slaveIndex === i);
  }

  // Re-link ME external IDs to the sorted MBS positions
  // (IntesisProjectMbsMe_RT.cs:393-401).
  for (let i = 0; i < enabledMbs.length; i++) {
    const externalId = enabledMbs[i].externalId;
    if (externalId !== -1) {
      enabledMe[externalId] = { ...enabledMe[externalId], externalId: i };
    }
  }

  // CreateConversionsTable (IntesisProjectMbsMe_RT.cs:415-418): MBS first
  // (in sorted order), then ME (in enabled-list order). ActiveMappings takes
  // ALL the project's remap LUTs (`ActiveMappings = mRemappings`).
  const { filters, operations } = parseConversions(doc);
  const activeConversions: ActiveConversion[] = [];
  for (const obj of enabledMbs) {
    obj.conversionId =
      obj.filterIds.length > 0 || obj.operationIds.length > 0
        ? createConversionList(obj.filterIds, obj.operationIds, filters, operations, activeConversions)
        : 255;
  }
  for (const obj of enabledMe) {
    obj.conversionId =
      obj.filterIds.length > 0 || obj.operationIds.length > 0
        ? createConversionList(obj.filterIds, obj.operationIds, filters, operations, activeConversions)
        : 255;
  }

  // UpdateG50CommError (ExternalME.cs:648-665): per controller, the external
  // id of its general comm-error signal (GroupID -1, SignalIndex 9
  // ERRORSIGN), or -1 when absent.
  const controllers: EnabledMeController[] = meConfig.controllers.map((c, i) => {
    const found = enabledMe.findIndex(
      (x) => x.g50Id === i && x.groupId === -1 && x.signalIndex === 9,
    );
    return { ...c, indexCommErr: found !== -1 ? enabledMe[found].externalId : -1 };
  });

  // Final MBS external-id rewrite: each MBS signal points at the constructed
  // ME external id of its related ME signal
  // (IntesisProjectMbsMe_RT.cs:432-439 + IntesisMe.ConstructMEExternalID).
  for (const mbs of enabledMbs) {
    mbs.externalId = constructMeExternalId(enabledMe[mbs.externalId]);
  }

  return {
    header: parseXblHeader(doc),
    ibox: parseXblIbox(doc),
    activeConversions,
    activeMappings: parseRemapLuts(doc),
    mbs: { ...mbsConfig, slaves, signals: enabledMbs },
    me: { ...meConfig, controllers, signals: enabledMe },
  };
}

/** Port of IntesisMe.ConstructMEExternalID (IntesisMe.cs:143-174). */
export function constructMeExternalId(me: MeSignalParsed): number {
  const groupNum = me.groupId + 1;
  if (!me.isVirtual) {
    const g50 = me.g50Id << 14;
    const grp = (groupNum & 0x3f) << 8;
    const cmd = (me.isStatus ? 0 : 1) << 7;
    if (me.groupId !== -1) {
      const sig = me.signalIndex & 0x7f;
      return g50 | grp | cmd | sig;
    }
    let unitBase: number;
    let unitBits: number;
    if (me.unitId >= 50) {
      unitBase = 32;
      unitBits = (me.unitId - 50 + 1) << 8;
    } else {
      unitBase = 0;
      unitBits = (me.unitId + 1) << 8;
    }
    return (g50 | unitBits | cmd | unitBase | me.signalIndex) + 64;
  }
  const g50 = me.g50Id << 14;
  const cmd = (me.isStatus ? 0 : 1) << 7;
  const sig = me.signalIndex & 0x7f;
  return g50 | cmd | sig;
}

// --- XML parsing --------------------------------------------------------------

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

/** Port of InternalMbs.ParseProtocolXML (InternalMbs.cs:900-956). */
function parseMbsConfig(internal: XmlElement): Omit<
  MeMbsXblPipelineResult["mbs"],
  "slaves" | "signals"
> & { slaves: MbSlaveParsed[] } {
  // Media: C# int.TryParse, falling back to "True"→1/else 0.
  const mediaText = textOf(internal, "Media") ?? "";
  const mediaNum = Number(mediaText);
  const media = Number.isInteger(mediaNum) ? mediaNum : mediaText === "True" ? 1 : 0;
  const rtuEl = child(internal, "RTUConfig");
  const tcpEl = child(internal, "TCPConfig");
  return {
    media,
    byteOrder: parseIntText(internal, "ByteOrder", 0),
    updateCOV: parseBoolText(textOf(internal, "UpdateCOV"), false),
    commErrorTout: parseIntText(internal, "CommErrorTout", 180),
    registerBase: parseIntText(internal, "RegisterBase", 0),
    rtu: {
      connectionType: parseNumberAttr(rtuEl, "ConnectionType", 0),
      baudrate: parseNumberAttr(rtuEl, "Baudrate", 9600),
      dataBits: parseNumberAttr(rtuEl, "DataBits", 8),
      parity: parseNumberAttr(rtuEl, "Parity", 0),
      stopBits: parseNumberAttr(rtuEl, "StopBits", 1),
      slaveNumber: parseNumberAttr(rtuEl, "SlaveNumber", 1),
    },
    tcp: {
      port: parseNumberAttr(tcpEl, "Port", 502),
      keepAlive: parseNumberAttr(tcpEl, "KeepAlive", 10),
    },
    slaveAddressMode: parseIntText(internal, "SlaveAddressMode", 0),
    slaves: childrenOf(internal, "MBSlavesArray")
      .flatMap((c) => childrenOf(c, "MBSlave"))
      .map((el) => ({ address: parseNumberAttr(el, "Address", 0) })),
  };
}

/** Port of MbsObject(XmlNode) (MbsObject.cs:92-132). */
function parseMbsSignals(internal: XmlElement): MbsSignalParsed[] {
  const signals = childrenOf(internal, "Signals").flatMap((c) => childrenOf(c, "Signal"));
  return signals.map((el) => {
    const virtEl = child(el, "Virtual");
    let lenBits = parseIntText(el, "LenBits", 0);
    // GetFormatFromIndex: 255 → -1 (IntesisMb.cs:912-919).
    let format = parseIntText(el, "Format", 0);
    if (format === 255) format = -1;
    if (lenBits === 1) {
      lenBits = 16;
      format = 0; // UNSIGNED
    }
    return {
      configId: parseIntText(el, "idxConfig", 0),
      isEnabled: parseBoolText(textOf(el, "isEnabled"), false),
      lenBits,
      format,
      bit: parseIntText(el, "Bit", 0),
      address: parseIntText(el, "Address", 0),
      readWrite: parseIntText(el, "ReadWrite", 0),
      stringLength: parseIntText(el, "StringLength", -1),
      slaveIndex: parseIntText(el, "SlaveIndex", -1),
      isVirtual: parseBoolAttr(virtEl, "Status", false),
      filterIds: parseConversionIds(textOf(el, "IdxFilters")),
      operationIds: parseConversionIds(textOf(el, "IdxOperations")),
    };
  });
}

/** Port of ExternalME.ParseProtocolXML (ExternalME.cs:574-589). */
function parseMeConfig(external: XmlElement): Omit<
  MeMbsXblPipelineResult["me"],
  "controllers" | "signals"
> & { controllers: MeControllerParsed[]; consumptionEnabled: boolean } {
  const consumptionEl = child(external, "ConsumptionFunction");
  return {
    pollPeriod: parseIntText(external, "PollPeriod", 100),
    ansTimeout: parseIntText(external, "AnsTimeout", 30),
    controllerTout: parseIntText(external, "ControllerTout", 30),
    readCyclesPerAlarm: parseIntText(external, "ReadCyclesPerAlarm", 1),
    writeMaxBurst: parseIntText(external, "WriteMaxBurst", 5),
    temperatureMode: parseIntText(external, "TemperatureMode", 0),
    consumptionEnabled: parseBoolAttr(consumptionEl, "Enabled", false),
    controllers: childrenOf(external, "G50List")
      .flatMap((c) => childrenOf(c, "G50Controller"))
      .map(parseController),
  };
}

/** Port of MeController(XmlNode) (MeController.cs:72-99). */
function parseController(el: XmlElement): MeControllerParsed {
  return {
    index: parseIntText(el, "ID", 0),
    enabled: parseBoolText(textOf(el, "Enabled"), false),
    ip: textOf(el, "IP") ?? "",
    port: parseIntText(el, "Port", 80),
    typeIndex: parseIntText(el, "Type", 0),
    model: parseIntText(el, "Model", 0),
    compatibility: parseIntText(el, "Compatibility", 0),
    setPoint05Support: parseIntText(el, "Setpoint05Support", 0),
    addErrorSignals: parseBoolText(textOf(el, "AddErrorSignals"), false),
    authUserId: textOf(el, "AuthUserId") ?? "",
    authPassword: textOf(el, "AuthPassword") ?? "",
    certDownloadPort: parseIntText(el, "CertDownloadPort", 8008),
    persistentConnection: parseBoolText(textOf(el, "PersistentConnection"), false),
    groups: childrenOf(el, "GroupList")
      .flatMap((c) => childrenOf(c, "Group"))
      .map(parseGroup),
  };
}

/** Port of MeGroup(XmlNode) (MeGroup.cs:33-47). */
function parseGroup(el: XmlElement): MeGroupParsed {
  return {
    idx: parseNumberAttr(el, "Index", 0),
    enabled: parseBoolAttr(el, "Enabled", false),
    type: parseNumberAttr(el, "Type", 0),
    fanSpeed: parseNumberAttr(el, "NumOfFanSpeeds", 4),
    dualSetPoint: parseBoolAttr(el, "DualSetPoint", false),
    urc: parseBoolAttr(el, "URC", false),
    meterIndex: -1, // property default; never persisted to the project XML
  };
}

/** Port of ExternalME.ParseMEObjects (ExternalME.cs:596-632). */
function parseMeSignals(external: XmlElement): MeSignalParsed[] {
  const signals = childrenOf(external, "Signals").flatMap((c) => childrenOf(c, "Signal"));
  return signals.map((el) => {
    const virtEl = child(el, "Virtual");
    return {
      configId: parseIntText(el, "idxConfig", 0),
      unitId: parseIntText(el, "UnitId", -1),
      // C# default is TRUE (GetInnerTextWithDefault(item, "IsIndoorSignal", true)).
      isIndoorSignal: parseBoolText(textOf(el, "IsIndoorSignal"), true),
      groupId: parseIntText(el, "GroupIndex", 0),
      g50Id: parseIntText(el, "G50Index", 0),
      isStatus: parseBoolText(textOf(el, "IsStatus"), false),
      signalIndex: parseIntText(el, "SignalIndex", 0),
      signalSpecIndex: parseIntText(el, "SignalSpecIndex", 0),
      isVirtual: parseBoolAttr(virtEl, "Status", false),
      filterIds: parseConversionIds(textOf(el, "IdxFilters")),
      operationIds: parseConversionIds(textOf(el, "IdxOperations")),
    };
  });
}
