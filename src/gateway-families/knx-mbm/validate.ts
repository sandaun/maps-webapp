import { hasAnyFlag, isValidDpt, isValidGroupAddress } from "@/protocols/knx";
import {
  checkMbmSignal,
  isReadFunction,
  isWriteFunction,
  MEDIA,
  nodeForPort,
  SLAVE_RANGE_RTU,
  SLAVE_RANGE_TCP,
  type MbmConfig,
} from "@/protocols/modbus/master";
import {
  MAX_ACTIVE_SIGNALS,
  MAX_TOTAL_SIGNAL_ROWS,
} from "@/core/signals/model";
import type { ValidationIssue } from "@/core/validation/issue";
import type { KnxMbmProject, KnxMbmSignal } from "./model";

/**
 * KNX–MBM project validation. Codes are stable and documented in
 * docs/knx-mbm-mvp.md §5. Errors block save/deploy; warnings do not.
 */
export function validateProject(project: KnxMbmProject): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  validateKnxConfig(project, issues);
  validateLimits(project, issues);
  validateDeviceTopology(project, issues);
  for (const signal of project.signals) {
    validateSignal(project, signal, issues);
  }
  validateCrossFlags(project, issues);
  validateRegisterOverlaps(project, issues);
  return issues;
}

function validateKnxConfig(project: KnxMbmProject, issues: ValidationIssue[]): void {
  const pa = project.knx.physicalAddress;
  if (pa < 0 || pa > 65535 || pa === 0) {
    issues.push({
      code: "KNX-PA-FORMAT",
      severity: "error",
      message: `Invalid KNX physical address value ${pa}.`,
      ref: { screen: "configuration", entity: "project", field: "physicalAddress" },
    });
  }
}

function validateLimits(project: KnxMbmProject, issues: ValidationIssue[]): void {
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

function validateDeviceTopology(project: KnxMbmProject, issues: ValidationIssue[]): void {
  if (project.mbm.rtuNodes.length > 2) {
    issues.push({
      code: "MB-NODE-LIMIT",
      severity: "error",
      message: "At most 2 RTU nodes are supported.",
      ref: { screen: "devices", entity: "project" },
    });
  }
  if (project.mbm.tcpNodes.length > 5) {
    issues.push({
      code: "MB-NODE-LIMIT",
      severity: "error",
      message: "At most 5 TCP nodes are supported.",
      ref: { screen: "devices", entity: "project" },
    });
  }
  checkSlaveUniqueness(project.mbm.rtuNodes, "rtu", issues);
  checkSlaveUniqueness(project.mbm.tcpNodes, "tcp", issues);
}

function checkSlaveUniqueness(
  nodes: Array<{ devices: Array<{ slave: number; name: string; index: number }> }>,
  kind: "rtu" | "tcp",
  issues: ValidationIssue[],
): void {
  const range = kind === "rtu" ? SLAVE_RANGE_RTU : SLAVE_RANGE_TCP;
  nodes.forEach((node, nodeIndex) => {
    const seen = new Map<number, number>();
    for (const device of node.devices) {
      if (device.slave < range.min || device.slave > range.max) {
        issues.push({
          code: "MB-SLAVE-RANGE",
          severity: "error",
          message: `Slave id ${device.slave} out of range (${range.min}–${range.max}) on ${kind.toUpperCase()} node ${nodeIndex}.`,
          ref: { screen: "devices", entity: "device", id: `${kind}:${nodeIndex}:${device.index}`, field: "slave" },
        });
      }
      const first = seen.get(device.slave);
      if (first !== undefined) {
        issues.push({
          code: "MB-SLAVE-DUP",
          severity: "error",
          message: `Slave id ${device.slave} is used by both device ${first} and device ${device.index} on ${kind.toUpperCase()} node ${nodeIndex}.`,
          ref: { screen: "devices", entity: "device", id: `${kind}:${nodeIndex}:${device.index}`, field: "slave" },
        });
      } else {
        seen.set(device.slave, device.index);
      }
    }
  });
}

function validateSignal(
  project: KnxMbmProject,
  signal: KnxMbmSignal,
  issues: ValidationIssue[],
): void {
  const ref = { screen: "signals" as const, entity: "signal" as const, id: signal.id };

  // KNX side
  if (!isValidGroupAddress(signal.knx.groupAddress, { extended: project.knx.extendedAddresses })) {
    const extended = project.knx.extendedAddresses;
    issues.push({
      code: signal.knx.groupAddress > 32767 && !extended ? "KNX-GA-EXTENDED" : "KNX-GA-FORMAT",
      severity: "error",
      message:
        signal.knx.groupAddress > 32767 && !extended
          ? `Signal #${signal.id}: group address exceeds 15/7/255; enable extended addresses.`
          : `Signal #${signal.id}: invalid KNX group address.`,
      ref: { ...ref, field: "groupAddress" },
    });
  }
  if (!isValidDpt(signal.knx.dpt)) {
    issues.push({
      code: "KNX-DPT-INVALID",
      severity: "error",
      message: `Signal #${signal.id}: DPT is not in the supported KNX–MBM selection.`,
      ref: { ...ref, field: "dpt" },
    });
  }
  if (!hasAnyFlag(signal.knx.flags)) {
    issues.push({
      code: "KNX-FLAGS-NONE",
      severity: "error",
      message: `Signal #${signal.id}: at least one KNX flag (U, T, Ri, W, R) is required.`,
      ref: { ...ref, field: "flags" },
    });
  }
  if (signal.knx.flags.ri && signal.knx.flags.r) {
    issues.push({
      code: "KNX-FLAGS-RI-R",
      severity: "error",
      message: `Signal #${signal.id}: flags Ri and R are mutually exclusive.`,
      ref: { ...ref, field: "flags" },
    });
  }
  if (signal.knx.additionalAddresses.length > 0 && !signal.knx.flags.u && !signal.knx.flags.w) {
    issues.push({
      code: "KNX-FLAGS-LISTEN",
      severity: "error",
      message: `Signal #${signal.id}: additional addresses require the U or W flag.`,
      ref: { ...ref, field: "flags" },
    });
  }

  // Modbus side: device reference + per-signal rules
  const node = signal.modbus.port >= 0 ? nodeForPort(project.mbm, signal.modbus.port) : undefined;
  const device =
    node && signal.modbus.deviceIndex >= 0 ? node.node.devices[signal.modbus.deviceIndex] : undefined;

  if (!signal.modbus.isBroadcast) {
    if (signal.modbus.port < 0 || !node) {
      issues.push({
        code: "SIG-DEVICE-REF",
        severity: "error",
        message: `Signal #${signal.id}: references a Modbus port/node that does not exist.`,
        ref: { ...ref, field: "device" },
      });
    } else if (signal.modbus.deviceIndex < 0 || !device) {
      issues.push({
        code: "SIG-DEVICE-REF",
        severity: "error",
        message: `Signal #${signal.id}: references a Modbus device that does not exist.`,
        ref: { ...ref, field: "device" },
      });
    }
  }

  if (node) {
    const isRtuPort = node.kind === "rtu";
    if (
      (project.mbm.media === MEDIA.TCP && isRtuPort) ||
      (project.mbm.media === MEDIA.RTU && !isRtuPort)
    ) {
      issues.push({
        code: "MB-MEDIA",
        severity: "error",
        message: `Signal #${signal.id}: uses a ${node.kind.toUpperCase()} port but the gateway is configured for ${project.mbm.media === MEDIA.TCP ? "TCP" : "RTU"} only.`,
        ref: { ...ref, field: "device" },
      });
    }
  }

  const codes = checkMbmSignal({
    isBroadcast: signal.modbus.isBroadcast,
    readFunc: signal.modbus.readFunc,
    writeFunc: signal.modbus.writeFunc,
    lenBits: signal.modbus.lenBits,
    format: signal.modbus.format,
    byteOrder: signal.modbus.byteOrder,
    bit: signal.modbus.bit,
    numOfBits: signal.modbus.numOfBits,
    address: signal.modbus.address,
    deviceBase: device?.baseRegister ?? null,
  });
  for (const code of codes) {
    issues.push({
      code,
      severity: "error",
      message: mbmMessage(code, signal),
      ref: { ...ref, field: mbmField(code) },
    });
  }
}

function validateCrossFlags(project: KnxMbmProject, issues: ValidationIssue[]): void {
  for (const signal of project.signals) {
    const { flags } = signal.knx;
    if (isReadFunction(signal.modbus.readFunc) && !flags.r && !flags.t) {
      issues.push({
        code: "XFLAG-RT-READ",
        severity: "warning",
        message: `Signal #${signal.id}: Modbus read function set but the KNX side has neither R nor T.`,
        ref: { screen: "signals", entity: "signal", id: signal.id, field: "flags" },
      });
    }
    if (isWriteFunction(signal.modbus.writeFunc) && !flags.w && !flags.u) {
      issues.push({
        code: "XFLAG-WU-WRITE",
        severity: "warning",
        message: `Signal #${signal.id}: Modbus write function set but the KNX side has neither W nor U.`,
        ref: { screen: "signals", entity: "signal", id: signal.id, field: "flags" },
      });
    }
  }
}

/**
 * Register overlap: the desktop tool does not reject overlaps (it merges them
 * into poll records), so this is an informational warning, not an error.
 */
function validateRegisterOverlaps(project: KnxMbmProject, issues: ValidationIssue[]): void {
  const ranges = new Map<string, Array<{ start: number; end: number; id: number }>>();
  for (const signal of project.signals) {
    if (!signal.active || !isReadFunction(signal.modbus.readFunc)) continue;
    const span = Math.max(1, Math.ceil(signal.modbus.lenBits / 16));
    const key = `${signal.modbus.port}:${signal.modbus.deviceIndex}:${signal.modbus.readFunc}`;
    const list = ranges.get(key) ?? [];
    for (const other of list) {
      const end = signal.modbus.address + span - 1;
      if (signal.modbus.address <= other.end && other.start <= end) {
        issues.push({
          code: "MB-REG-OVERLAP",
          severity: "warning",
          message: `Signals #${other.id} and #${signal.id} read overlapping register ranges on the same device.`,
          ref: { screen: "signals", entity: "signal", id: signal.id, field: "address" },
        });
      }
    }
    list.push({ start: signal.modbus.address, end: signal.modbus.address + span - 1, id: signal.id });
    ranges.set(key, list);
  }
}

function mbmMessage(code: string, signal: KnxMbmSignal): string {
  const prefix = `Signal #${signal.id}: `;
  switch (code) {
    case "MB-BROADCAST":
      return `${prefix}broadcast signals must not have a read function or BitFields format.`;
    case "MB-FUNC-PAIR":
      return `${prefix}incompatible read/write function pair (or both unset).`;
    case "MB-LEN-FORMAT":
      return `${prefix}data length is incompatible with the selected functions/format/byte order.`;
    case "MB-BIT-RANGE":
      return `${prefix}bit/number-of-bits out of range for the data length.`;
    case "MB-ADDRESS-RANGE":
      return `${prefix}Modbus address out of range (0–65535).`;
    case "MB-ADDRESS-BASE":
      return `${prefix}address 0 is invalid for a 1-based device.`;
    default:
      return `${prefix}${code}`;
  }
}

function mbmField(code: string): string {
  switch (code) {
    case "MB-FUNC-PAIR":
      return "readFunc";
    case "MB-LEN-FORMAT":
      return "lenBits";
    case "MB-BIT-RANGE":
      return "bit";
    case "MB-ADDRESS-RANGE":
    case "MB-ADDRESS-BASE":
      return "address";
    default:
      return "device";
  }
}

// Re-export for consumers that only need the config type.
export type { MbmConfig };
