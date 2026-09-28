import { MAX_ACTIVE_SIGNALS, MAX_TOTAL_SIGNAL_ROWS } from "@/core/signals/model";
import type { ValidationIssue } from "@/core/validation/issue";
import { checkKnxEndpoint, type KnxRuleCode } from "@/protocols/knx";
import { checkMbsObjects, MBS_DEFAULT_MAX_ADDRESS, type MbsObjectRuleCode } from "@/protocols/modbus/slave";
import type { MbsKnxProject, MbsKnxSignal } from "./model";

/**
 * MBS–KNX project validation, following `IntesisProjectMBSKNX_RT.CheckProject`
 * (IntesisProjectMBSKNX_RT.cs:633-712); codes and MAPS quirks in
 * docs/reference/mbs-knx-analisi.md §5. Unlike MAPS, which stops at the
 * first error, every issue is listed. Errors block save/deploy; warnings do not.
 */

/** Slave number range of the MAPS form (`nb_slaveNumber`, frmInternalMBS.cs:941-942). */
export const MBS_KNX_SLAVE_RANGE = { min: 1, max: 255 } as const;

/**
 * Licence limits without a connected gateway (`UpdateProjectLicense` with no
 * numeric licence, IntesisProjectMBSKNX_RT.cs:276-283): 3000 Modbus objects,
 * 3000 group addresses, 6000 associations.
 */
export const MBS_KNX_MAX_GROUP_ADDRESSES = 3000;
export const MBS_KNX_MAX_ASSOCIATIONS = 6000;

export function validateProject(project: MbsKnxProject): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  validateConfig(project, issues);
  validateLimits(project, issues);
  const active = project.signals.filter((s) => s.active);
  for (const signal of active) {
    for (const code of checkKnxEndpoint(signal.knx, {
      extended: project.knx.extendedAddresses,
      checkListening: true,
    })) {
      issues.push({
        code,
        severity: "error",
        message: knxMessage(code, signal),
        ref: { screen: "signals", entity: "signal", id: signal.id, field: knxField(code) },
      });
    }
  }
  const mbsViolations = checkMbsObjects(
    active.map((s) => ({ id: s.id, ...s.modbus })),
    { maxAddress: MBS_DEFAULT_MAX_ADDRESS, registerBase: project.mbs.registerBase },
  );
  for (const { code, id } of mbsViolations) {
    issues.push({
      code,
      severity: "error",
      message: mbsMessage(code, id),
      ref: { screen: "signals", entity: "signal", id, field: mbsField(code) },
    });
  }
  return issues;
}

function validateConfig(project: MbsKnxProject, issues: ValidationIssue[]): void {
  const ref = { screen: "configuration" as const, entity: "project" as const };
  const pa = project.knx.physicalAddress;
  if (pa <= 0 || pa > 65535) {
    issues.push({
      code: "KNX-PA-FORMAT",
      severity: "error",
      message: `Invalid KNX physical address value ${pa}.`,
      ref: { ...ref, field: "physicalAddress" },
    });
  }
  const slave = project.mbs.rtu.slaveNumber;
  if (slave < MBS_KNX_SLAVE_RANGE.min || slave > MBS_KNX_SLAVE_RANGE.max) {
    issues.push({
      code: "MBS-SLAVE-RANGE",
      severity: "error",
      message: `Modbus slave number ${slave} out of range (${MBS_KNX_SLAVE_RANGE.min}–${MBS_KNX_SLAVE_RANGE.max}).`,
      ref: { ...ref, field: "slaveNumber" },
    });
  }
}

function validateLimits(project: MbsKnxProject, issues: ValidationIssue[]): void {
  const ref = { screen: "signals" as const, entity: "project" as const };
  const active = project.signals.filter((s) => s.active);
  // CheckMinimumObjectEnabled: MAPS refuses to send a project without signals.
  if (active.length === 0) {
    issues.push({
      code: "SIG-NONE-ACTIVE",
      severity: "error",
      message: "The project has no active signal.",
      ref,
    });
  }
  if (active.length > MAX_ACTIVE_SIGNALS) {
    issues.push({
      code: "SIG-LIMIT-ACTIVE",
      severity: "error",
      message: `${active.length} active signals exceed the ${MAX_ACTIVE_SIGNALS} limit.`,
      ref,
    });
  }
  if (project.signals.length > MAX_TOTAL_SIGNAL_ROWS) {
    issues.push({
      code: "SIG-LIMIT-TOTAL",
      severity: "error",
      message: `${project.signals.length} signal rows exceed the ${MAX_TOTAL_SIGNAL_ROWS} limit.`,
      ref,
    });
  }
  // ExternalKnx.CheckLicense (ExternalKnx.cs:853-872): the distinct group
  // addresses and the object/address pairs of the active signals.
  const addresses = new Set<number>();
  const associations = new Set<string>();
  active.forEach((signal, i) => {
    for (const ga of [signal.knx.groupAddress, ...signal.knx.additionalAddresses]) {
      addresses.add(ga);
      associations.add(`${i}:${ga}`);
    }
  });
  if (addresses.size > MBS_KNX_MAX_GROUP_ADDRESSES) {
    issues.push({
      code: "KNX-LIMIT-GA",
      severity: "error",
      message: `${addresses.size} group addresses exceed the ${MBS_KNX_MAX_GROUP_ADDRESSES} limit.`,
      ref,
    });
  }
  if (associations.size > MBS_KNX_MAX_ASSOCIATIONS) {
    issues.push({
      code: "KNX-LIMIT-ASSOC",
      severity: "error",
      message: `${associations.size} group address associations exceed the ${MBS_KNX_MAX_ASSOCIATIONS} limit.`,
      ref,
    });
  }
}

function knxMessage(code: KnxRuleCode, signal: MbsKnxSignal): string {
  switch (code) {
    case "KNX-GA-EXTENDED":
      return `Signal #${signal.id}: group address exceeds 15/7/255; enable extended addresses.`;
    case "KNX-GA-FORMAT":
      return `Signal #${signal.id}: invalid KNX group address.`;
    case "KNX-DPT-INVALID":
      return `Signal #${signal.id}: DPT is not in the supported KNX selection.`;
    case "KNX-FLAGS-NONE":
      return `Signal #${signal.id}: at least one KNX flag (U, T, Ri, W, R) is required.`;
    case "KNX-FLAGS-RI-R":
      return `Signal #${signal.id}: flags Ri and R are mutually exclusive.`;
    case "KNX-FLAGS-LISTEN":
      return `Signal #${signal.id}: additional addresses require the U or W flag.`;
    case "KNX-GA-LISTEN":
      return `Signal #${signal.id}: invalid additional group address (0, or past 15/7/255 without extended addresses).`;
  }
}

function knxField(code: KnxRuleCode): string {
  switch (code) {
    case "KNX-GA-EXTENDED":
    case "KNX-GA-FORMAT":
      return "groupAddress";
    case "KNX-GA-LISTEN":
      return "additionalAddresses";
    case "KNX-DPT-INVALID":
      return "dpt";
    default:
      return "flags";
  }
}

function mbsMessage(code: MbsObjectRuleCode, id: number): string {
  const prefix = `Signal #${id}: `;
  switch (code) {
    case "MBS-FORMAT-NONE":
      return `${prefix}select a Modbus format.`;
    case "MBS-STRING-LEN":
      return `${prefix}select a string length.`;
    case "MBS-ADDRESS-DUP":
      return `${prefix}Modbus address already used by another active signal.`;
    case "MBS-BIT-DUP":
      return `${prefix}bit already used by another BitFields signal at the same address.`;
    case "MBS-ADDRESS-USED":
      return `${prefix}address inside the registers of a string signal.`;
    case "MBS-ADDRESS-RANGE":
      return `${prefix}Modbus address out of range (max ${MBS_DEFAULT_MAX_ADDRESS}).`;
    case "MBS-ADDRESS-BASE":
      return `${prefix}address 0 is not valid with 1-based registers.`;
  }
}

function mbsField(code: MbsObjectRuleCode): string {
  switch (code) {
    case "MBS-FORMAT-NONE":
      return "format";
    case "MBS-STRING-LEN":
      return "stringLength";
    case "MBS-BIT-DUP":
      return "bit";
    default:
      return "address";
  }
}
