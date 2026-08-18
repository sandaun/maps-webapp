import {
  getAttr,
  getText,
  XmlDocument,
  type XmlElement,
} from "@/core/project-format";
import {
  defaultMeController,
  type MeConfig,
  type MeControllerInfo,
  type MeGroupInfo,
} from "@/protocols/me";
import {
  defaultMbsConfig,
  type MbsConfig,
  type MbsSlave,
} from "@/protocols/modbus/slave";
import type {
  Conversion,
  GatewayInfo,
  MeMbsProject,
  MeMbsSignal,
} from "./model";
import { isMeMbsProject } from "./detect";

/** Parse an .ibmaps document into the ME–MBS project model. */
export function projectFromXml(doc: XmlDocument): MeMbsProject {
  if (!isMeMbsProject(doc)) {
    throw new Error("Not a Mitsubishi Electric AC ↔ Modbus Slave project");
  }
  return {
    name: doc.getAttr([], "ProjectName") ?? "",
    description: doc.getAttr([], "ProjectDescription") ?? "",
    gateway: readGateway(doc),
    me: readMeConfig(doc),
    mbs: readMbsConfig(doc),
    signals: readSignals(doc),
    conversions: readConversions(doc),
  };
}

function readGateway(doc: XmlDocument): GatewayInfo {
  // Pwd is intentionally NOT read into the model.
  return {
    name: doc.getAttr(["IBOX"], "Name") ?? "",
    ip: doc.getAttr(["IBOX"], "IP") ?? "",
    netmask: doc.getAttr(["IBOX"], "NetMask") ?? "",
    gateway: doc.getAttr(["IBOX"], "Gateway") ?? "",
    dhcp: parseBool(doc.getAttr(["IBOX"], "DHCP"), false),
  };
}

// --- internal side (Modbus Slave) -------------------------------------------

function readMbsConfig(doc: XmlDocument): MbsConfig {
  const internal = doc.find(["InternalProtocol"]);
  if (!internal) return defaultMbsConfig();

  const config = defaultMbsConfig();
  config.media = parseNumber(textOf(internal, "Media"), 2) as MbsConfig["media"];
  config.byteOrder = parseNumber(textOf(internal, "ByteOrder"), 0);
  config.updateCOV = parseBool(textOf(internal, "UpdateCOV"), true);
  config.addressMode = parseNumber(textOf(internal, "AddressMode"), 0) as MbsConfig["addressMode"];
  config.tempSetpoint = parseNumber(textOf(internal, "TempSetpoint"), 0) as MbsConfig["tempSetpoint"];
  config.formatExtra = parseNumber(textOf(internal, "FormatExtra"), 0);
  config.commErrorTout = parseNumber(textOf(internal, "CommErrorTout"), 180);
  config.registerBase = parseNumber(textOf(internal, "RegisterBase"), 0) as 0 | 1;
  config.slaveAddressMode = parseNumber(textOf(internal, "SlaveAddressMode"), 0) as MbsConfig["slaveAddressMode"];

  const rtu = childElOpt(internal, "RTUConfig");
  if (rtu) {
    config.rtu = {
      connectionType: parseNumber(getAttr(rtu, "ConnectionType"), 1),
      baudrate: parseNumber(getAttr(rtu, "Baudrate"), 9600),
      dataBits: parseNumber(getAttr(rtu, "DataBits"), 8),
      parity: parseNumber(getAttr(rtu, "Parity"), 0) as 0 | 1 | 2,
      stopBits: parseNumber(getAttr(rtu, "StopBits"), 1) as 1 | 2,
      slaveNumber: parseNumber(getAttr(rtu, "SlaveNumber"), 1),
    };
  }
  const tcp = childElOpt(internal, "TCPConfig");
  if (tcp) {
    config.tcp = {
      port: parseNumber(getAttr(tcp, "Port"), 502),
      keepAlive: parseNumber(getAttr(tcp, "KeepAlive"), 10),
    };
  }
  const sensor = childElOpt(internal, "TemperatureSensor");
  config.temperatureSensorEnabled = sensor ? parseBool(getAttr(sensor, "Enabled"), false) : false;

  config.slaves = childrenOf(internal, "MBSlavesArray")
    .flatMap((c) => childrenOf(c, "MBSlave"))
    .map(readSlave);
  return config;
}

function readSlave(el: XmlElement): MbsSlave {
  return {
    address: parseNumber(getAttr(el, "Address"), 0),
    description: getAttr(el, "Description") ?? "",
  };
}

// --- external side (Mitsubishi Electric) -------------------------------------

function readMeConfig(doc: XmlDocument): MeConfig {
  const external = doc.find(["ExternalProtocol"]);
  const config: MeConfig = {
    pollPeriod: 100,
    ansTimeout: 30,
    controllerTout: 30,
    readCyclesPerAlarm: 1,
    writeMaxBurst: 5,
    temperatureMode: 0,
    consumptionEnabled: false,
    controllers: [],
  };
  if (!external) return config;

  config.pollPeriod = parseNumber(textOf(external, "PollPeriod"), 100);
  config.ansTimeout = parseNumber(textOf(external, "AnsTimeout"), 30);
  config.controllerTout = parseNumber(textOf(external, "ControllerTout"), 30);
  config.readCyclesPerAlarm = parseNumber(textOf(external, "ReadCyclesPerAlarm"), 1);
  config.writeMaxBurst = parseNumber(textOf(external, "WriteMaxBurst"), 5);
  config.temperatureMode = parseNumber(textOf(external, "TemperatureMode"), 0) as MeConfig["temperatureMode"];

  const consumption = childElOpt(external, "ConsumptionFunction");
  config.consumptionEnabled = consumption ? parseBool(getAttr(consumption, "Enabled"), false) : false;

  config.controllers = childrenOf(external, "G50List")
    .flatMap((c) => childrenOf(c, "G50Controller"))
    .map(readController);
  return config;
}

function readController(el: XmlElement): MeControllerInfo {
  // AuthUserId / AuthPassword are intentionally NOT read into the model.
  const base = defaultMeController(parseNumber(textOf(el, "ID"), 0));
  base.description = textOf(el, "Description") ?? "";
  base.enabled = parseBool(textOf(el, "Enabled"), false);
  base.ip = textOf(el, "IP") ?? "";
  base.port = parseNumber(textOf(el, "Port"), 80);
  base.type = parseNumber(textOf(el, "Type"), 0);
  base.model = parseNumber(textOf(el, "Model"), 2) as MeControllerInfo["model"];
  base.compatibility = parseNumber(textOf(el, "Compatibility"), 0) as MeControllerInfo["compatibility"];
  base.setpoint05Support = parseNumber(textOf(el, "Setpoint05Support"), 1);
  base.addErrorSignals = parseBool(textOf(el, "AddErrorSignals"), false);
  base.certDownloadPort = parseNumber(textOf(el, "CertDownloadPort"), 8008);
  base.persistentConnection = parseBool(textOf(el, "PersistentConnection"), false);

  const groups = childrenOf(el, "GroupList").flatMap((c) => childrenOf(c, "Group")).map(readGroup);
  if (groups.length > 0) base.groups = groups;
  return base;
}

function readGroup(el: XmlElement): MeGroupInfo {
  return {
    index: parseNumber(getAttr(el, "Index"), 0),
    enabled: parseBool(getAttr(el, "Enabled"), false),
    description: getAttr(el, "Description") ?? "",
    controllerIndex: parseNumber(getAttr(el, "Controller"), 0),
    type: parseNumber(getAttr(el, "Type"), 0) as MeGroupInfo["type"],
    fanSpeeds: parseNumber(getAttr(el, "NumOfFanSpeeds"), 4),
    dualSetPoint: parseBool(getAttr(el, "DualSetPoint"), false),
    urc: parseBool(getAttr(el, "URC"), false),
    capacity: parseNumber(getAttr(el, "Capacity"), -1),
  };
}

// --- signals ------------------------------------------------------------------

function readSignals(doc: XmlDocument): MeMbsSignal[] {
  const internal = doc.find(["InternalProtocol"]);
  const external = doc.find(["ExternalProtocol"]);
  const mbsSignals = internal
    ? childrenOf(internal, "Signals").flatMap((c) => childrenOf(c, "Signal"))
    : [];
  const meSignals = external
    ? childrenOf(external, "Signals").flatMap((c) => childrenOf(c, "Signal"))
    : [];

  const mbsById = new Map(mbsSignals.map((el) => [attrInt(el, "ID", -1), el]));
  const meById = new Map(meSignals.map((el) => [attrInt(el, "ID", -1), el]));
  const ids = [...new Set([...mbsById.keys(), ...meById.keys()])]
    .filter((id) => id >= 0)
    .sort((a, b) => a - b);

  return ids.map((id) => {
    const m = mbsById.get(id);
    const e = meById.get(id);
    return {
      id,
      active: parseBool(m ? textOf(m, "isEnabled") : undefined, true),
      description: (m ? textOf(m, "Description") : undefined) ?? "",
      me: e ? readMeEndpoint(e) : defaultMeEndpoint(),
      modbus: m ? readMbsEndpoint(m) : defaultMbsEndpoint(),
      idxOperations:
        (m ? textOf(m, "IdxOperations") : undefined) ?? (e ? textOf(e, "IdxOperations") : "") ?? "",
      idxFilters:
        (m ? textOf(m, "IdxFilters") : undefined) ?? (e ? textOf(e, "IdxFilters") : "") ?? "",
      virtual: parseBool(m ? attrOfChild(m, "Virtual", "Status") : undefined, false),
    };
  });
}

function readMeEndpoint(el: XmlElement): MeMbsSignal["me"] {
  return {
    g50Index: parseNumber(textOf(el, "G50Index"), 0),
    groupIndex: parseNumber(textOf(el, "GroupIndex"), -1),
    unitId: parseNumber(textOf(el, "UnitId"), -1),
    isIndoor: parseBool(textOf(el, "IsIndoorSignal"), false),
    isStatus: parseBool(textOf(el, "IsStatus"), true),
    signalIndex: parseNumber(textOf(el, "SignalIndex"), -1),
    signalSpecIndex: parseNumber(textOf(el, "SignalSpecIndex"), -1),
  };
}

function readMbsEndpoint(el: XmlElement): MeMbsSignal["modbus"] {
  return {
    address: parseNumber(textOf(el, "Address"), 0),
    bit: parseNumber(textOf(el, "Bit"), 255),
    lenBits: parseNumber(textOf(el, "LenBits"), 16),
    format: parseNumber(textOf(el, "Format"), 0),
    readWrite: parseNumber(textOf(el, "ReadWrite"), 2) as MeMbsSignal["modbus"]["readWrite"],
    stringLength: parseNumber(textOf(el, "StringLength"), -1),
    slaveIndex: parseNumber(textOf(el, "SlaveIndex"), -1),
  };
}

function readConversions(doc: XmlDocument): Conversion[] {
  const container = doc.find(["IBOX", "Conversions"]);
  if (!container) return [];
  return childrenOf(container, "Conversion").map((el, i) => ({
    id: parseNumber(getAttr(el, "Id"), i),
    description: getAttr(el, "Description") ?? "",
    type: parseNumber(getAttr(el, "Type"), 0),
    params: [
      getAttr(el, "Param1") ?? "",
      getAttr(el, "Param2") ?? "",
      getAttr(el, "Param3") ?? "",
      getAttr(el, "Param4") ?? "",
    ],
  }));
}

function defaultMeEndpoint(): MeMbsSignal["me"] {
  return {
    g50Index: 0,
    groupIndex: -1,
    unitId: -1,
    isIndoor: false,
    isStatus: true,
    signalIndex: -1,
    signalSpecIndex: -1,
  };
}

function defaultMbsEndpoint(): MeMbsSignal["modbus"] {
  return { address: 0, bit: 255, lenBits: 16, format: 0, readWrite: 2, stringLength: -1, slaveIndex: -1 };
}

// --- helpers ---------------------------------------------------------------

function childrenOf(el: XmlElement, tag: string): XmlElement[] {
  return el.children.filter((c): c is XmlElement => c.kind === "element" && c.tag === tag);
}

function childElOpt(el: XmlElement, tag: string): XmlElement | undefined {
  return el.children.find((c): c is XmlElement => c.kind === "element" && c.tag === tag);
}

function textOf(el: XmlElement | undefined, tag: string): string | undefined {
  if (!el) return undefined;
  const child = childElOpt(el, tag);
  return child ? getText(child) : undefined;
}

function attrOfChild(el: XmlElement, tag: string, attr: string): string | undefined {
  const child = childElOpt(el, tag);
  return child ? getAttr(child, attr) : undefined;
}

function attrInt(el: XmlElement, name: string, fallback: number): number {
  return parseNumber(getAttr(el, name), fallback);
}

export function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() === "true";
}

export function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
