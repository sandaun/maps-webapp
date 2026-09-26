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
import { halfSteps, libraryLists } from "@/core/conversions/assignment";
import { conversionHasInverse, conversionSummary } from "@/core/conversions/formulas";
import { COMPARISON, CONVERSION_TYPE, parseConversionNumber } from "@/core/conversions/rules";
import { knxConversionRwMode } from "./conversions";
import type { KnxMbmProject, KnxMbmSignal } from "./model";

/**
 * KNX–MBM project validation. Codes are stable and documented in
 * docs/plans/knx-mbm-mvp.md §5. Errors block save/deploy; warnings do not.
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
  validateConversions(project, issues);
  return issues;
}

/**
 * Conversion library and per-signal refs. Refs are positions in the filters /
 * operations lists (`IntesisConversion.cs:233-247`); the XBL generator reads
 * `filters[index]` for each of them (`CreateConversionList`), so a position
 * outside the list cannot be deployed.
 */
function validateConversions(project: KnxMbmProject, issues: ValidationIssue[]): void {
  const library = libraryLists(project.conversions);
  const name = (conv: { description: string; type: number }) =>
    conv.description || (conv.type === CONVERSION_TYPE.FILTER ? "Untitled filter" : "Untitled operation");
  const libraryRef = (list: "filters" | "operations", index: number) => ({
    screen: "configuration" as const,
    entity: "project" as const,
    id: `${list === "filters" ? "f" : "o"}${index}`,
    field: "conversion",
  });

  for (const signal of project.signals) {
    const halves = [signal.conversions.internal, signal.conversions.external];
    const steps = halves.flatMap((half) => halfSteps(half));
    if (steps.length === 0) continue;
    const signalRef = { screen: "signals" as const, entity: "signal" as const, id: signal.id, field: "conversions" };
    const missing = [
      ...new Set(
        steps
          .filter((step) => !library[step.list][step.index])
          .map((step) => `${step.list === "filters" ? "filter" : "operation"} ${step.index}`),
      ),
    ];
    if (missing.length) {
      issues.push({
        code: "CONV-REF-MISSING",
        // Only active signals reach the XBL (PreXBLActions): an inactive one does not block the deploy.
        severity: signal.active ? "error" : "warning",
        message: `Signal ${signal.id + 1} uses ${missing.join(" and ")}, which ${missing.length === 1 ? "is" : "are"} not in the conversion library.`,
        ref: signalRef,
      });
    }
    if (signal.virtual) {
      // MAPS makes the cell of virtual signals read-only (IntesisProjectKnxMbm_RT.cs:709-712):
      // only an imported file can put conversions there. No "conversions" field: the
      // editor cannot open for them, so the issue leads to the signal row.
      issues.push({
        code: "CONV-VIRTUAL",
        severity: "info",
        message: `Virtual signal ${signal.id + 1} has conversions. MAPS does not let you assign conversions to virtual signals; they come from an imported file.`,
        ref: { screen: "signals", entity: "signal", id: signal.id },
      });
      continue;
    }
    // The grey flow of a read + write signal runs its operations inverted: an arithmetic
    // operation with B · 10^A = 0 or a scale with equal output ends divides by zero there.
    if (knxConversionRwMode(signal.knx.flags) === "readwrite") {
      const broken = steps.find((step) => {
        const conv = library[step.list][step.index];
        return step.inverted && !!conv && !conversionHasInverse(conv);
      });
      if (broken) {
        const conv = library.operations[broken.index];
        issues.push({
          code: "CONV-NO-INVERSE",
          severity: "warning",
          message: `Signal ${signal.id + 1} runs “${name(conv)}” (${conversionSummary(conv)}) inverted, but it has no inverse: the gateway cannot convert one of its directions.`,
          ref: signalRef,
        });
      }
    }
  }

  // Ranges MAPS does not let you save (frmConversions.cs:726-766), and equal scale ends.
  library.filters.forEach((conv, index) => {
    const comparison = parseConversionNumber(conv.params[1]);
    if (comparison !== COMPARISON.IN_RANGE && comparison !== COMPARISON.OUT_RANGE) return;
    const low = parseConversionNumber(conv.params[2]);
    const high = parseConversionNumber(conv.params[3]);
    if (low !== undefined && high !== undefined && low > high) {
      issues.push({
        code: "CONV-RANGE",
        severity: "warning",
        message: `Filter “${name(conv)}” has Low (${low}) greater than High (${high}).`,
        ref: libraryRef("filters", index),
      });
    }
  });
  library.operations.forEach((conv, index) => {
    if (conv.type !== CONVERSION_TYPE.SCALE) return;
    const [minIn, maxIn, minOut, maxOut] = conv.params.map(parseConversionNumber);
    const bad = (min?: number, max?: number) => min !== undefined && max !== undefined && min >= max;
    if (bad(minIn, maxIn) || bad(minOut, maxOut)) {
      issues.push({
        code: "CONV-RANGE",
        severity: "warning",
        message: `Scale “${name(conv)}” (${conversionSummary(conv)}) needs each min below its max.`,
        ref: libraryRef("operations", index),
      });
    }
  });
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
  checkIndexPositions(project.mbm, issues);
}

/**
 * MAPS keeps each device `Index` (and TCP `NodeIndex`) equal to its position,
 * and signals reference devices by position. Imported files that break this
 * are reported rather than silently rewritten.
 */
function checkIndexPositions(mbm: MbmConfig, issues: ValidationIssue[]): void {
  mbm.tcpNodes.forEach((node, position) => {
    if (node.nodeIndex !== position) {
      issues.push({
        code: "MB-NODE-INDEX",
        severity: "warning",
        message: `TCP node ${position} has NodeIndex ${node.nodeIndex}; MAPS expects it to match the node position.`,
        ref: { screen: "devices", entity: "project" },
      });
    }
  });
  for (const kind of ["rtu", "tcp"] as const) {
    (kind === "rtu" ? mbm.rtuNodes : mbm.tcpNodes).forEach((node, nodeIndex) => {
      node.devices.forEach((device, position) => {
        if (device.index !== position) {
          issues.push({
            code: "MB-DEVICE-INDEX",
            severity: "warning",
            message: `Device "${device.name}" on ${kind.toUpperCase()} node ${nodeIndex} has Index ${device.index} but is at position ${position}; signals reference devices by position.`,
            ref: { screen: "devices", entity: "device", id: `${kind}:${nodeIndex}:${position}` },
          });
        }
      });
    });
  }
}

function checkSlaveUniqueness(
  nodes: Array<{ devices: Array<{ slave: number; name: string }> }>,
  kind: "rtu" | "tcp",
  issues: ValidationIssue[],
): void {
  const range = kind === "rtu" ? SLAVE_RANGE_RTU : SLAVE_RANGE_TCP;
  nodes.forEach((node, nodeIndex) => {
    const seen = new Map<number, number>();
    for (const [position, device] of node.devices.entries()) {
      if (device.slave < range.min || device.slave > range.max) {
        issues.push({
          code: "MB-SLAVE-RANGE",
          severity: "error",
          message: `Slave id ${device.slave} out of range (${range.min}–${range.max}) on ${kind.toUpperCase()} node ${nodeIndex}.`,
          ref: { screen: "devices", entity: "device", id: `${kind}:${nodeIndex}:${position}`, field: "slave" },
        });
      }
      const first = seen.get(device.slave);
      if (first !== undefined) {
        issues.push({
          code: "MB-SLAVE-DUP",
          severity: "error",
          message: `Slave id ${device.slave} is used by both device ${first} and device ${position} on ${kind.toUpperCase()} node ${nodeIndex}.`,
          ref: { screen: "devices", entity: "device", id: `${kind}:${nodeIndex}:${position}`, field: "slave" },
        });
      } else {
        seen.set(device.slave, position);
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

  // Modbus side: device reference + per-signal rules.
  // Virtual signals (e.g. the gateway-generated "Comm Error" status) have no
  // Modbus endpoint by design — readFunc/writeFunc/address stay unset (-1) in
  // real projects downloaded from a gateway — so all Modbus checks are skipped.
  if (signal.virtual) return;

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
