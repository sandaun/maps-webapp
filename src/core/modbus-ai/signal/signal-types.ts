// Type-only boundary for Signal ad9d60c. No BACnet, KNX or provider runtime is imported.
import type { RawModbusRow, RawModbusTable } from "./schema";

export type DetectedAddressBase = "0-based" | "1-based" | "plc" | "unknown";
export type BitDescriptor = {
  bit: number;
  name: string;
  description: string | null;
};
export type BitExpansion = {
  nameTemplate: string | null;
  bits: BitDescriptor[];
};
export type AIModbusSignal = {
  deviceId: string;
  signalName: string;
  registerType: "HoldingRegister" | "InputRegister" | "Coil" | "DiscreteInput";
  address: number | null;
  dataType:
    | "Boolean"
    | "Int16"
    | "Uint16"
    | "Int32"
    | "Uint32"
    | "Float32"
    | "Int64"
    | "Uint64";
  units: string | null;
  description: string | null;
  signalType: "binary" | "enum" | "temperature" | null;
  statesCount: number | null;
  mode: "R" | "W" | "R/W" | null;
  factor: number | null;
  bit: number | null;
  bitCount: number | null;
  confidence: number;
  applicableModels: string[] | null;
  addressTemplate: {
    base: number;
    stride: number;
    indexVar: string;
    indexRange: [number, number];
    nameTemplate: string | null;
  } | null;
  bitExpansion: BitExpansion | null;
  needsVerification: boolean | null;
  // Additive MAPS provenance only; the Signal normalizer's decisions are unchanged.
  sourceRow?: RawModbusRow;
  sourceTable?: RawModbusTable;
};
