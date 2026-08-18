/**
 * Mitsubishi Electric AC enums, mirroring the desktop MAPS encodings
 * (`IntesisBoxMAPS.Protocols.ME`: MEGroupType.cs, ControllerModel.cs,
 * CompatibilityMode.cs, METemperatureMode.cs).
 */

/** `Group Type` attribute (MEGroupType). */
export const GROUP_TYPES = {
  IC: 0,
  LC: 1,
  FU: 2,
  BU: 3,
  WH: 4,
  CEH: 5,
  SYS_COMPONENT: 6,
} as const;
export type MEGroupType = (typeof GROUP_TYPES)[keyof typeof GROUP_TYPES];

export const GROUP_TYPE_LABELS: Record<number, string> = {
  0: "Indoor units (IC)",
  1: "Lossnay (LC)",
  2: "Fresh-air indoor (FU)",
  3: "Air-to-water (BU)",
  4: "Hot-water heat pump (WH)",
  5: "ECO Hot Water (CEH)",
  6: "System component",
};

/** `G50Controller Model` (ControllerModel). */
export const CONTROLLER_MODELS = { AG_150: 0, EB_50GU: 1, AE_200: 2, AE_C400E: 3 } as const;
export type ControllerModel = (typeof CONTROLLER_MODELS)[keyof typeof CONTROLLER_MODELS];

/** `G50Controller Compatibility` (CompatibilityMode). */
export const COMPATIBILITY_MODES = { NEW_MODEL: 0, OLD_MODEL: 1 } as const;
export type CompatibilityMode = (typeof COMPATIBILITY_MODES)[keyof typeof COMPATIBILITY_MODES];

/** `<TemperatureMode>` (METemperatureMode). */
export const TEMPERATURE_MODES = { CELSIUS: 0, FAHRENHEIT: 1 } as const;
export type METemperatureMode = (typeof TEMPERATURE_MODES)[keyof typeof TEMPERATURE_MODES];

/** Fixed topology limits (desktop tool). */
export const MAX_CONTROLLERS = 2;
export const GROUPS_PER_CONTROLLER = 50;
