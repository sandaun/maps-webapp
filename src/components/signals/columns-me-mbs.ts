import type { MeMbsProject, MeMbsSignal } from "@/gateway-families/me-mbs/model";
import { describeSpec } from "@/protocols/me";
import { FORMAT_LABELS } from "@/protocols/modbus/master/types";
import { ADDRESS_MODES, MAX_ADDRESS, READ_WRITE } from "@/protocols/modbus/slave";
import { projectColumns } from "./columns-project";
import type { GridColumn } from "./types";

const ACCESS_LABELS: Record<number, string> = {
  [READ_WRITE.READ]: "Status",
  [READ_WRITE.TRIGGER]: "Control",
  [READ_WRITE.READWRITE]: "Control + status",
};

const DIRECTION_LABELS: Record<number, { arrow: string; title: string }> = {
  [READ_WRITE.READ]: { arrow: "←", title: "Status · read only" },
  [READ_WRITE.TRIGGER]: { arrow: "→", title: "Control · trigger" },
  [READ_WRITE.READWRITE]: { arrow: "↔", title: "Control + status · read/write" },
};

export interface MeSignalRow {
  signal: MeMbsSignal;
  acParameter: string;
  scopeLabel: string;
  valuesLabel: string;
  searchText: string;
}

export function meScopeLabel(project: MeMbsProject, signal: MeMbsSignal): string {
  const { g50Index, groupIndex, unitId } = signal.me;
  if (groupIndex < 0) return unitId >= 0 ? `C${g50Index + 1} · unit ${unitId}` : "Controller-wide";
  const group = project.me.controllers[g50Index]?.groups.find((g) => g.index === groupIndex);
  const base = `C${g50Index + 1} · G${groupIndex + 1}`;
  return group?.description ? `${base} — ${group.description}` : base;
}

export function meAcParameter(project: MeMbsProject, signal: MeMbsSignal): {
  description: string;
  allowedValues: string;
} {
  const { groupIndex, signalSpecIndex } = signal.me;
  const group = project.me.controllers[signal.me.g50Index]?.groups.find((g) => g.index === groupIndex);
  const info = describeSpec(signalSpecIndex, {
    general: groupIndex < 0 && signal.me.unitId < 0,
    fanSpeeds: group?.fanSpeeds ?? 4,
    temperatureMode: project.me.temperatureMode,
  });
  return {
    description: info?.description ?? `Spec ${signalSpecIndex}`,
    allowedValues: info?.allowedValues ?? "—",
  };
}

export function toMeRow(project: MeMbsProject, signal: MeMbsSignal): MeSignalRow {
  const ac = meAcParameter(project, signal);
  const scope = meScopeLabel(project, signal);
  return {
    signal,
    acParameter: ac.description,
    scopeLabel: scope,
    valuesLabel: ac.allowedValues,
    searchText: [signal.id, signal.description, ac.description, scope, signal.modbus.address, signal.modbus.slaveIndex]
      .join(" ")
      .toLowerCase(),
  };
}

export const ME_TAB_ORDER = ["address"];

export function meMbsColumns(project: MeMbsProject): GridColumn<MeSignalRow>[] {
  const customAddress = project.mbs.addressMode === ADDRESS_MODES.CUSTOM;

  return [
    ...projectColumns<MeSignalRow>({
      id: (row) => row.signal.id,
      description: (row) => row.signal.description,
      active: (row) => row.signal.active,
      descriptionEditable: false,
    }),
    {
      id: "controller",
      group: "bms",
      header: "Controller",
      width: 150,
      minWidth: 90,
      maxWidth: 280,
      kind: "none",
      getText: (row) => {
        const i = row.signal.me.g50Index;
        const c = project.me.controllers[i];
        return c?.description ? `C${i + 1} — ${c.description}` : `C${i + 1}`;
      },
    },
    {
      id: "group",
      group: "bms",
      header: "Group",
      width: 190,
      minWidth: 100,
      maxWidth: 360,
      kind: "none",
      getText: (row) => row.scopeLabel,
    },
    {
      id: "spec",
      group: "bms",
      header: "AC parameter",
      width: 280,
      minWidth: 160,
      maxWidth: 520,
      kind: "none",
      getText: (row) => row.acParameter,
    },
    {
      id: "values",
      group: "bms",
      header: "Values",
      width: 220,
      minWidth: 120,
      maxWidth: 520,
      kind: "none",
      getText: (row) => row.valuesLabel,
    },
    {
      id: "direction",
      group: "gateway",
      header: "DIR",
      width: 72,
      minWidth: 64,
      maxWidth: 88,
      resizable: false,
      kind: "none",
      mono: true,
      getText: (row) => DIRECTION_LABELS[row.signal.modbus.readWrite]?.arrow ?? "—",
      getTitle: (row) => DIRECTION_LABELS[row.signal.modbus.readWrite]?.title ?? "No direction",
    },
    {
      id: "address",
      group: "device",
      header: "Register",
      width: 80,
      minWidth: 68,
      maxWidth: 140,
      kind: customAddress ? "number" : "none",
      bulkLabel: customAddress ? "Register" : undefined,
      mono: true,
      getText: (row) => String(row.signal.modbus.address),
      parse: customAddress
        ? (_row, raw) => {
            const register = Number(raw);
            if (!Number.isInteger(register) || register < 0 || register > MAX_ADDRESS) {
              return { error: `Invalid register address — 0–${MAX_ADDRESS}` };
            }
            return { patch: { modbus: { address: register } } };
          }
        : undefined,
      inverseFromText: customAddress
        ? (row) => ({ modbus: { address: row.signal.modbus.address } })
        : undefined,
    },
    {
      id: "access",
      group: "device",
      header: "Access",
      width: 118,
      minWidth: 90,
      maxWidth: 180,
      kind: "none",
      getText: (row) => ACCESS_LABELS[row.signal.modbus.readWrite] ?? "?",
    },
    {
      id: "format",
      group: "device",
      header: "Format",
      width: 96,
      minWidth: 72,
      maxWidth: 180,
      kind: "none",
      getText: (row) => FORMAT_LABELS[row.signal.modbus.format] ?? "?",
    },
    {
      id: "lenBits",
      group: "device",
      header: "Len",
      width: 56,
      minWidth: 48,
      maxWidth: 90,
      kind: "none",
      mono: true,
      getText: (row) => `${row.signal.modbus.lenBits}`,
    },
  ];
}
