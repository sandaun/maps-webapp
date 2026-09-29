import type { KnxMbmSignal } from "@/gateway-families/knx-mbm/model";
import { formatGroupAddress } from "@/protocols/knx/address";
import { formatDpt } from "@/protocols/knx/dpt";
import { FORMAT_LABELS, type MbmConfig } from "@/protocols/modbus/master";
import { knxDeviceLabel, knxSlaveLabel } from "./columns-knx-mbm";
import { flagsText, KNX_MBM_CONVERSION_DIRECTION, type ConversionSides } from "./conversion-sides";

/** The conversions editor of a KNX ↔ Modbus Master signal (the Modbus end names the device and slave). */
export function knxMbmConversionSides(mbm: MbmConfig): ConversionSides<KnxMbmSignal> {
  return {
    ...KNX_MBM_CONVERSION_DIRECTION,
    endWidth: { internal: 104, external: 152 },
    meta: (signal) =>
      [
        `KNX ${signal.knx.groupAddress > 0 ? formatGroupAddress(signal.knx.groupAddress) : "—"} · ${formatDpt(signal.knx.dpt)} · flags ${flagsText(signal.knx.flags) || "none"}`,
        `Modbus ${knxDeviceLabel(mbm, signal)} · slave ${knxSlaveLabel(mbm, signal)} · register ${signal.modbus.address} · ${FORMAT_LABELS[signal.modbus.format] ?? "?"} ${signal.modbus.lenBits} bit`,
      ].join("   ·   "),
    directionNote: (signal, rwMode) => {
      const flags = flagsText(signal.knx.flags);
      if (rwMode === "readwrite")
        return `Read + write — the flags (${flags}) move values both ways. The other direction runs the operations inverted, in reverse order.`;
      return rwMode === "read"
        ? `Read only — the KNX flags (${flags}) only send status to KNX, so values only travel from Modbus to KNX.`
        : `Write only — without the R or T flag (${flags || "none"}) KNX only writes, so values only travel from KNX to Modbus.`;
    },
    end: (signal, side) => {
      if (side === "internal") {
        if (!signal) return { main: "Group address", sub: "per signal" };
        return {
          main: signal.knx.groupAddress > 0 ? formatGroupAddress(signal.knx.groupAddress) : "—",
          sub: formatDpt(signal.knx.dpt),
        };
      }
      if (!signal) return { main: "Register", sub: "per signal" };
      return {
        main: `Slave ${knxSlaveLabel(mbm, signal)} · ${signal.modbus.address}`,
        sub: `${FORMAT_LABELS[signal.modbus.format] ?? "?"} · ${signal.modbus.lenBits} bit`,
      };
    },
    receives: { internal: "KNX receives", external: "The Modbus register receives" },
    testPlaceholder: { internal: "e.g. 21.5", external: "e.g. 215" },
    virtualReason: "Virtual signal · it has no Modbus side, so it cannot have conversions.",
  };
}
