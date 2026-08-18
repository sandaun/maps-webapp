import {
  GROUPS_PER_CONTROLLER,
  MAX_CONTROLLERS,
  specInfo,
} from "@/protocols/me";
import {
  checkMbsSignal,
  COMM_ERROR_TOUT_RANGE,
  findAddressCollisions,
  getSignalAddress,
  isValidSlaveId,
  type MbsConfig,
} from "@/protocols/modbus/slave";
import {
  MAX_ACTIVE_SIGNALS,
  MAX_TOTAL_SIGNAL_ROWS,
} from "@/core/signals/model";
import type { ValidationIssue } from "@/core/validation/issue";
import type { MeMbsProject, MeMbsSignal } from "./model";

/**
 * ME–MBS project validation. Codes are stable and documented in
 * docs/knx-mbm-mvp.md (Pas 2.3). Errors block save/deploy; warnings do not.
 */
export function validateProject(project: MeMbsProject): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  validateLimits(project, issues);
  validateMbsConfig(project, issues);
  validateMeTopology(project, issues);
  for (const signal of project.signals) {
    validateSignal(project, signal, issues);
  }
  validateAddressCollisions(project, issues);
  return issues;
}

function validateLimits(project: MeMbsProject, issues: ValidationIssue[]): void {
  const active = project.signals.filter((s) => s.active).length;
  if (active > MAX_ACTIVE_SIGNALS) {
    issues.push({
      code: "SIG-LIMIT-ACTIVE",
      severity: "error",
      message: `${active} active signals exceed the ${MAX_ACTIVE_SIGNALS} limit.`,
      ref: { screen: "signals", entity: "project" },
    });
  }
  if (project.signals.length > MAX_TOTAL_SIGNAL_ROWS) {
    issues.push({
      code: "SIG-LIMIT-TOTAL",
      severity: "error",
      message: `${project.signals.length} signal rows exceed the ${MAX_TOTAL_SIGNAL_ROWS} limit.`,
      ref: { screen: "signals", entity: "project" },
    });
  }
}

function validateMbsConfig(project: MeMbsProject, issues: ValidationIssue[]): void {
  const { mbs } = project;
  const ref = { screen: "configuration" as const, entity: "project" as const };

  if (!isValidSlaveId(mbs.rtu.slaveNumber)) {
    issues.push({
      code: "MBS-SLAVE-RANGE",
      severity: "error",
      message: `RTU slave id ${mbs.rtu.slaveNumber} out of range (1–247).`,
      ref: { ...ref, field: "slaveNumber" },
    });
  }
  if (mbs.commErrorTout < COMM_ERROR_TOUT_RANGE.min || mbs.commErrorTout > COMM_ERROR_TOUT_RANGE.max) {
    issues.push({
      code: "MBS-COMMERR-RANGE",
      severity: "error",
      message: `Communication error timeout ${mbs.commErrorTout}s out of range (${COMM_ERROR_TOUT_RANGE.min}–${COMM_ERROR_TOUT_RANGE.max}).`,
      ref: { ...ref, field: "commErrorTout" },
    });
  }
  const seen = new Map<number, number>();
  mbs.slaves.forEach((slave, i) => {
    const first = seen.get(slave.address);
    if (first !== undefined) {
      issues.push({
        code: "MBS-SLAVE-DUP",
        severity: "error",
        message: `Virtual slave address ${slave.address} is used by both entry ${first} and entry ${i}.`,
        ref: { screen: "configuration", entity: "device", id: `slave:${i}`, field: "address" },
      });
    } else {
      seen.set(slave.address, i);
    }
  });
}

function validateMeTopology(project: MeMbsProject, issues: ValidationIssue[]): void {
  const ref = { screen: "configuration" as const, entity: "project" as const };
  if (project.me.controllers.length > MAX_CONTROLLERS) {
    issues.push({
      code: "ME-CONTROLLER-LIMIT",
      severity: "error",
      message: `At most ${MAX_CONTROLLERS} G50 controllers are supported.`,
      ref,
    });
  }
  project.me.controllers.forEach((controller, ci) => {
    if (controller.groups.length > GROUPS_PER_CONTROLLER) {
      issues.push({
        code: "ME-GROUP-LIMIT",
        severity: "error",
        message: `Controller ${ci + 1}: ${controller.groups.length} groups exceed the ${GROUPS_PER_CONTROLLER} limit.`,
        ref,
      });
    }
    // The desktop tool keeps group configuration under a disabled controller
    // (the real fixture has exactly this); flag it, don't block.
    if (!controller.enabled && controller.groups.some((g) => g.enabled)) {
      issues.push({
        code: "ME-CTRL-DISABLED",
        severity: "warning",
        message: `Controller ${ci + 1} is disabled but has enabled groups.`,
        ref: { screen: "configuration", entity: "device", id: `ctrl:${ci}` },
      });
    }
  });
}

function validateSignal(
  project: MeMbsProject,
  signal: MeMbsSignal,
  issues: ValidationIssue[],
): void {
  const ref = { screen: "signals" as const, entity: "signal" as const, id: signal.id };

  // --- internal (Modbus Slave) side
  for (const code of checkMbsSignal({ active: signal.active, ...signal.modbus })) {
    issues.push({
      code,
      severity: "error",
      message: mbsMessage(code, signal),
      ref: { ...ref, field: mbsField(code) },
    });
  }

  // --- external (ME) side: known spec + group reference
  const general = signal.me.groupIndex === -1 && signal.me.unitId === -1;
  const spec = signal.me.signalSpecIndex;
  const known = spec >= 0 && specInfo(spec, general) !== undefined;
  if (!known) {
    issues.push({
      code: "ME-SPEC-UNKNOWN",
      severity: "error",
      message: `Signal #${signal.id}: unknown signal spec ${spec}${general ? " (general)" : ""}.`,
      ref: { ...ref, field: "signalSpecIndex" },
    });
  }

  if (signal.me.groupIndex >= 0) {
    const controller = project.me.controllers[signal.me.g50Index];
    const group = controller?.groups.find((g) => g.index === signal.me.groupIndex);
    if (!group) {
      issues.push({
        code: "ME-GROUP-REF",
        severity: "error",
        message: `Signal #${signal.id}: references group ${signal.me.groupIndex + 1} of controller ${signal.me.g50Index + 1}, which does not exist.`,
        ref: { ...ref, field: "groupIndex" },
      });
    } else if (!group.enabled) {
      issues.push({
        code: "ME-GROUP-REF",
        severity: "error",
        message: `Signal #${signal.id}: references disabled group ${signal.me.groupIndex + 1} of controller ${signal.me.g50Index + 1}.`,
        ref: { ...ref, field: "groupIndex" },
      });
    }
  }

  // --- spec/address consistency (FIXED / V4_COMP derivable maps only)
  if (known && project.mbs.addressMode !== 1 /* CUSTOM */) {
    const expected = getSignalAddress(project.mbs.addressMode, {
      g50Index: signal.me.g50Index,
      groupIndex: signal.me.groupIndex,
      unitIndex: signal.me.unitId,
      signalSpecIndex: spec,
    });
    if (expected !== null && expected !== signal.modbus.address) {
      issues.push({
        code: "ME-SPEC-ADDRESS",
        severity: "error",
        message: `Signal #${signal.id}: address ${signal.modbus.address} does not match the ${expected} derived from its spec (${project.mbs.addressMode === 2 ? "V4_COMP" : "FIXED"} map).`,
        ref: { ...ref, field: "address" },
      });
    }
  }
}

/** A Modbus server must not answer two signals on the same address. */
function validateAddressCollisions(project: MeMbsProject, issues: ValidationIssue[]): void {
  for (const [a, b] of findAddressCollisions(
    project.signals.map((s) => ({
      id: s.id,
      active: s.active,
      address: s.modbus.address,
      slaveIndex: s.modbus.slaveIndex,
    })),
  )) {
    issues.push({
      code: "MBS-ADDRESS-DUP",
      severity: "error",
      message: `Signals #${a} and #${b} share the same register address.`,
      ref: { screen: "signals", entity: "signal", id: b, field: "address" },
    });
  }
}

function mbsMessage(code: string, signal: MeMbsSignal): string {
  const prefix = `Signal #${signal.id}: `;
  switch (code) {
    case "MBS-READWRITE":
      return `${prefix}read/write value out of range (0=Read, 1=Trigger, 2=ReadWrite).`;
    case "MBS-ADDRESS-RANGE":
      return `${prefix}Modbus address out of range (0–65535).`;
    case "MBS-LEN-FORMAT":
      return `${prefix}data length/format combination not supported (16/32-bit unsigned or signed C2).`;
    case "MBS-STRING-LEN":
      return `${prefix}string format requires a string length of at least 1.`;
    default:
      return `${prefix}${code}`;
  }
}

function mbsField(code: string): string {
  switch (code) {
    case "MBS-READWRITE":
      return "readWrite";
    case "MBS-ADDRESS-RANGE":
      return "address";
    case "MBS-LEN-FORMAT":
      return "lenBits";
    case "MBS-STRING-LEN":
      return "stringLength";
    default:
      return "address";
  }
}

// Re-export for consumers that only need the config type.
export type { MbsConfig };
