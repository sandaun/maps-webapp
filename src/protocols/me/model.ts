import {
  COMPATIBILITY_MODES,
  CONTROLLER_MODELS,
  GROUP_TYPES,
  TEMPERATURE_MODES,
  type CompatibilityMode,
  type ControllerModel,
  type MEGroupType,
  type METemperatureMode,
} from "./types";

/**
 * Mitsubishi Electric AC side model: centralized controllers (G50/AE-200…),
 * each with 50 groups. Mirrors `MeController` / `MeGroup` /
 * `ExternalME.GetXMLProtocol`. AuthUserId/AuthPassword are deliberately NOT
 * part of this model (credentials must not reach the app layer).
 */

export interface MeGroupInfo {
  /** `Index` attribute (0–49). */
  index: number;
  enabled: boolean;
  description: string;
  /** Owning controller index (`Controller` attribute). */
  controllerIndex: number;
  type: MEGroupType;
  /** `NumOfFanSpeeds`: 2, 3 or 4. */
  fanSpeeds: number;
  dualSetPoint: boolean;
  /** URC = remote controller with humidity/brightness/occupancy sensors. */
  urc: boolean;
  /** -1 = unknown. */
  capacity: number;
}

export interface MeControllerInfo {
  /** `ID` text (0 or 1). */
  index: number;
  description: string;
  enabled: boolean;
  ip: string;
  port: number;
  type: number;
  model: ControllerModel;
  compatibility: CompatibilityMode;
  setpoint05Support: number;
  addErrorSignals: boolean;
  certDownloadPort: number;
  persistentConnection: boolean;
  groups: MeGroupInfo[];
}

/** Top-level `<ExternalProtocol ProtocolType="Mitsubishi Electric">` scalars. */
export interface MeConfig {
  pollPeriod: number;
  ansTimeout: number;
  controllerTout: number;
  readCyclesPerAlarm: number;
  writeMaxBurst: number;
  temperatureMode: METemperatureMode;
  consumptionEnabled: boolean;
  controllers: MeControllerInfo[];
}

export function defaultMeGroup(index: number, controllerIndex: number): MeGroupInfo {
  return {
    index,
    enabled: false,
    description: "",
    controllerIndex,
    type: GROUP_TYPES.IC,
    fanSpeeds: 4,
    dualSetPoint: false,
    urc: false,
    capacity: -1,
  };
}

export function defaultMeController(index: number): MeControllerInfo {
  return {
    index,
    description: "",
    enabled: false,
    ip: "",
    port: 80,
    type: 0,
    model: CONTROLLER_MODELS.AE_200,
    compatibility: COMPATIBILITY_MODES.NEW_MODEL,
    setpoint05Support: 1,
    addErrorSignals: false,
    certDownloadPort: 8008,
    persistentConnection: false,
    groups: Array.from({ length: 50 }, (_, i) => defaultMeGroup(i, index)),
  };
}

export function defaultMeConfig(): MeConfig {
  return {
    pollPeriod: 100,
    ansTimeout: 30,
    controllerTout: 30,
    readCyclesPerAlarm: 1,
    writeMaxBurst: 5,
    temperatureMode: TEMPERATURE_MODES.CELSIUS,
    consumptionEnabled: false,
    controllers: [],
  };
}
