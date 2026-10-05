import { formatGroupAddress } from "@/protocols/knx/address";
import type { ProjectView } from "./project-types";
import type { MeEndpoint } from "@/gateway-families/me-mbs/model";
import { knxConsoleId, mbmConsoleId, parseReadValue, type MonitorFrame } from "./diagnostics-parsing";

export type SignalSide = "knx" | "me" | "mb";

export interface DiagnosticSignal {
  id: number;
  active: boolean;
  description: string;
  mapping: string;
  /** Complete protocol head + runtime id, absent for disabled signals. */
  endpoints: Partial<Record<SignalSide, string>>;
  /** MAPS GetWriteEnabled, checked separately for internal/external protocols. */
  writable: Partial<Record<SignalSide, boolean>>;
}

/** IntesisMe.ConstructMEExternalID (IntesisMe.cs:142–174). */
export function meConsoleId(me: MeEndpoint): string {
  const controller = me.g50Index << 14;
  const command = (me.isStatus ? 0 : 1) << 7;
  let id: number;
  if (me.isVirtual) id = controller | command | (me.signalIndex & 0x7f);
  else if (me.groupIndex !== -1) {
    id = controller | (((me.groupIndex + 1) & 0x3f) << 8) | command | (me.signalIndex & 0x7f);
  } else {
    const unit = me.unitId >= 50 ? ((me.unitId - 50 + 1) << 8) | 32 : (me.unitId + 1) << 8;
    id = (controller | unit | command | me.signalIndex) + 64;
  }
  return id.toString(16).padStart(8, "0");
}

/**
 * Console ids follow the compiled arrays, not table row ids. MBS–KNX:
 * PreXBLActions sorts enabled MBS objects by (Address, Bit), while enabled
 * KNX objects stay in project order (IntesisProjectMBSKNX_RT.cs:158–197).
 * InternalMbs.CreateInternalAskValueLine uses hex8; ExternalKnx uses the
 * enabled KNX index + 1 (hex4) and sending GA (hex4).
 */
export function diagnosticSignals(view: ProjectView | null): DiagnosticSignal[] | null {
  if (!view) return null;
  if (view.family === "me-mbs") {
    const order = view.project.signals.filter((signal) => signal.active)
      .sort((a, b) => a.modbus.address - b.modbus.address || a.modbus.bit - b.modbus.bit);
    const indices = new Map(order.map((signal, index) => [signal.id, index]));
    return view.project.signals.map((signal) => {
      const me = signal.me;
      const group = me.groupIndex >= 0 ? `G${me.groupIndex + 1}`
        : me.unitId >= 0 ? `U${me.unitId + 1}` : "General";
      const bit = signal.modbus.format === 4 ? `.${signal.modbus.bit}` : "";
      const slave = view.project.mbs.slaveAddressMode === 1
        ? view.project.mbs.slaves[signal.modbus.slaveIndex]?.address : undefined;
      return {
        id: signal.id, active: signal.active, description: signal.description,
        mapping: `${slave !== undefined ? `s${slave}:` : ""}${signal.modbus.address}${bit} ⇄ C${me.g50Index + 1}/${group}`,
        endpoints: signal.active ? { me: `1ME:${meConsoleId(me)}`, mb: `0MS:${mbmConsoleId(indices.get(signal.id)!)}` } : {},
        writable: {
          // ExternalME.GetWriteEnabled (:839); InternalMbs.GetWriteEnabled.
          me: signal.active && me.isStatus && me.signalIndex !== -1 && !me.isVirtual,
          mb: signal.active && (signal.modbus.readWrite === 1 || signal.modbus.readWrite === 2),
        },
      };
    });
  }
  const active = view.project.signals.filter((signal) => signal.active);
  const knxIndex = new Map(active.map((signal, index) => [signal.id, index]));
  const modbusOrder = view.family === "mbs-knx"
    ? [...view.project.signals].filter((signal) => signal.active)
      .sort((a, b) => a.modbus.address - b.modbus.address || a.modbus.bit - b.modbus.bit)
    : active;
  const modbusIndex = new Map(modbusOrder.map((signal, index) => [signal.id, index]));

  return view.project.signals.map((signal) => {
    const ga = signal.knx.groupAddress > 0 ? formatGroupAddress(signal.knx.groupAddress) : "—";
    let mapping: string;
    if ("deviceIndex" in signal.modbus) {
      const device = signal.modbus.isBroadcast ? "BC"
        : signal.modbus.deviceIndex >= 0 ? String(signal.modbus.deviceIndex) : "—";
      mapping = `${ga} ⇄ s${device}:${signal.modbus.address}`;
    } else {
      const bit = signal.modbus.format === 4 ? `.${signal.modbus.bit}` : "";
      mapping = `${signal.modbus.address}${bit} ⇄ ${ga}`;
    }
    const endpoints: DiagnosticSignal["endpoints"] = {};
    if (signal.active) {
      const mbs = view.family === "mbs-knx";
      endpoints.knx = `${mbs ? "1KX" : "0KX"}:${knxConsoleId(
        mbs ? knxIndex.get(signal.id)! + 1 : signal.id + 1,
        signal.knx.groupAddress,
      )}`;
      endpoints.mb = `${mbs ? "0MS" : "1MM"}:${mbmConsoleId(modbusIndex.get(signal.id)!)}`;
    }
    const writable = {
      // ExternalKnx.cs:980 (U or W); InternalKnx.cs:1258 (W only).
      knx: signal.active && (view.family === "mbs-knx"
        ? signal.knx.flags.u || signal.knx.flags.w : signal.knx.flags.w),
      // InternalMbs.cs:1716; ExternalMbm.cs:2350 (nonvirtual + read function).
      mb: signal.active && ("readWrite" in signal.modbus
        ? signal.modbus.readWrite === 1 || signal.modbus.readWrite === 2
        : !("modbusVirtual" in signal && signal.modbusVirtual) && signal.modbus.readFunc !== -1),
    };
    return { id: signal.id, active: signal.active, description: signal.description, mapping, endpoints, writable };
  });
}

export function signalCommand(signal: DiagnosticSignal, side: SignalSide, value?: string): string | null {
  const endpoint = signal.endpoints[side];
  if (!endpoint || (value !== undefined && !signal.writable[side])) return null;
  return value === undefined ? `${endpoint}?` : `${endpoint}=${value}${side === "mb" ? ";" : ""}`;
}

/** Match both the protocol/port and id so reversed sides and repeated GAs cannot collide. */
export function diagnosticStreamValues(signals: DiagnosticSignal[] | null, frames: MonitorFrame[]) {
  return createDiagnosticValueResolver(signals).consume(frames);
}

/** Latest values persist when their source frame leaves the traffic window. */
export function createDiagnosticValueResolver(signals: DiagnosticSignal[] | null) {
  const targets = new Map<string, string[]>();
  for (const signal of signals ?? []) {
    for (const side of ["knx", "me", "mb"] as const) {
      const endpoint = signal.endpoints[side];
      if (endpoint) {
        const key = endpoint.toUpperCase();
        targets.set(key, [...(targets.get(key) ?? []), `${signal.id}|${side}`]);
      }
    }
  }
  const values = new Map<string, string>();
  let lastSequence = -1;
  return {
    consume(frames: MonitorFrame[]) {
      const start = frames.findLastIndex((frame) => frame.i <= lastSequence) + 1;
      for (let i = start; i < frames.length; i++) {
        const frame = frames[i];
        if (frame.i <= lastSequence) continue;
        lastSequence = frame.i;
        const equals = frame.dec.indexOf("=");
        const target = targets.get(frame.dec.slice(0, equals).toUpperCase());
        if (!target) continue;
        const value = parseReadValue(frame.dec);
        for (const key of target) {
          if (value !== null) values.set(key, value);
          else values.delete(key);
        }
      }
      return new Map(values);
    },
  };
}
