import { formatGroupAddress } from "@/protocols/knx/address";
import type { ProjectView } from "./project-types";
import { knxConsoleId, mbmConsoleId, parseReadValue, type MonitorFrame } from "./diagnostics-parsing";

export type SignalSide = "knx" | "mb";

export interface DiagnosticSignal {
  id: number;
  active: boolean;
  description: string;
  mapping: string;
  /** Complete protocol head + runtime id, absent for disabled signals. */
  endpoints: Partial<Record<SignalSide, string>>;
  /** MAPS GetWriteEnabled, checked separately for internal/external protocols. */
  writable: Record<SignalSide, boolean>;
}

/**
 * Console ids follow the compiled arrays, not table row ids. MBS–KNX:
 * PreXBLActions sorts enabled MBS objects by (Address, Bit), while enabled
 * KNX objects stay in project order (IntesisProjectMBSKNX_RT.cs:158–197).
 * InternalMbs.CreateInternalAskValueLine uses hex8; ExternalKnx uses the
 * enabled KNX index + 1 (hex4) and sending GA (hex4).
 */
export function diagnosticSignals(view: ProjectView | null): DiagnosticSignal[] | null {
  if (!view || (view.family !== "knx-mbm" && view.family !== "mbs-knx")) return null;
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
  const targets = new Map<string, string>();
  for (const signal of signals ?? []) {
    for (const side of ["knx", "mb"] as const) {
      const endpoint = signal.endpoints[side];
      if (endpoint) targets.set(endpoint.toUpperCase(), `${signal.id}|${side}`);
    }
  }
  const values = new Map<string, string>();
  for (const frame of frames) {
    const equals = frame.dec.indexOf("=");
    const target = targets.get(frame.dec.slice(0, equals).toUpperCase());
    if (!target) continue;
    const value = parseReadValue(frame.dec);
    if (value !== null) values.set(target, value);
    else values.delete(target);
  }
  return values;
}
