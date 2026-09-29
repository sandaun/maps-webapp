import type { ConversionRwMode, SignalConversionRefs } from "@/core/signals/conversion-refs";
import { knxConversionRwMode } from "@/gateway-families/knx-mbm/conversions";
import type { KnxMbmSignal } from "@/gateway-families/knx-mbm/model";
import type { MbsKnxSignal } from "@/gateway-families/mbs-knx/model";
import { formatGroupAddress } from "@/protocols/knx/address";
import { formatDpt } from "@/protocols/knx/dpt";
import type { KnxFlags } from "@/protocols/knx/flags";
import { FORMAT_LABELS } from "@/protocols/modbus/master";
import { mbsConversionRwMode, READ_WRITE } from "@/protocols/modbus/slave";

/**
 * What the conversions editor and the Conversions cell need to know about a
 * family: the two halves of `frmSelectConversion` (internal = the side the
 * refs call "internal", drawn on the left as in the signal table), the
 * direction of a signal, and how to describe its two ends. The "write" flow
 * always runs internal → external.
 */
export interface ConversionSignal {
  id: number;
  description: string;
  virtual: boolean;
  conversions: SignalConversionRefs;
}

export interface ConversionEnd {
  main: string;
  sub: string;
}

/** What the Conversions cell needs: the side names, the direction and the virtual notes. */
export interface ConversionDirection<S extends ConversionSignal> {
  /** Side names, as the editor labels them ("KNX", "Modbus"). */
  internal: string;
  external: string;
  /** The direction `frmSelectConversion` takes from the signal's internal object. */
  rwMode: (signal: S) => ConversionRwMode;
  /** Conversions cell of a virtual signal (tooltip), with and without stored refs. */
  virtualNote: { ignored: string; unavailable: string };
}

export interface ConversionSides<S extends ConversionSignal> extends ConversionDirection<S> {
  /** Width of each end node of a lane, px. */
  endWidth: { internal: number; external: number };
  /** Header line of the editor for one signal. */
  meta: (signal: S) => string;
  /** Why the signal has the flows it has (one way, or both). */
  directionNote: (signal: S, rwMode: ConversionRwMode) => string;
  /** An end node of a lane; `signal` undefined in bulk. */
  end: (signal: S | undefined, side: "internal" | "external") => ConversionEnd;
  /** Result line of the test when the value reaches that side. */
  receives: { internal: string; external: string };
  /** Example of the test input when the value starts on that side. */
  testPlaceholder: { internal: string; external: string };
  /** Bulk: why a virtual signal is skipped. */
  virtualReason: string;
}

export function flagsText(flags: KnxFlags): string {
  return (["u", "t", "ri", "w", "r"] as const)
    .filter((k) => flags[k])
    .map((k) => (k === "ri" ? "Ri" : k.toUpperCase()))
    .join(" ");
}

/** KNX ↔ Modbus Master: KNX is the internal half; the KNX flags set the direction. */
export const KNX_MBM_CONVERSION_DIRECTION: ConversionDirection<KnxMbmSignal> = {
  internal: "KNX",
  external: "Modbus",
  rwMode: (signal) => knxConversionRwMode(signal.knx.flags),
  virtualNote: {
    ignored: "Virtual signals have no Modbus side: the gateway ignores these conversions.",
    unavailable: "Virtual signals have no Modbus side, so they cannot have conversions.",
  },
};

const MBS_READ_WRITE_LABELS: Record<number, string> = {
  [READ_WRITE.READ]: "Read",
  [READ_WRITE.TRIGGER]: "Trigger",
  [READ_WRITE.READWRITE]: "Read / Write",
};

/**
 * KNX ↔ Modbus Slave: the Modbus object is the internal half
 * (IntesisProjectMBSKNX_RT.cs:445-449) and its read/write mode sets the
 * direction (`ConversionObject(MbsObject)`): a register the BMS reads gets
 * values from KNX, a trigger sends them to KNX.
 */
export const MBS_KNX_CONVERSION_SIDES: ConversionSides<MbsKnxSignal> = {
  internal: "Modbus",
  external: "KNX",
  endWidth: { internal: 152, external: 104 },
  rwMode: (signal) => mbsConversionRwMode(signal.modbus.readWrite),
  meta: (signal) =>
    [
      `Modbus register ${signal.modbus.address} · ${FORMAT_LABELS[signal.modbus.format] ?? "?"} ${signal.modbus.lenBits} bit · ${MBS_READ_WRITE_LABELS[signal.modbus.readWrite] ?? "?"}`,
      `KNX ${signal.knx.groupAddress > 0 ? formatGroupAddress(signal.knx.groupAddress) : "—"} · ${formatDpt(signal.knx.dpt)} · flags ${flagsText(signal.knx.flags) || "none"}`,
    ].join("   ·   "),
  directionNote: (_signal, rwMode) =>
    rwMode === "read"
      ? "Read — the BMS only reads this register, so values only travel from KNX to Modbus."
      : rwMode === "write"
        ? "Trigger — the BMS only writes this register, so values only travel from Modbus to KNX."
        : "Read / write — the BMS reads and writes this register, so values move both ways. The other direction runs the operations inverted, in reverse order.",
  end: (signal, side) => {
    if (side === "internal") {
      if (!signal) return { main: "Register", sub: "per signal" };
      return {
        main: `Register ${signal.modbus.address}`,
        sub: `${FORMAT_LABELS[signal.modbus.format] ?? "?"} · ${signal.modbus.lenBits} bit`,
      };
    }
    if (!signal) return { main: "Group address", sub: "per signal" };
    return {
      main: signal.knx.groupAddress > 0 ? formatGroupAddress(signal.knx.groupAddress) : "—",
      sub: formatDpt(signal.knx.dpt),
    };
  },
  receives: { internal: "The Modbus register receives", external: "KNX receives" },
  testPlaceholder: { internal: "e.g. 215", external: "e.g. 21.5" },
  virtualReason: "Virtual signal · it cannot have conversions.",
  virtualNote: {
    ignored: "Virtual signals: the gateway ignores these conversions.",
    unavailable: "Virtual signals cannot have conversions.",
  },
};
