import type { KnxMbmProject } from "@/gateway-families/knx-mbm/model";
import type { MbsKnxProject } from "@/gateway-families/mbs-knx/model";
import { encodeDpt } from "@/protocols/knx";
import { MEDIA } from "@/protocols/modbus/master";
import { MAX_ACTIVE_SIGNALS, MAX_BULK_ADD_ROWS, MAX_TOTAL_SIGNAL_ROWS } from "./model";

export type AddSignalsProject = KnxMbmProject | MbsKnxProject;
export interface AddSignalsOptions {
  count: number;
  afterId?: number;
  device?: { port: number; deviceIndex: number };
  /** MAPS switch defaults, or a complete unsigned register mapping. */
  profile?: "maps" | "unsigned16" | "unsigned32";
  active?: boolean;
  groupAddress?: number;
  address?: number;
}
export type AddSignalsPatch = { type: "addSignals"; options: AddSignalsOptions };

export function signalDeviceOptions(project: AddSignalsProject) {
  if (!("mbm" in project)) return [];
  const { mbm } = project;
  return [...mbm.rtuNodes, ...mbm.tcpNodes].flatMap((node, port) => {
    const rtu = port < mbm.rtuNodes.length;
    if ((rtu && mbm.media === MEDIA.TCP) || (!rtu && mbm.media === MEDIA.RTU)) return [];
    return node.devices.flatMap((device, deviceIndex) => device.enabled ? [{
      port, deviceIndex, base: device.baseRegister,
      label: `${rtu ? `RTU ${port + 1}` : `TCP ${port - mbm.rtuNodes.length + 1}`} · ${device.name} (slave ${device.slave})`,
    }] : []);
  });
}

/** Pure plan shared by the preview and the server. Never trusts client-supplied defaults. */
export function planAddSignals(project: AddSignalsProject, options: AddSignalsOptions) {
  const master = "mbm" in project;
  const { count } = options;
  if (!Number.isInteger(count) || count < 1 || count > MAX_BULK_ADD_ROWS) {
    throw new Error(`Add between 1 and ${MAX_BULK_ADD_ROWS} signals at a time.`);
  }
  if (project.signals.length + count > MAX_TOTAL_SIGNAL_ROWS) throw new Error(`The table allows ${MAX_TOTAL_SIGNAL_ROWS} signals.`);
  const active = options.active ?? master;
  if (active && project.signals.filter((s) => s.active).length + count > MAX_ACTIVE_SIGNALS) {
    throw new Error(`Only ${MAX_ACTIVE_SIGNALS} signals can be active. Add these signals disabled.`);
  }
  const afterIndex = options.afterId === undefined ? project.signals.length - 1 : project.signals.findIndex((s) => s.id === options.afterId);
  if (options.afterId !== undefined && afterIndex < 0) throw new Error("The insertion signal no longer exists.");
  const devices = signalDeviceOptions(project);
  const device = options.device ? devices.find((d) => d.port === options.device!.port && d.deviceIndex === options.device!.deviceIndex) : devices.length === 1 ? devices[0] : undefined;
  if (master && !device) throw new Error(devices.length ? "Choose a Modbus device." : "Add and enable a Modbus device before adding signals.");
  if (!master && options.device) throw new Error("Modbus Slave signals do not have a device selection.");
  const profile = options.profile ?? (master ? "maps" : "unsigned16");
  if (!["maps", "unsigned16", "unsigned32"].includes(profile)) throw new Error("Invalid signal type.");
  const lenBits = profile === "unsigned32" ? 32 : 16;
  const span = lenBits / 16;
  const usedGa = new Set(project.signals.flatMap((s) => [s.knx.groupAddress, ...s.knx.additionalAddresses]));
  const maxGa = project.knx.extendedAddresses ? 65535 : 32767;
  let ga = options.groupAddress ?? Math.max(0, ...usedGa) + 1;
  const ranges = project.signals.filter((s) => {
    if (master) {
      const m = s.modbus as KnxMbmProject["signals"][number]["modbus"];
      return !(s as KnxMbmProject["signals"][number]).modbusVirtual && !s.virtual && m.port === device!.port && m.deviceIndex === device!.deviceIndex &&
        (m.readFunc === 3 || m.writeFunc === 6 || m.writeFunc === 16);
    }
    return true;
  }).map((s) => {
    const m = s.modbus;
    const size = "stringLength" in m && m.format === 5 ? Math.max(1, Math.ceil(m.stringLength / 2)) : Math.max(1, Math.ceil(m.lenBits / 16));
    return { start: m.address, end: m.address + size - 1 };
  });
  const base = master ? device!.base : (project as MbsKnxProject).mbs.registerBase;
  const maxAddress = master ? 65535 : 20000;
  let address = options.address ?? Math.max(base, ...ranges.map((r) => r.end + 1));
  const names = new Set(project.signals.map((s) => s.description));
  let nameIndex = project.signals.length + 1;
  const entries = Array.from({ length: count }, () => {
    if (options.groupAddress === undefined) while (usedGa.has(ga)) ga++;
    if (!Number.isInteger(ga) || ga < 1 || ga > maxGa || usedGa.has(ga)) throw new Error("The KNX address range is unavailable or already used.");
    if (!Number.isInteger(address) || address < base || address + span - 1 > maxAddress || ranges.some((r) => address <= r.end && address + span - 1 >= r.start)) {
      throw new Error("The Modbus register range is unavailable or already used.");
    }
    while (names.has(`Signal ${nameIndex}`)) nameIndex++;
    const description = `Signal ${nameIndex++}`;
    names.add(description);
    const entry = { description, active, groupAddress: ga, address, lenBits,
      dpt: master && profile === "maps" ? encodeDpt(1, 1) : lenBits === 32 ? encodeDpt(12, 255) : encodeDpt(7, 255),
      bit: master && profile === "maps" ? 0 : -1,
      numOfBits: master && profile === "maps" ? 1 : -1,
      writeFunc: lenBits === 32 ? 16 : 6,
    };
    usedGa.add(ga++);
    ranges.push({ start: address, end: address + span - 1 });
    address += span;
    return entry;
  });
  return { entries, device, insertIndex: afterIndex + 1 };
}
