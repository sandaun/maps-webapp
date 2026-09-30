import type { KnxMbmSignal, Conversion } from "@/gateway-families/knx-mbm/model";
import type { MbmDevice } from "@/protocols/modbus/master";

export interface DeviceTemplatePreview {
  token: string;
  revision: number;
  fileName: string;
  sourceProtocol: "knx" | "bacnet";
  version: string;
  mapsVersion: string;
  author: string;
  device: MbmDevice;
  signals: KnxMbmSignal[];
  conversions: Conversion[];
  warnings: string[];
}

/** Applied through the normal project patch queue, against the preview revision. */
export interface ApplyDeviceTemplate {
  type: "applyDeviceTemplate";
  token: string;
  locator: { kind: "rtu" | "tcp"; nodeIndex: number };
  name: string;
  slave: number;
  enabled: number[];
  includeDisabled: boolean;
}

export interface TemplateLibraryEntry {
  id: string;
  manufacturer: string;
  manufacturerSlug: string;
  model: string;
  modelVersion: string;
  version: string;
  protocol: "knx" | "bacnet";
}

export interface TemplateLibrary {
  entries: TemplateLibraryEntry[];
  manufacturers: string[];
}
