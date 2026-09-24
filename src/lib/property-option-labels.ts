import { BYTE_ORDER_LABELS } from "@/protocols/modbus/master/types";

/**
 * Display labels of the choice properties, shared by the screens' selects and
 * the save bar's conflict panel (so a pending value reads as the user saw it).
 * `property-option-labels.test.tsx` checks the rendered selects against them.
 */

export interface OptionLabel {
  value: number;
  label: string;
}

export const MEDIA_OPTIONS: readonly OptionLabel[] = [
  { value: 0, label: "RTU" },
  { value: 1, label: "TCP" },
  { value: 2, label: "RTU + TCP" },
];

/** V11 select labels for the controller model. */
export const ME_MODEL_OPTIONS: readonly OptionLabel[] = [
  { value: 0, label: "AG-150A or older" },
  { value: 1, label: "EB-50GU" },
  { value: 2, label: "AE-200, EW-50" },
  { value: 3, label: "AE-C400E, EW-C50" },
];

/** Desktop `GetControllerTypeString` (frmDiscoverMe.cs). */
export const CONTROLLER_TYPE_LABELS: Readonly<Record<number, string>> = {
  0: "Controller Direct Connection",
  1: "Expansion Controller 1",
  2: "Expansion Controller 2",
  3: "Expansion Controller 3",
};

export const GROUP_TYPE_OPTIONS: readonly OptionLabel[] = [
  { value: 0, label: "IC: Air Conditioning Unit" },
  { value: 1, label: "LC: Lossnay" },
  { value: 2, label: "FU: Outdoor-Air Processing Unit" },
  { value: 3, label: "BU: Air to Water Booster Unit" },
  { value: 4, label: "WH: Air to Water HEX Unit" },
  { value: 5, label: "CEh: Heat Pump" },
  { value: 6, label: "System Component" },
];

const fromOptions = (options: readonly OptionLabel[]) =>
  Object.fromEntries(options.map((o) => [String(o.value), o.label]));

/** Keyed by the select's option value (booleans are rendered as 0/1). */
export type OptionLabels = Readonly<Record<string, string>>;

export const OPTION_LABELS = {
  media: fromOptions(MEDIA_OPTIONS),
  parity: { "0": "None", "1": "Odd", "2": "Even" },
  physicalPort: { "0": "Port A", "1": "Port B" },
  registerBase: { "0": "0-based", "1": "1-based" },
  addressMode: { "0": "Fixed", "1": "Custom" },
  byteOrder: Object.fromEntries(Object.entries(BYTE_ORDER_LABELS).map(([k, v]) => [k, v])),
  slaveAddressMode: { "0": "Single Slave", "1": "Multiple Slaves" },
  temperatureMode: { "0": "Celsius", "1": "Fahrenheit" },
  controllerType: Object.fromEntries(Object.entries(CONTROLLER_TYPE_LABELS)),
  controllerModel: fromOptions(ME_MODEL_OPTIONS),
  compatibility: { "0": "New model", "1": "Old model" },
  groupType: fromOptions(GROUP_TYPE_OPTIONS),
  dualSetPoint: { "0": "Single Setpoint", "1": "Multiple Setpoint" },
  urc: { "0": "Not available", "1": "Available" },
} satisfies Record<string, OptionLabels>;
