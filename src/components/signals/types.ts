import type { KnxFlags } from "@/protocols/knx";
import type { SignalPatchInput } from "@/lib/project-types";

export type BandId = "project" | "bms" | "gateway" | "device";

export type EditorKind = "none" | "text" | "number" | "select" | "switch" | "flags";

export interface SelectOption {
  value: string;
  label: string;
}

export interface GridColumn<R> {
  id: string;
  group: BandId;
  header: string;
  width: number;
  minWidth?: number;
  maxWidth?: number;
  resizable?: boolean;
  frozen?: boolean;
  kind: EditorKind;
  /** Shown in bulk "Edit field…"; omit to exclude from bulk. */
  bulkLabel?: string;
  mono?: boolean;
  getText: (row: R) => string;
  getTitle?: (row: R) => string;
  /** Value used when opening an editor (select/text). Defaults to getText. */
  getEditorValue?: (row: R) => string;
  getChecked?: (row: R) => boolean;
  getFlags?: (row: R) => KnxFlags;
  options?: (row: R) => SelectOption[];
  parse?: (row: R, raw: string) => { patch: SignalPatchInput } | { error: string };
  toPatchFromSwitch?: (row: R, checked: boolean) => SignalPatchInput;
  toPatchFromFlags?: (row: R, flags: KnxFlags) => SignalPatchInput;
  inverseFromSwitch?: (row: R) => SignalPatchInput;
  inverseFromText?: (row: R) => SignalPatchInput;
  inverseFromFlags?: (row: R) => SignalPatchInput;
}

export const BAND_STYLE: Record<BandId, { bg: string; color: string; border: string }> = {
  project: {
    bg: "#FFFFFF",
    color: "var(--color-fg-subtle)",
    border: "var(--color-border)",
  },
  bms: {
    bg: "var(--color-bms-surface)",
    color: "var(--color-bms-text)",
    border: "var(--color-bms-border)",
  },
  gateway: {
    bg: "var(--color-gateway-surface)",
    color: "var(--color-hms-blue)",
    border: "var(--color-border)",
  },
  device: {
    bg: "var(--color-device-surface)",
    color: "var(--color-device-text)",
    border: "var(--color-device-border)",
  },
};

export const PAGE_SIZE = 100;
export const ROW_HEIGHT = 31;
export const GROUP_HEADER_H = 29;
export const COL_HEADER_H = 31;

export const KNX_GROUP_LABELS: Record<BandId, string> = {
  project: "PROJECT",
  bms: "KNX",
  gateway: "GATEWAY",
  device: "MODBUS",
};

export const ME_GROUP_LABELS: Record<BandId, string> = {
  project: "PROJECT",
  bms: "MITSUBISHI ELECTRIC",
  gateway: "GATEWAY",
  device: "MODBUS",
};
