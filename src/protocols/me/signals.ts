import { FORMATS, READ_WRITE } from "@/protocols/modbus/slave";
import { TEMPERATURE_MODES, type METemperatureMode } from "./types";

/**
 * Mitsubishi Electric signal constants (`IntesisMe.cs` SIGNAL_*) and the
 * per-spec metadata table used by the ME ↔ Modbus Slave family.
 *
 * Sources: `IntesisProjectMbsMe_RT.CreateSignalsWithParams`
 * (IntesisProjectMbsMe_RT.cs:1698-2267 — creation conditions and default
 * internal typing), `GetSignalDescription` / `GetAllowedValues`
 * (:2267-2709). Group specs present in the real 770 Air fixture are
 * byte-verified against it; specs gated by conditions the fixture does not
 * exercise (LC/BU/WH/CEH groups, dual setpoint, V4 mode, consumption) are
 * marked UNVERIFIED in their `note` field.
 */

// --- SignalIndex constants (IntesisMe.SIGNAL_*) -----------------------------

export const SIGNAL = {
  DRIVE: 0,
  MODE: 1,
  FANSPEED: 2,
  AIRDIRECTION: 3,
  SETTEMP: 4,
  INLETTEMP: 5,
  VENTILATION: 6,
  REMOCON: 7,
  FANTIME: 8,
  ERRORSIGN: 9,
  ALARMCODE: 10,
  ERRORSIGN_TRIGGER: 11,
  MODEL: 12,
  DRIVEITEM: 13,
  MODELITEM: 14,
  SETTEMPITEM: 15,
  FILTERITEM: 16,
  AIRDIRITEM: 17,
  FANSPEEDITEM: 18,
  TIMERITEM: 19,
  SETBACKCTRL: 20,
  COOLMIN: 21,
  COOLMAX: 22,
  HEATMIN: 23,
  HEATMAX: 24,
  AUTOMIN: 25,
  AUTOMAX: 26,
  SETTEMP1: 27,
  SETTEMP2: 28,
  SETTEMP3: 29,
  SETTEMP4: 30,
  SETTEMP5: 31,
  ROOMHUMIDTY: 32,
  BRIGHTNESS: 33,
  OCCUPANCY: 34,
  OUTDOORTEMP: 35,
  FILTERSIGN: 36,
  FILTERSIGN_TRIGGER: 37,
  AUTOMODESWEX: 38,
  INT_AMBTEMP: 39,
  INT_SETTEMP: 40,
  MODE_IC: 41,
  MODE_LOSSNAY: 42,
  MODE_ATW: 43,
  FANSPEED_IC: 44,
  FANSPEED_LOSSNAY: 45,
  ONOFF_COOL: 46,
  ONOFF_HEAT: 47,
  FANTIME_DIGITS: 48,
  CONS_TODAY_HEAT: 49,
  CONS_TODAY_COOL: 50,
  CONS_TODAY: 51,
  CONS_YEST_HEAT: 52,
  CONS_YEST_COOL: 53,
  CONS_YESTERDAY: 54,
  CONS_TOTAL_HEAT: 55,
  CONS_TOTAL_COOL: 56,
  CONS_TOTAL: 57,
} as const;

// --- Spec metadata ------------------------------------------------------------

export interface MeSpecInfo {
  /** SignalSpecIndex as persisted in the XML. */
  spec: number;
  /** IntesisMe.SIGNAL_* index this spec maps to. */
  signalIndex: number;
  /** Desktop-tool description (Celsius, ×10 setpoint variants). */
  description: string;
  /** Allowed-values text; may contain `{fan}`/`{temp}` placeholders. */
  allowedValues: string;
  /** Default internal (Modbus Slave) typing. */
  lenBits: 16 | 32;
  format: number;
  readWrite: number;
  /** Default internal `IdxOperations` ("" = none). */
  operations: string;
  note?: string;
}

const RW = READ_WRITE.READWRITE;
const RO = READ_WRITE.READ;
const TRIG = READ_WRITE.TRIGGER;
const UNS = FORMATS.UNSIGNED;
const S2 = FORMATS.SIGNED_C2;

/** Group-level specs (SignalSpecIndex within a group window). */
export const GROUP_SPECS: Readonly<Record<number, MeSpecInfo>> = {
  0: { spec: 0, signalIndex: SIGNAL.DRIVE, description: "On/Off", allowedValues: "[0-Off, 1-On]", lenBits: 16, format: UNS, readWrite: RW, operations: "" },
  1: { spec: 1, signalIndex: SIGNAL.MODE, description: "Operation Mode IC", allowedValues: "[0-Auto, 1-Heat, 2-Dry, 3-Fan, 4-Cool, 5-Auto Heat, 6-Auto Cool, 7-Setback, 8-Setbackheat, 9-Setbackcool]", lenBits: 16, format: UNS, readWrite: RW, operations: "" },
  2: { spec: 2, signalIndex: SIGNAL.MODE, description: "Operation Mode LOSSNAY", allowedValues: "[0-LC_Auto, 1-Heat Recovery, 2-Bypass]", lenBits: 16, format: UNS, readWrite: RW, operations: "", note: "UNVERIFIED — LC groups only" },
  3: { spec: 3, signalIndex: SIGNAL.MODE, description: "Operation Mode ATW & HWHP", allowedValues: "[0-Hot_Water, 1-Heating, 2-Heating_Eco, 3-Anti_Freeze, 4-Cooling]", lenBits: 16, format: UNS, readWrite: RW, operations: "", note: "UNVERIFIED — BU/WH/CEH groups only" },
  4: { spec: 4, signalIndex: SIGNAL.FANSPEED, description: "Fan Speed IC", allowedValues: "{fan-ic}", lenBits: 16, format: UNS, readWrite: RW, operations: "17,0", note: "operations = LUT 17/18/19 by NumOfFanSpeeds 4/3/2" },
  5: { spec: 5, signalIndex: SIGNAL.FANSPEED, description: "Fan Speed LOSSNAY", allowedValues: "{fan-lc}", lenBits: 16, format: UNS, readWrite: RW, operations: "20,0", note: "UNVERIFIED — LC groups; LUT 20/21/22 by NumOfFanSpeeds" },
  6: { spec: 6, signalIndex: SIGNAL.AIRDIRECTION, description: "Vane position", allowedValues: "[0-Auto, 1-Horizontal, 2-Position-2, 3-Position-3, 4-Position-4, 5-Vertical, 6-Swing]", lenBits: 16, format: UNS, readWrite: RW, operations: "" },
  7: { spec: 7, signalIndex: SIGNAL.SETTEMP, description: "Temperature Setpoint (x10ºC)", allowedValues: "[Cool or dry:19..30 ºC; Heat or Auto:17..28 ºC]", lenBits: 16, format: S2, readWrite: RW, operations: "0,1" },
  8: { spec: 8, signalIndex: SIGNAL.SETTEMP, description: "Temperature Setpoint (x10ºC)", allowedValues: "[5..90 ºC]", lenBits: 16, format: S2, readWrite: RW, operations: "0,1", note: "UNVERIFIED — BU/WH/CEH groups only" },
  9: { spec: 9, signalIndex: SIGNAL.INLETTEMP, description: "Ambient Temperature (x10ºC)", allowedValues: "[0,0..99,9 ºC]", lenBits: 16, format: S2, readWrite: RO, operations: "" },
  10: { spec: 10, signalIndex: SIGNAL.VENTILATION, description: "Operational Status for Lossnay or OA", allowedValues: "[0-Off, 1-Low, 2-High]", lenBits: 16, format: UNS, readWrite: RW, operations: "" },
  11: { spec: 11, signalIndex: SIGNAL.FANTIME, description: "Group operation time (x100 hours)", allowedValues: "[0..9999]", lenBits: 16, format: UNS, readWrite: RO, operations: "" },
  12: { spec: 12, signalIndex: SIGNAL.FANTIME_DIGITS, description: "Group operation time (%100 hours)", allowedValues: "[0..99]", lenBits: 16, format: UNS, readWrite: RO, operations: "" },
  13: { spec: 13, signalIndex: SIGNAL.ERRORSIGN, description: "Group error status", allowedValues: "[0-No error; 1-Group error]", lenBits: 16, format: UNS, readWrite: RO, operations: "" },
  14: { spec: 14, signalIndex: SIGNAL.ALARMCODE, description: "Group error code", allowedValues: "[Number of the error code (XXXX)]", lenBits: 16, format: S2, readWrite: RO, operations: "" },
  15: { spec: 15, signalIndex: SIGNAL.ERRORSIGN_TRIGGER, description: "Group error reset", allowedValues: "[1-Reset the error]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  16: { spec: 16, signalIndex: SIGNAL.MODEL, description: "Group model", allowedValues: "[Model of units connected to group]", lenBits: 16, format: UNS, readWrite: RO, operations: "" },
  17: { spec: 17, signalIndex: SIGNAL.DRIVEITEM, description: "Allow ON/OFF control from the local panel", allowedValues: "[0-Allow, 1-Not allow]", lenBits: 16, format: UNS, readWrite: RW, operations: "" },
  18: { spec: 18, signalIndex: SIGNAL.MODELITEM, description: "Allow operation mode control from the local panel", allowedValues: "[0-Allow, 1-Not allow]", lenBits: 16, format: UNS, readWrite: RW, operations: "" },
  19: { spec: 19, signalIndex: SIGNAL.SETTEMPITEM, description: "Allow set point control from the local panel", allowedValues: "[0-Allow, 1-Not allow]", lenBits: 16, format: UNS, readWrite: RW, operations: "" },
  20: { spec: 20, signalIndex: SIGNAL.FILTERITEM, description: "Allow filter reset control from the local panel", allowedValues: "[0-Allow, 1-Not allow]", lenBits: 16, format: UNS, readWrite: RW, operations: "" },
  21: { spec: 21, signalIndex: SIGNAL.AIRDIRITEM, description: "Allow air direction control from the local panel", allowedValues: "[0-Allow, 1-Not allow]", lenBits: 16, format: UNS, readWrite: RW, operations: "" },
  22: { spec: 22, signalIndex: SIGNAL.FANSPEEDITEM, description: "Allow fan speed control from the local panel", allowedValues: "[0-Allow, 1-Not allow]", lenBits: 16, format: UNS, readWrite: RW, operations: "" },
  23: { spec: 23, signalIndex: SIGNAL.TIMERITEM, description: "Allow timer control from the local panel", allowedValues: "[0-Allow, 1-Not allow]", lenBits: 16, format: UNS, readWrite: RW, operations: "" },
  24: { spec: 24, signalIndex: SIGNAL.SETBACKCTRL, description: "Setback control", allowedValues: "[0-Disable, 1-Enable]", lenBits: 16, format: UNS, readWrite: RW, operations: "" },
  25: { spec: 25, signalIndex: SIGNAL.COOLMIN, description: "Minimum cool setpoint restriction (x10ºC)", allowedValues: "[4,5..35 ºC]", lenBits: 16, format: S2, readWrite: RW, operations: "0,1" },
  26: { spec: 26, signalIndex: SIGNAL.COOLMAX, description: "Maximum cool setpoint restriction (x10ºC)", allowedValues: "[4,5..35 ºC]", lenBits: 16, format: S2, readWrite: RW, operations: "0,1" },
  27: { spec: 27, signalIndex: SIGNAL.HEATMIN, description: "Minimum heat setpoint restriction (x10ºC)", allowedValues: "[4,5..35 ºC]", lenBits: 16, format: S2, readWrite: RW, operations: "0,1" },
  28: { spec: 28, signalIndex: SIGNAL.HEATMAX, description: "Maximum heat setpoint restriction (x10ºC)", allowedValues: "[4,5..35 ºC]", lenBits: 16, format: S2, readWrite: RW, operations: "0,1" },
  29: { spec: 29, signalIndex: SIGNAL.AUTOMIN, description: "Minimum auto setpoint restriction (x10ºC)", allowedValues: "[4,5..35 ºC]", lenBits: 16, format: S2, readWrite: RW, operations: "0,1" },
  30: { spec: 30, signalIndex: SIGNAL.AUTOMAX, description: "Maximum auto setpoint restriction (x10ºC)", allowedValues: "[4,5..35 ºC]", lenBits: 16, format: S2, readWrite: RW, operations: "0,1" },
  31: { spec: 31, signalIndex: SIGNAL.SETTEMP1, description: "Cool/dry/auto(upper) dual temperature setpoint (x10ºC)", allowedValues: "[4,5..90 ºC]", lenBits: 16, format: S2, readWrite: RW, operations: "0,1", note: "UNVERIFIED — IC/FU dual setpoint" },
  32: { spec: 32, signalIndex: SIGNAL.SETTEMP1, description: "Heating ATW & HWHP temperature setpoint (x10ºC)", allowedValues: "[4,5..90 ºC]", lenBits: 16, format: S2, readWrite: RW, operations: "0,1", note: "UNVERIFIED — BU/WH/CEH dual setpoint" },
  33: { spec: 33, signalIndex: SIGNAL.SETTEMP2, description: "Heat/auto(lower) dual temperature setpoint (x10ºC)", allowedValues: "[4,5..90 ºC]", lenBits: 16, format: S2, readWrite: RW, operations: "0,1", note: "UNVERIFIED — IC/FU dual setpoint" },
  34: { spec: 34, signalIndex: SIGNAL.SETTEMP2, description: "Heating ECO ATW temperature setpoint (x10ºC)", allowedValues: "[4,5..90 ºC]", lenBits: 16, format: S2, readWrite: RW, operations: "0,1", note: "UNVERIFIED — BU/WH/CEH dual setpoint" },
  35: { spec: 35, signalIndex: SIGNAL.SETTEMP3, description: "Auto single temperature setpoint (x10ºC)", allowedValues: "[4,5..90 ºC]", lenBits: 16, format: S2, readWrite: RW, operations: "0,1", note: "UNVERIFIED — IC/FU dual setpoint" },
  36: { spec: 36, signalIndex: SIGNAL.SETTEMP3, description: "Hot water ATW & HWHP temperature setpoint (x10ºC)", allowedValues: "[4,5..90 ºC]", lenBits: 16, format: S2, readWrite: RW, operations: "0,1", note: "UNVERIFIED — BU/WH/CEH dual setpoint" },
  37: { spec: 37, signalIndex: SIGNAL.SETTEMP4, description: "Setback upper temperature setpoint (x10ºC)", allowedValues: "[4,5..90 ºC]", lenBits: 16, format: S2, readWrite: RW, operations: "0,1", note: "UNVERIFIED — IC/FU dual setpoint" },
  38: { spec: 38, signalIndex: SIGNAL.SETTEMP4, description: "Anti-Freeze ATW temperature setpoint (x10ºC)", allowedValues: "[4,5..90 ºC]", lenBits: 16, format: S2, readWrite: RW, operations: "0,1", note: "UNVERIFIED — BU/WH/CEH dual setpoint" },
  39: { spec: 39, signalIndex: SIGNAL.SETTEMP5, description: "Setback lower temperature setpoint (x10ºC)", allowedValues: "[4,5..90 ºC]", lenBits: 16, format: S2, readWrite: RW, operations: "0,1", note: "UNVERIFIED — IC/FU dual setpoint" },
  40: { spec: 40, signalIndex: SIGNAL.SETTEMP5, description: "Cooling ATW temperature setpoint (x10ºC)", allowedValues: "[4,5..90 ºC]", lenBits: 16, format: S2, readWrite: RW, operations: "0,1", note: "UNVERIFIED — BU/WH/CEH dual setpoint" },
  41: { spec: 41, signalIndex: SIGNAL.ROOMHUMIDTY, description: "Room Humidity", allowedValues: "[0..100%]", lenBits: 16, format: UNS, readWrite: RO, operations: "" },
  42: { spec: 42, signalIndex: SIGNAL.BRIGHTNESS, description: "Brightness status", allowedValues: "[0: Dark, 1: Bright]", lenBits: 16, format: UNS, readWrite: RO, operations: "" },
  43: { spec: 43, signalIndex: SIGNAL.OCCUPANCY, description: "Occupancy", allowedValues: "[0: Absence, 1:Occupancy]", lenBits: 16, format: UNS, readWrite: RO, operations: "" },
  44: { spec: 44, signalIndex: SIGNAL.OUTDOORTEMP, description: "Outdoor temperature", allowedValues: "[0.0..99.9 ºC]", lenBits: 16, format: S2, readWrite: RO, operations: "", note: "UNVERIFIED — AE_200 + CEH groups only" },
  45: { spec: 45, signalIndex: SIGNAL.FILTERSIGN, description: "Filter status", allowedValues: "[0-Ok, 1-Dirty]", lenBits: 16, format: UNS, readWrite: RO, operations: "" },
  46: { spec: 46, signalIndex: SIGNAL.FILTERSIGN_TRIGGER, description: "Dirty filter indication reset", allowedValues: "[1: Reset the filter]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  // V4 compatibility mode specs (legacy combined mode/fan/vane signals).
  47: { spec: 47, signalIndex: SIGNAL.MODE, description: "Operation Mode IC", allowedValues: "[0-Cool,1-Dry,2-Fan,3-Heat,4-Auto,5-AutoHeat,6-AutoCool,7-SetBack,8-SetbackHeat,9-SetbackCool]", lenBits: 16, format: UNS, readWrite: RW, operations: "12,0", note: "UNVERIFIED — V4_COMP mode only" },
  48: { spec: 48, signalIndex: SIGNAL.MODE, description: "Operation Mode LC & LOSSNAY", allowedValues: "[7-HeatRecovery, 8-LcAuto, 9-Bypass]", lenBits: 16, format: UNS, readWrite: RW, operations: "13,0", note: "UNVERIFIED — V4_COMP mode only" },
  49: { spec: 49, signalIndex: SIGNAL.MODE, description: "Operation Mode ATW & HWHP", allowedValues: "[0-Cooling,1-AntiFreeze,2-HeatingEco,3-Heating,4-HotWater]", lenBits: 16, format: UNS, readWrite: RW, operations: "14,0", note: "UNVERIFIED — V4_COMP mode only" },
  50: { spec: 50, signalIndex: SIGNAL.FANSPEED, description: "Fan Speed IC & LOSSNAY", allowedValues: "[0-Low, 1-MedL, 2-MedH, 3-High, 4-Auto]", lenBits: 16, format: UNS, readWrite: RW, operations: "15,0", note: "UNVERIFIED — V4_COMP mode only" },
  51: { spec: 51, signalIndex: SIGNAL.AIRDIRECTION, description: "Vane position", allowedValues: "[0-Horizontal, 1-Mid1, 2-Mid2, 3-Vertical, 4-Swing, 5-Auto, 6-Mid3]", lenBits: 16, format: UNS, readWrite: RW, operations: "16,0", note: "UNVERIFIED — V4_COMP mode only" },
  // Consumption function specs (EnergyMeter-driven; disabled in the fixture).
  52: { spec: 52, signalIndex: SIGNAL.CONS_YESTERDAY, description: "Consumption Yesterday", allowedValues: "[kWh]", lenBits: 32, format: UNS, readWrite: RO, operations: "", note: "UNVERIFIED — consumption function" },
  53: { spec: 53, signalIndex: SIGNAL.CONS_TODAY, description: "Consumption Today", allowedValues: "[kWh]", lenBits: 32, format: UNS, readWrite: RO, operations: "", note: "UNVERIFIED — consumption function" },
  54: { spec: 54, signalIndex: SIGNAL.CONS_TOTAL, description: "Consumption Total", allowedValues: "[kWh]", lenBits: 32, format: UNS, readWrite: RO, operations: "", note: "UNVERIFIED — consumption function" },
  55: { spec: 55, signalIndex: SIGNAL.CONS_YEST_HEAT, description: "Consumption Yesterday Heat", allowedValues: "[kWh]", lenBits: 32, format: UNS, readWrite: RO, operations: "", note: "UNVERIFIED — consumption function" },
  56: { spec: 56, signalIndex: SIGNAL.CONS_TODAY_HEAT, description: "Consumption Today Heat", allowedValues: "[kWh]", lenBits: 32, format: UNS, readWrite: RO, operations: "", note: "UNVERIFIED — consumption function" },
  57: { spec: 57, signalIndex: SIGNAL.CONS_TOTAL_HEAT, description: "Consumption Total Heat", allowedValues: "[kWh]", lenBits: 32, format: UNS, readWrite: RO, operations: "", note: "UNVERIFIED — consumption function" },
  58: { spec: 58, signalIndex: SIGNAL.CONS_YEST_COOL, description: "Consumption Yesterday Cool", allowedValues: "[kWh]", lenBits: 32, format: UNS, readWrite: RO, operations: "", note: "UNVERIFIED — consumption function" },
  59: { spec: 59, signalIndex: SIGNAL.CONS_TODAY_COOL, description: "Consumption Today Cool", allowedValues: "[kWh]", lenBits: 32, format: UNS, readWrite: RO, operations: "", note: "UNVERIFIED — consumption function" },
  60: { spec: 60, signalIndex: SIGNAL.CONS_TOTAL_COOL, description: "Consumption Total Cool", allowedValues: "[kWh]", lenBits: 32, format: UNS, readWrite: RO, operations: "", note: "UNVERIFIED — consumption function" },
};

/** Controller-general specs (GroupIndex = -1); verified against the fixture. */
export const GENERAL_SPECS: Readonly<Record<number, MeSpecInfo>> = {
  0: { spec: 0, signalIndex: SIGNAL.ERRORSIGN, description: "Centralized controller communication error", allowedValues: "[0-Ok, 1-Communication error]", lenBits: 16, format: UNS, readWrite: RO, operations: "" },
  1: { spec: 1, signalIndex: SIGNAL.ERRORSIGN_TRIGGER, description: "Reset errors for all the groups", allowedValues: "[1-Reset the errors]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  2: { spec: 2, signalIndex: SIGNAL.DRIVE, description: "On (all the groups)", allowedValues: "[1-Set the groups On]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "", note: "operations = project-specific constant LUT" },
  3: { spec: 3, signalIndex: SIGNAL.DRIVE, description: "Off (all the groups)", allowedValues: "[1-Set the groups Off]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "", note: "operations = project-specific constant LUT" },
  4: { spec: 4, signalIndex: SIGNAL.MODE_IC, description: "Operation Mode Auto (all the IC groups)", allowedValues: "[1-Set Auto Mode]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  5: { spec: 5, signalIndex: SIGNAL.MODE_IC, description: "Operation Mode Heat (all the IC groups)", allowedValues: "[1-Set Heat Mode]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  6: { spec: 6, signalIndex: SIGNAL.MODE_IC, description: "Operation Mode Dry (all the IC groups)", allowedValues: "[1-Set Dry Mode]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  7: { spec: 7, signalIndex: SIGNAL.MODE_IC, description: "Operation Mode Fan (all the IC groups)", allowedValues: "[1-Set Fan Mode]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  8: { spec: 8, signalIndex: SIGNAL.MODE_IC, description: "Operation Mode Cool (all the IC groups)", allowedValues: "[1-Set Cool Mode]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  9: { spec: 9, signalIndex: SIGNAL.MODE_IC, description: "Operation Mode Setback (all the IC groups)", allowedValues: "[1-Set Setback Mode]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  10: { spec: 10, signalIndex: SIGNAL.MODE_LOSSNAY, description: "Operation Mode LC_Auto (all the LOSSNAY groups)", allowedValues: "[1-Set LC_Auto Mode]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  11: { spec: 11, signalIndex: SIGNAL.MODE_LOSSNAY, description: "Operation Mode Heat Recovery (all the LOSSNAY groups)", allowedValues: "[1-Set Heat Recovery Mode]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  12: { spec: 12, signalIndex: SIGNAL.MODE_LOSSNAY, description: "Operation Mode Bypass (all the LOSSNAY groups)", allowedValues: "[1-Set Bypass Mode]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  13: { spec: 13, signalIndex: SIGNAL.FANSPEED_IC, description: "Fan Speed Auto (all the IC groups)", allowedValues: "[1-Set Fan Speed Auto]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  14: { spec: 14, signalIndex: SIGNAL.FANSPEED_IC, description: "Fan Speed Low (all the IC groups)", allowedValues: "[1-Set Fan Speed Low]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  15: { spec: 15, signalIndex: SIGNAL.FANSPEED_IC, description: "Fan Speed Mid-1 (all the IC groups)", allowedValues: "[1-Set Fan Speed Mid-1]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  16: { spec: 16, signalIndex: SIGNAL.FANSPEED_IC, description: "Fan Speed Mid-2 (all the IC groups)", allowedValues: "[1-Set Fan Speed Mid-2]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  17: { spec: 17, signalIndex: SIGNAL.FANSPEED_IC, description: "Fan Speed High (all the IC groups)", allowedValues: "[1-Set Fan Speed High]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  18: { spec: 18, signalIndex: SIGNAL.FANSPEED_LOSSNAY, description: "Fan Speed Low (all the LOSSNAY groups)", allowedValues: "[1-Set Fan Speed Low]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  28: { spec: 28, signalIndex: SIGNAL.FANSPEED_LOSSNAY, description: "Fan Speed Mid-1 (all the LOSSNAY groups)", allowedValues: "[1-Set Fan Speed Mid-1]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  29: { spec: 29, signalIndex: SIGNAL.FANSPEED_LOSSNAY, description: "Fan Speed Mid-2 (all the LOSSNAY groups)", allowedValues: "[1-Set Fan Speed Mid-2]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  19: { spec: 19, signalIndex: SIGNAL.FANSPEED_LOSSNAY, description: "Fan Speed High (all the LOSSNAY groups)", allowedValues: "[1-Set Fan Speed High]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  20: { spec: 20, signalIndex: SIGNAL.AIRDIRECTION, description: "Vane position Auto (all the IC groups)", allowedValues: "[1-Set Vanes Auto]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  21: { spec: 21, signalIndex: SIGNAL.AIRDIRECTION, description: "Vane position Horizontal (all the IC groups)", allowedValues: "[1-Set Vanes Horizontal]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  22: { spec: 22, signalIndex: SIGNAL.AIRDIRECTION, description: "Vane position Position-2 (all the IC groups)", allowedValues: "[1-Set Vanes Position-2]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  23: { spec: 23, signalIndex: SIGNAL.AIRDIRECTION, description: "Vane position Position-3 (all the IC groups)", allowedValues: "[1-Set Vanes Position-3]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  24: { spec: 24, signalIndex: SIGNAL.AIRDIRECTION, description: "Vane position Position-4 (all the IC groups)", allowedValues: "[1-Set Vanes Position-4]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  25: { spec: 25, signalIndex: SIGNAL.AIRDIRECTION, description: "Vane position Vertical (all the IC groups)", allowedValues: "[1-Set Vanes Vertical]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  26: { spec: 26, signalIndex: SIGNAL.AIRDIRECTION, description: "Vane position Swing (all the IC groups)", allowedValues: "[1-Set Vanes Swing]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "" },
  27: { spec: 27, signalIndex: SIGNAL.SETTEMP, description: "Individual Temperature Setpoint (x10ºC) (all the groups)", allowedValues: "[5..90 ºC]", lenBits: 16, format: UNS, readWrite: TRIG, operations: "0,1" },
};

export function specInfo(spec: number, general: boolean): MeSpecInfo | undefined {
  return general ? GENERAL_SPECS[spec] : GROUP_SPECS[spec];
}

/** Fan-speed allowed values depend on the group's NumOfFanSpeeds. */
export function fanSpeedAllowedValues(spec: number, fanSpeeds: number): string {
  const lossnay = spec === 5;
  if (fanSpeeds === 2) return lossnay ? "[1-Mid2, 2-High]" : "[0-Auto, 1-Mid2, 2-High]";
  if (fanSpeeds === 3) return lossnay ? "[1-Mid2, 2-Mid1, 3-High]" : "[0-Auto, 1-Mid2, 2-Mid1, 3-High]";
  return lossnay ? "[1-Low, 2-Mid2, 3-Mid1, 4-High]" : "[0-Auto, 1-Low, 2-Mid2, 3-Mid1, 4-High]";
}

/** Human description + allowed values for a spec, with context applied. */
export function describeSpec(
  spec: number,
  context: { general?: boolean; fanSpeeds?: number; temperatureMode?: METemperatureMode } = {},
): { description: string; allowedValues: string } | undefined {
  const info = specInfo(spec, context.general ?? false);
  if (!info) return undefined;
  let description = info.description;
  let allowedValues = info.allowedValues;
  if (allowedValues === "{fan-ic}" || allowedValues === "{fan-lc}") {
    allowedValues = fanSpeedAllowedValues(spec, context.fanSpeeds ?? 4);
  }
  if (context.temperatureMode === TEMPERATURE_MODES.FAHRENHEIT) {
    description = description.replaceAll("ºC", "ºF");
  }
  return { description, allowedValues };
}
