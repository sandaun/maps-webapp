/**
 * KNX DPT (datapoint type) handling.
 *
 * In the .ibmaps, a DPT is stored as `<DPT Value="…"/>` where Value is a
 * ushort: `main * 256 + sub`. The `x` wildcard subtype is stored as 255
 * (e.g. "1.x" → 0x01FF = 511). See IntesisKnx.ConvertStringToDPTValue.
 *
 * KNX–MBM offers the COMMON selection only: families 1–9, 12, 13, 14, 20
 * (families 10/11/23/232/29 are gated out in the desktop tool).
 */

export const DPT_WILDCARD_SUBTYPE = 255;

/** Family → allowed subtypes. Empty array = wildcard only. */
export const COMMON_DPT_SUBTYPES: Readonly<Record<number, readonly number[]>> = {
  1: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 18, 19, 21, 22, 100],
  2: [],
  3: [],
  4: [1, 2],
  5: [1, 3, 4, 6, 10],
  6: [1, 10],
  7: [1, 2, 5, 6, 7, 11, 12, 13],
  8: [1, 2, 5, 6, 7, 10, 11],
  9: [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 20, 21, 22, 23, 24, 25, 26, 27, 28],
  12: [1],
  13: [1, 2, 10, 11, 12, 13, 14, 15, 100],
  14: [0, ...Array.from({ length: 79 }, (_, i) => i + 1)],
  20: [102, 105],
};

export function encodeDpt(main: number, sub: number): number {
  return main * 256 + sub;
}

export function decodeDpt(value: number): { main: number; sub: number } {
  return { main: Math.floor(value / 256), sub: value % 256 };
}

/** "9.001" / "1.x" → encoded value. Returns undefined if unparseable. */
export function parseDpt(value: string): number | undefined {
  const match = /^(\d+)\.(x|\d+)$/i.exec(value.trim());
  if (!match) return undefined;
  const main = Number(match[1]);
  const sub = match[2].toLowerCase() === "x" ? DPT_WILDCARD_SUBTYPE : Number(match[2]);
  return encodeDpt(main, sub);
}

/** Encoded value → "9.001" / "1.x" (subtype padded to 3 digits). */
export function formatDpt(value: number): string {
  const { main, sub } = decodeDpt(value);
  return `${main}.${sub === DPT_WILDCARD_SUBTYPE ? "x" : String(sub).padStart(3, "0")}`;
}

/**
 * Mirrors IntesisKnx.IsValidDPT (lenient) restricted to the COMMON family
 * selection offered by KNX–MBM: main must be offered; `x` (255) always ok;
 * sub 0 only allowed for family 14; families with an explicit subtype list
 * require membership.
 */
export function isValidDpt(value: number): boolean {
  const { main, sub } = decodeDpt(value);
  const subtypes = COMMON_DPT_SUBTYPES[main];
  if (!subtypes) return false;
  if (sub === DPT_WILDCARD_SUBTYPE) return true;
  if (sub === 0) return main === 14;
  if (subtypes.length === 0) return false;
  return subtypes.includes(sub);
}

/** Default DPT for a new signal in the desktop tool: "1.001: switch". */
export const DEFAULT_DPT = encodeDpt(1, 1);

export interface DptOption {
  /** Encoded value (`main * 256 + sub`). */
  value: number;
  /** Desktop-style label: "9.001: temperature (ºC)". */
  label: string;
}

/**
 * Full dropdown list offered by the desktop tool for KNX–MBM
 * (IntesisKnx.AddAllDPTItemsToCombo): wildcard entry per COMMON family plus
 * every allowed subtype. Labels verbatim from DPTList.cs — including the
 * desktop's own typos ("ocuppancy", "volumne flow").
 */
export const COMMON_DPT_OPTIONS: readonly DptOption[] = [
  { value: encodeDpt(1, 255), label: "1.x: (1-bit)" },
  { value: encodeDpt(1, 1), label: "1.001: switch" },
  { value: encodeDpt(1, 2), label: "1.002: boolean" },
  { value: encodeDpt(1, 3), label: "1.003: enable" },
  { value: encodeDpt(1, 4), label: "1.004: ramp" },
  { value: encodeDpt(1, 5), label: "1.005: alarm" },
  { value: encodeDpt(1, 6), label: "1.006: binary value" },
  { value: encodeDpt(1, 7), label: "1.007: step" },
  { value: encodeDpt(1, 8), label: "1.008: up/down" },
  { value: encodeDpt(1, 9), label: "1.009: open/close" },
  { value: encodeDpt(1, 10), label: "1.010: start/stop" },
  { value: encodeDpt(1, 11), label: "1.011: state" },
  { value: encodeDpt(1, 12), label: "1.012: invert" },
  { value: encodeDpt(1, 13), label: "1.013: dim send style" },
  { value: encodeDpt(1, 14), label: "1.014: input source" },
  { value: encodeDpt(1, 15), label: "1.015: reset" },
  { value: encodeDpt(1, 18), label: "1.018: ocuppancy" },
  { value: encodeDpt(1, 19), label: "1.019: window/door" },
  { value: encodeDpt(1, 21), label: "1.021: logical function" },
  { value: encodeDpt(1, 22), label: "1.022: scene" },
  { value: encodeDpt(1, 100), label: "1.100: cooling/heating" },
  { value: encodeDpt(2, 255), label: "2.x: (2-bit, 1-bit controlled)" },
  { value: encodeDpt(3, 255), label: "3.x: (4-bit, 3-bit controlled)" },
  { value: encodeDpt(4, 255), label: "4.x: (8-bit, Character)" },
  { value: encodeDpt(4, 1), label: "4.001: character (ASCII)" },
  { value: encodeDpt(4, 2), label: "4.002: character (ISO 8859-1)" },
  { value: encodeDpt(5, 255), label: "5.x: (8-bit, Unsigned Value)" },
  { value: encodeDpt(5, 1), label: "5.001: percentage (0..100%)" },
  { value: encodeDpt(5, 3), label: "5.003: angle (degrees)" },
  { value: encodeDpt(5, 4), label: "5.004: percentage (0..255%)" },
  { value: encodeDpt(5, 6), label: "5.006: tariff (0..255)" },
  { value: encodeDpt(5, 10), label: "5.010: counter pulses (0..255)" },
  { value: encodeDpt(6, 255), label: "6.x: (8-bit, Signed Value)" },
  { value: encodeDpt(6, 1), label: "6.001: percentage (-128..127%)" },
  { value: encodeDpt(6, 10), label: "6.010: counter pulses (-128..127)" },
  { value: encodeDpt(7, 255), label: "7.x: (2-byte, Unsigned Value)" },
  { value: encodeDpt(7, 1), label: "7.001: pulses" },
  { value: encodeDpt(7, 2), label: "7.002: time (10 ms)" },
  { value: encodeDpt(7, 5), label: "7.005: time (s)" },
  { value: encodeDpt(7, 6), label: "7.006: time (min)" },
  { value: encodeDpt(7, 7), label: "7.007: time (h)" },
  { value: encodeDpt(7, 11), label: "7.011: length (mm)" },
  { value: encodeDpt(7, 12), label: "7.012: current (mA)" },
  { value: encodeDpt(7, 13), label: "7.013: brightness (lux)" },
  { value: encodeDpt(8, 255), label: "8.x: (2-byte, Signed Value)" },
  { value: encodeDpt(8, 1), label: "8.001: pulses difference" },
  { value: encodeDpt(8, 2), label: "8.002: time lag (ms)" },
  { value: encodeDpt(8, 5), label: "8.005: time lag (s)" },
  { value: encodeDpt(8, 6), label: "8.006: time lag (min)" },
  { value: encodeDpt(8, 7), label: "8.007: time lag (h)" },
  { value: encodeDpt(8, 10), label: "8.010: percentage difference (%)" },
  { value: encodeDpt(8, 11), label: "8.011: rotation angle (º)" },
  { value: encodeDpt(9, 255), label: "9.x: (2-byte, Float Value)" },
  { value: encodeDpt(9, 1), label: "9.001: temperature (ºC)" },
  { value: encodeDpt(9, 2), label: "9.002: temperature difference (ºK)" },
  { value: encodeDpt(9, 3), label: "9.003: kelvin/hour (ºK/h)" },
  { value: encodeDpt(9, 4), label: "9.004: lux (Lux)" },
  { value: encodeDpt(9, 5), label: "9.005: speed (m/s)" },
  { value: encodeDpt(9, 6), label: "9.006: pressure (Pa)" },
  { value: encodeDpt(9, 7), label: "9.007: percentage (%)" },
  { value: encodeDpt(9, 8), label: "9.008: parts/million (ppm)" },
  { value: encodeDpt(9, 10), label: "9.010: time (s)" },
  { value: encodeDpt(9, 11), label: "9.011: time (ms)" },
  { value: encodeDpt(9, 20), label: "9.020: voltage (mV)" },
  { value: encodeDpt(9, 21), label: "9.021: current (mA)" },
  { value: encodeDpt(9, 22), label: "9.022: power density (W/m2)" },
  { value: encodeDpt(9, 23), label: "9.023: kelvin/percent (K/%)" },
  { value: encodeDpt(9, 24), label: "9.024: power (kW)" },
  { value: encodeDpt(9, 25), label: "9.025: volumne flow (l/h)" },
  { value: encodeDpt(9, 26), label: "9.026: rain amount (l/m2)" },
  { value: encodeDpt(9, 27), label: "9.027: temperature (ºF)" },
  { value: encodeDpt(9, 28), label: "9.028: wind speed (km/h)" },
  { value: encodeDpt(12, 255), label: "12.x: (4-byte, Unsigned Value)" },
  { value: encodeDpt(12, 1), label: "12.001: counter pulses (unsigned)" },
  { value: encodeDpt(13, 255), label: "13.x: (4-byte, Signed Value)" },
  { value: encodeDpt(13, 1), label: "13.001: counter pulses (signed)" },
  { value: encodeDpt(13, 2), label: "13.002: flow rate (m3/h)" },
  { value: encodeDpt(13, 10), label: "13.010: active energy (Wh)" },
  { value: encodeDpt(13, 11), label: "13.011: apparent energy (VAh)" },
  { value: encodeDpt(13, 12), label: "13.012: reactive energy (VARh)" },
  { value: encodeDpt(13, 13), label: "13.013: active energy (kWh)" },
  { value: encodeDpt(13, 14), label: "13.014: apparent energy (kVAh)" },
  { value: encodeDpt(13, 15), label: "13.015: reactive energy (kvARh)" },
  { value: encodeDpt(13, 100), label: "13.100: time lag (s)" },
  { value: encodeDpt(14, 255), label: "14.x: (4-byte, Float Value)" },
  { value: encodeDpt(14, 0), label: "14.000: acceleration (m/s2)" },
  { value: encodeDpt(14, 1), label: "14.001: angular acceleration (rad/s2)" },
  { value: encodeDpt(14, 2), label: "14.002: activation energy (J/mol)" },
  { value: encodeDpt(14, 3), label: "14.003: radioactive activity (J/mol)" },
  { value: encodeDpt(14, 4), label: "14.004: amount of substance (mol)" },
  { value: encodeDpt(14, 5), label: "14.005: amplitude" },
  { value: encodeDpt(14, 6), label: "14.006: angle (radiant)" },
  { value: encodeDpt(14, 7), label: "14.007: angle (degree)" },
  { value: encodeDpt(14, 8), label: "14.008: angular momentum (Js)" },
  { value: encodeDpt(14, 9), label: "14.009: angular velocity (rad/s)" },
  { value: encodeDpt(14, 10), label: "14.010: area (m*m)" },
  { value: encodeDpt(14, 11), label: "14.011: capacitance (F)" },
  { value: encodeDpt(14, 12), label: "14.012: flux density (C/m2)" },
  { value: encodeDpt(14, 13), label: "14.013: charge density (C/m3)" },
  { value: encodeDpt(14, 14), label: "14.014: compressibility (m2/N)" },
  { value: encodeDpt(14, 15), label: "14.015: conductance (S)" },
  { value: encodeDpt(14, 16), label: "14.016: conductivity (S/m)" },
  { value: encodeDpt(14, 17), label: "14.017: density (kg/m3)" },
  { value: encodeDpt(14, 18), label: "14.018: electric charge (C)" },
  { value: encodeDpt(14, 19), label: "14.019: electric current (A)" },
  { value: encodeDpt(14, 20), label: "14.020: electric current density (A/m2)" },
  { value: encodeDpt(14, 21), label: "14.021: electric dipole moment (Cm)" },
  { value: encodeDpt(14, 22), label: "14.022: electric displacement (C/m2)" },
  { value: encodeDpt(14, 23), label: "14.023: electric field strength (V/m)" },
  { value: encodeDpt(14, 24), label: "14.024: electric flux (C)" },
  { value: encodeDpt(14, 25), label: "14.025: electric flux density (C/m2)" },
  { value: encodeDpt(14, 26), label: "14.026: electric polarization (C/m2)" },
  { value: encodeDpt(14, 27), label: "14.027: electric potential (V)" },
  { value: encodeDpt(14, 28), label: "14.028: electric potential difference (V)" },
  { value: encodeDpt(14, 29), label: "14.029: electromagnetic moment (Am2)" },
  { value: encodeDpt(14, 30), label: "14.030: electromotive force (V)" },
  { value: encodeDpt(14, 31), label: "14.031: energy (J)" },
  { value: encodeDpt(14, 32), label: "14.032: force (N)" },
  { value: encodeDpt(14, 33), label: "14.033: frequency (Hz)" },
  { value: encodeDpt(14, 34), label: "14.034: angular frequency (rad/s)" },
  { value: encodeDpt(14, 35), label: "14.035: heat capacity (J/K)" },
  { value: encodeDpt(14, 36), label: "14.036: heat flow rate (W)" },
  { value: encodeDpt(14, 37), label: "14.037: heat quantity" },
  { value: encodeDpt(14, 38), label: "14.038: impedance" },
  { value: encodeDpt(14, 39), label: "14.039: length (m)" },
  { value: encodeDpt(14, 40), label: "14.040: light quantity (J)" },
  { value: encodeDpt(14, 41), label: "14.041: luminance (cd/m2)" },
  { value: encodeDpt(14, 42), label: "14.042: luminous flux (lm)" },
  { value: encodeDpt(14, 43), label: "14.043: luminous intesity (cd)" },
  { value: encodeDpt(14, 44), label: "14.044: magnetic field strength (A/m)" },
  { value: encodeDpt(14, 45), label: "14.045: magnetic flux (Wb)" },
  { value: encodeDpt(14, 46), label: "14.046: magnetic flux density (T)" },
  { value: encodeDpt(14, 47), label: "14.047: magnetic moment (Am2)" },
  { value: encodeDpt(14, 48), label: "14.048: magnetic polarization (T)" },
  { value: encodeDpt(14, 49), label: "14.049: magnetization (A/m)" },
  { value: encodeDpt(14, 50), label: "14.050: magnetomotive force (A)" },
  { value: encodeDpt(14, 51), label: "14.051: mass (kg)" },
  { value: encodeDpt(14, 52), label: "14.052: mass flux (kg/s)" },
  { value: encodeDpt(14, 53), label: "14.053: momentum (N/s)" },
  { value: encodeDpt(14, 54), label: "14.054: phase angle (rad)" },
  { value: encodeDpt(14, 55), label: "14.055: phase angle (º)" },
  { value: encodeDpt(14, 56), label: "14.056: power (W)" },
  { value: encodeDpt(14, 57), label: "14.057: power factor (cos)" },
  { value: encodeDpt(14, 58), label: "14.058: pressure (Pa)" },
  { value: encodeDpt(14, 59), label: "14.059: reactance (ohms)" },
  { value: encodeDpt(14, 60), label: "14.060: resistance (ohms)" },
  { value: encodeDpt(14, 61), label: "14.061: resistivity (ohms·m)" },
  { value: encodeDpt(14, 62), label: "14.062: self inductance (H)" },
  { value: encodeDpt(14, 63), label: "14.063: solid angle (H)" },
  { value: encodeDpt(14, 64), label: "14.064: sound intensity (W/m2)" },
  { value: encodeDpt(14, 65), label: "14.065: speed (m/s)" },
  { value: encodeDpt(14, 66), label: "14.066: stress (Pa)" },
  { value: encodeDpt(14, 67), label: "14.067: surface tension (N/m)" },
  { value: encodeDpt(14, 68), label: "14.068: temperature (ºC)" },
  { value: encodeDpt(14, 69), label: "14.069: temperature absolute (ºC)" },
  { value: encodeDpt(14, 70), label: "14.070: temperature difference (ºK)" },
  { value: encodeDpt(14, 71), label: "14.071: thermal capacity (J/K)" },
  { value: encodeDpt(14, 72), label: "14.072: thermal conductivity (W/mK)" },
  { value: encodeDpt(14, 73), label: "14.073: thermoelectric power (V/K)" },
  { value: encodeDpt(14, 74), label: "14.074: time (s)" },
  { value: encodeDpt(14, 75), label: "14.075: torque (Nm)" },
  { value: encodeDpt(14, 76), label: "14.076: volume (m3)" },
  { value: encodeDpt(14, 77), label: "14.077: volume flux (m3/s)" },
  { value: encodeDpt(14, 78), label: "14.078: weight (N)" },
  { value: encodeDpt(14, 79), label: "14.079: work (J)" },
  { value: encodeDpt(20, 255), label: "20.x: (1-byte)" },
  { value: encodeDpt(20, 102), label: "20.102: HVAC mode" },
  { value: encodeDpt(20, 105), label: "20.105: HVAC ContrMode" },
];
