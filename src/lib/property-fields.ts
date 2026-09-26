import {
  formatPhysicalAddress,
  parsePhysicalAddress,
} from "@/protocols/knx/address";
import {
  CONVERSION_TYPE,
  conversionErrors,
  FILTER_DESCRIPTION_MAX,
  formatConversionNumber,
  isEditableConversionType,
  OPERATION_DESCRIPTION_MAX,
  parseConversionNumber,
  type ConversionField,
} from "@/core/conversions/rules";
import type { ProjectPatchInput, ProjectView } from "./project-types";
import { OPTION_LABELS, type OptionLabels } from "./property-option-labels";

export type PropertyScreen = "configuration" | "devices";
export type PropertyValue = string | number | boolean;
export interface PropertyField {
  id: string;
  group: string;
  key: string;
  label: string;
  screen: PropertyScreen;
  section: string;
  base: PropertyValue;
  immediate?: boolean;
  min?: number;
  max?: number;
  integer?: boolean;
  maxLength?: number;
  options?: readonly PropertyValue[];
  /** Display labels by option value (booleans as 0/1), as the select shows them. */
  optionLabels?: OptionLabels;
  address?: boolean;
  /**
   * Addressed by list position (KNX nodes/devices, ME slave list): another
   * session can replace the entity at that position without changing its
   * locator, so the draft store only trusts it while the revision is known.
   */
  positional?: boolean;
  /**
   * A number kept as text (conversion params): values compare by the text the
   * server writes for them, so "5.00" and "5" are the same value.
   */
  numericText?: boolean;
  /**
   * Rule across the fields of the same group (e.g. Low ≤ High of a filter).
   * `valueOf` reads a sibling's pending value (or its saved one) by key and
   * `edited` holds the keys with pending values.
   */
  check?: (valueOf: (key: string) => PropertyValue, edited: ReadonlySet<string>) => string | undefined;
  patch: (value: PropertyValue) => ProjectPatchInput;
}

type Rule = Partial<
  Pick<
    PropertyField,
    | "immediate"
    | "min"
    | "max"
    | "integer"
    | "maxLength"
    | "options"
    | "optionLabels"
    | "address"
  >
>;
const integer = (min = 0, max?: number): Rule => ({ integer: true, min, max });
const choices = (...options: PropertyValue[]): Rule => ({ options });
const labelled = (rule: Rule, optionLabels: OptionLabels): Rule => ({ ...rule, optionLabels });
const L = OPTION_LABELS;
const text = (maxLength = 128): Rule => ({ maxLength });
const toggle: Rule = { immediate: true };

/** Complete catalog, including fields on currently unmounted cards. */
export function propertyFields(view: ProjectView): PropertyField[] {
  const fields: PropertyField[] = [];
  const add = (
    group: string,
    section: string,
    screen: PropertyScreen,
    prefix: string,
    values: object,
    patch: (key: string, value: PropertyValue) => ProjectPatchInput,
    rows: [key: string, suffix: string, label: string, rule?: Rule][],
    positional?: boolean,
  ) => {
    for (const [key, suffix, label, rule] of rows) {
      const base = (values as Record<string, PropertyValue>)[key];
      fields.push({
        id: prefix + suffix,
        group,
        key,
        label,
        screen,
        section,
        base,
        positional,
        ...rule,
        patch: (value) => patch(key, value),
      });
    }
  };
  const config = "configuration";
  add(
    "general",
    "general",
    config,
    "cfg-",
    view.project,
    (key, value) => ({ type: "setGeneralInfo", [key]: value }),
    [
      ["name", "name", "Project name", text(32)],
      ["description", "desc", "Description", text(255)],
    ],
  );
  add(
    "gateway",
    "network",
    config,
    "cfg-gw-",
    view.project.gateway,
    (key, value) => ({ type: "setGatewayInfo", [key]: value }),
    [
      ["name", "name", "Gateway name", text(32)],
      ["ip", "ip", "IP address", text(45)],
      ["netmask", "netmask", "Subnet mask", text(45)],
      ["gateway", "gateway", "Default gateway", text(45)],
      ["dhcp", "dhcp", "DHCP", toggle],
    ],
  );
  if (view.family === "knx-mbm") {
    fields.push({
      id: "cfg-knx-address",
      group: "knx",
      key: "address",
      label: "Physical address",
      screen: config,
      section: "bms",
      base: formatPhysicalAddress(view.project.knx.physicalAddress),
      address: true,
      patch: (value) => ({
        type: "setKnxPhysicalAddress",
        address: parsePhysicalAddress(String(value))!,
      }),
    });
    fields.push({
      id: "cfg-knx-extended",
      group: "knx",
      key: "extendedAddresses",
      label: "Extended addresses",
      screen: config,
      section: "bms",
      base: view.project.knx.extendedAddresses,
      immediate: true,
      patch: (value) => ({
        type: "setKnxExtendedAddresses",
        enabled: Boolean(value),
      }),
    });
    const mbm = view.project.mbm;
    const pollKeys: Record<string, string> = {
      pollEnabled: "enabled",
      useMissingReg: "useMissingReg",
      maxRegisters: "maxRegisters",
    };
    add(
      "mbm",
      "device",
      config,
      "cfg-mbm-",
      {
        ...mbm,
        pollEnabled: mbm.pollRecords.enabled,
        useMissingReg: mbm.pollRecords.useMissingReg,
        maxRegisters: mbm.pollRecords.maxRegisters,
      },
      (key, value) => ({
        type: "updateMbmConfig",
        patch: pollKeys[key]
          ? { pollRecords: { [pollKeys[key]]: value } }
          : { [key]: value },
      }),
      [
        ["media", "media", "Connection type", labelled(choices(0, 1, 2), L.media)],
        [
          "deadband",
          "deadband",
          "Deadband to internal system",
          { min: 0, max: 1 },
        ],
        ["pollEnabled", "pollEnabled", "Polling records", toggle],
        ["useMissingReg", "useMissingReg", "Use missing registers", toggle],
        ["maxRegisters", "maxreg", "Maximum registers", integer(1, 255)],
      ],
    );
    for (const kind of ["rtu", "tcp"] as const) {
      const nodes = kind === "rtu" ? mbm.rtuNodes : mbm.tcpNodes;
      nodes.forEach((node, index) => {
        const group = `${kind}-${index}`;
        const context = `${kind.toUpperCase()} node ${index + 1}`;
        const rows: [string, string, string, Rule?][] =
          kind === "rtu"
            ? [
                ["baudrate", "baud", "Baudrate", integer(1200, 115200)],
                ["dataBits", "databits", "Data bits", integer(5, 8)],
                ["parity", "parity", "Parity", labelled(choices(0, 1, 2), L.parity)],
                ["stopBits", "stopbits", "Stop bits", choices(1, 2)],
                ["timeInterFrame", "tir", "Inter-frame", integer()],
                ["physicalPort", "port", "Physical port", labelled(choices(0, 1), L.physicalPort)],
                [
                  "pollAfterWrite",
                  "pollAfterWrite",
                  "Poll after write",
                  toggle,
                ],
                [
                  "pollReadSignal",
                  "pollReadSignal",
                  "Poll read signal",
                  toggle,
                ],
              ]
            : [
                ["description", "desc", "Description", text()],
                ["ip", "ip", "IP address", text(45)],
                ["port", "port", "Port", integer(1, 65535)],
                ["timeInterFrame", "tir", "Inter-frame", integer()],
                ["retryTimeout", "retry", "Retry timeout", integer()],
                ["connTimeout", "conn", "Connection timeout", integer()],
                ["rxTimeout", "rx", "RX timeout", integer()],
                [
                  "timeInterFrameSlaveChange",
                  "tirsc",
                  "Slave-change inter-frame",
                  integer(100),
                ],
              ];
        add(
          group,
          group,
          "devices",
          `${group}-`,
          node,
          (key, value) => ({
            type: kind === "rtu" ? "updateRtuNode" : "updateTcpNode",
            nodeIndex: index,
            patch: { [key]: value },
          }),
          rows.map(([key, suffix, label, rule]) => [
            key,
            suffix,
            `${context} · ${label}`,
            rule,
          ]),
          true,
        );
        // Devices are addressed by position, as the API and signal references do.
        node.devices.forEach((device, position) => {
          const deviceGroup = `${group}-device-${position}`;
          add(
            deviceGroup,
            group,
            "devices",
            `${deviceGroup}-`,
            device,
            (key, value) => ({
              type: "updateDevice",
              locator: { kind, nodeIndex: index },
              deviceIndex: position,
              patch: { [key]: value },
            }),
            [
              ["name", "name", "Name", text()],
              ["manufacturer", "manufacturer", "Manufacturer", text()],
              [
                "slave",
                "slave",
                "Slave",
                integer(kind === "rtu" ? 1 : 0, kind === "rtu" ? 254 : 255),
              ],
              ["baseRegister", "baseRegister", "Base register", labelled(choices(0, 1), L.registerBase)],
              ["timeout", "timeout", "Timeout", integer(100, 30000)],
              ["enabled", "enabled", "Enabled", toggle],
            ].map((row) => {
              const [key, suffix, label, rule] = row as [
                string,
                string,
                string,
                Rule,
              ];
              return [
                key,
                suffix,
                `${context} · Device ${position} · ${label}`,
                rule,
              ];
            }),
            true,
          );
        });
      });
    }
  } else {
    const { mbs, me } = view.project;
    add(
      "mbs",
      "bms",
      config,
      "cfg-mbs-",
      mbs,
      (key, value) => ({ type: "updateMbsConfig", patch: { [key]: value } }),
      [
        ["media", "media", "Media", labelled(choices(0, 1, 2), L.media)],
        ["addressMode", "addrmode", "Modbus addresses", labelled(choices(0, 1, 2), L.addressMode)],
        ["byteOrder", "byteorder", "Byte order", labelled(choices(0, 1, 2, 3), L.byteOrder)],
        ["registerBase", "regbase", "Register base", labelled(choices(0, 1), L.registerBase)],
        ["commErrorTout", "commerr", "Comm. error timeout", integer(0, 3600)],
        ["updateCOV", "updateCOV", "Update on change of value", toggle],
        ["slaveAddressMode", "slavemode", "Slave addressing", labelled(choices(0, 1), L.slaveAddressMode)],
      ],
    );
    add(
      "mbs",
      "bms",
      config,
      "cfg-mbs-",
      mbs.rtu,
      (key, value) => ({ type: "updateRtuConfig", patch: { [key]: value } }),
      [
        ["baudrate", "baud", "Baudrate", integer(1200, 115200)],
        ["dataBits", "databits", "Data bits", integer(5, 8)],
        ["parity", "parity", "Parity", labelled(choices(0, 1, 2), L.parity)],
        ["stopBits", "stopbits", "Stop bits", choices(1, 2)],
        ["slaveNumber", "slave", "Slave ID", integer(1, 247)],
      ],
    );
    add(
      "mbs",
      "bms",
      config,
      "cfg-mbs-",
      { tcpPort: mbs.tcp.port, keepAlive: mbs.tcp.keepAlive },
      (key, value) => ({
        type: "updateTcpConfig",
        patch: { [key === "tcpPort" ? "port" : key]: value },
      }),
      [
        ["tcpPort", "tcpport", "TCP port", integer(1, 65535)],
        ["keepAlive", "keepalive", "Keep alive", integer()],
      ],
    );
    mbs.slaves.forEach((slave, index) => {
      for (const key of ["address", "description"] as const) {
        fields.push({
          id: `cfg-mbs-slaves-${index}-${key}`,
          group: "mbs",
          key: `slaves.${index}.${key}`,
          label: `Slave ${index + 1} · ${key === "address" ? "Address" : "Description"}`,
          screen: config,
          section: "bms",
          base: slave[key],
          positional: true,
          ...(key === "address" ? integer(1, 247) : text()),
          patch: (value) => ({
            type: "updateMbsConfig",
            patch: {
              slaves: mbs.slaves.map((s, i) =>
                i === index ? { ...s, [key]: value } : { ...s },
              ),
            },
          }),
        });
      }
    });
    add(
      "me",
      "device",
      config,
      "cfg-me-",
      me,
      (key, value) => ({ type: "updateMeScalars", patch: { [key]: value } }),
      [
        ["temperatureMode", "tempMode", "Temperature units", labelled(choices(0, 1), L.temperatureMode)],
        ["pollPeriod", "pollPeriod", "Polling period", integer()],
        ["ansTimeout", "ansTimeout", "Answer timeout", integer()],
        [
          "controllerTout",
          "controllerTout",
          "Controller connection timeout",
          integer(),
        ],
        ["writeMaxBurst", "writeMaxBurst", "Write max burst", integer()],
        [
          "consumptionEnabled",
          "consumptionEnabled",
          "Consumption function",
          toggle,
        ],
      ],
    );
    me.controllers.forEach((controller) => {
      const group = `dev-cc-${controller.index}`;
      add(
        group,
        group,
        "devices",
        `${group}-`,
        controller,
        (key, value) => ({
          type: "updateController",
          controllerIndex: controller.index,
          patch: { [key]: value },
        }),
        [
          ["enabled", "enabled", "Enabled", toggle],
          ["description", "desc", "Description", text()],
          ["ip", "ip", "IP address", text(45)],
          ["port", "port", "Port", integer(1, 65535)],
          ["type", "type", "Type", labelled(choices(0, 1, 2, 3), L.controllerType)],
          ["model", "model", "Model", labelled(choices(0, 1, 2, 3), L.controllerModel)],
          ["compatibility", "compat", "Compatibility", labelled(choices(0, 1), L.compatibility)],
          ["addErrorSignals", "addErrorSignals", "Error signals", toggle],
        ].map((row) => {
          const [key, suffix, label, rule] = row as [
            string,
            string,
            string,
            Rule,
          ];
          return [
            key,
            suffix,
            `Controller ${controller.index + 1} · ${label}`,
            rule,
          ];
        }),
      );
      controller.groups.forEach((g) => {
        const group = `dev-g-${controller.index}-${g.index}`;
        add(
          group,
          group,
          "devices",
          `${group}-`,
          g,
          (key, value) => ({
            type: "updateGroup",
            controllerIndex: controller.index,
            groupIndex: g.index,
            patch: { [key]: value },
          }),
          [
            ["enabled", "enabled", "Integrated", toggle],
            ["description", "desc", "Description", text()],
            ["type", "type", "Unit type", labelled(choices(0, 1, 2, 3, 4, 5, 6), L.groupType)],
            ["fanSpeeds", "fans", "Num of fan speeds", choices(0, 2, 3, 4)],
            ["dualSetPoint", "setpoint", "Setpoint type", labelled(choices(false, true), L.dualSetPoint)],
            ["urc", "urc", "URC controller", labelled(choices(false, true), L.urc)],
            ["capacity", "capacity", "Capacity", integer(-1)],
          ].map((row) => {
            const [key, suffix, label, rule] = row as [
              string,
              string,
              string,
              Rule,
            ];
            return [
              key,
              suffix,
              `Controller ${controller.index + 1} · G${g.index + 1} · ${label}`,
              rule,
            ];
          }),
        );
      });
    });
  }
  if (view.family === "knx-mbm") fields.push(...conversionFields(view.project.conversions));
  return fields;
}

export const FILTER_TYPE_LABELS: OptionLabels = { "0": "Comparison", "1": "No-limit filter", "2": "Limited filter" };
export const FILTER_CONDITION_LABELS: OptionLabels = {
  "0": "Equal",
  "1": "Different",
  "2": "Less than",
  "3": "Greater than",
  "4": "In range",
  "5": "Out of range",
};
export const OPERATION_TYPE_LABELS: OptionLabels = { "1": "Scale", "2": "Arithmetic" };

/** What Param1…Param4 hold for this type (and filter comparison), as the editor labels them. */
export function conversionParamLabels(type: number, comparison: number): [string, string, string, string] {
  if (type === CONVERSION_TYPE.FILTER)
    return ["Filter type", "Condition", comparison === 4 || comparison === 5 ? "Low" : "Value", comparison === 2 ? "Value" : "High"];
  if (type === CONVERSION_TYPE.SCALE) return ["Input min", "Input max", "Output min", "Output max"];
  return ["A · exponent", "B · factor", "C · offset", "Param 4"];
}

/** Draft field id of a library entry: its list and position, as signals and the API address it. */
export const conversionFieldId = (list: "filters" | "operations", index: number, key: ConversionField) =>
  `cfg-conv-${list === "filters" ? "f" : "o"}-${index}-${key}`;

const CONVERSION_KEYS = ["description", "type", "param1", "param2", "param3", "param4"] as const;

/**
 * KNX–MBM conversion library: one positional group per filter, scale and
 * arithmetic operation (LUT remaps and logical operations are read-only).
 * The MAPS rules (`conversionErrors`) run across the group's fields, only for
 * the fields with pending values.
 */
function conversionFields(conversions: Extract<ProjectView, { family: "knx-mbm" }>["project"]["conversions"]): PropertyField[] {
  const fields: PropertyField[] = [];
  const positions = { filters: 0, operations: 0 };
  for (const conv of conversions) {
    const list = conv.type === CONVERSION_TYPE.FILTER ? "filters" : "operations";
    const index = positions[list]++;
    if (!isEditableConversionType(conv.type)) continue;
    const group = `conv-${list === "filters" ? "f" : "o"}-${index}`;
    const filter = list === "filters";
    const name = conv.description || (filter ? "Untitled filter" : "Untitled operation");
    const paramLabels = conversionParamLabels(conv.type, Number(conv.params[1]));
    const base: Record<(typeof CONVERSION_KEYS)[number], PropertyValue> = {
      description: conv.description,
      type: conv.type,
      param1: Number(conv.params[0]),
      param2: Number(conv.params[1]),
      param3: canonicalNumberText(conv.params[2]),
      param4: canonicalNumberText(conv.params[3]),
    };
    if (!filter) {
      base.param1 = canonicalNumberText(conv.params[0]);
      base.param2 = canonicalNumberText(conv.params[1]);
    }
    const numericKeys = new Set<string>(filter ? ["param3", "param4"] : ["param1", "param2", "param3", "param4"]);
    const check = (key: ConversionField) => (valueOf: (key: string) => PropertyValue, edited: ReadonlySet<string>) => {
      const values = {
        type: Number(valueOf("type")),
        description: String(valueOf("description")),
        params: [String(valueOf("param1")), String(valueOf("param2")), String(valueOf("param3")), String(valueOf("param4"))] as const,
      };
      const errors = conversionErrors(values, edited as ReadonlySet<ConversionField>);
      // A pending param must be a number even where the type or condition does not use it:
      // the patch carries it, and MAPS never stores anything else (its numeric boxes revert).
      if (!errors[key] && numericKeys.has(key) && edited.has(key) && parseConversionNumber(String(valueOf(key))) === undefined)
        return "Enter a number.";
      if (errors[key] || (key !== "type" && key !== "param2")) return errors[key];
      // A new type or comparison can break a value that has no pending edit: report it here.
      const [other, message] = Object.entries(errors).find(([field]) => !edited.has(field)) ?? [];
      if (!other) return undefined;
      const label = conversionParamLabels(values.type, Number(values.params[1]))[Number(other.at(-1)) - 1];
      return `${label ?? other}: ${message}`;
    };
    for (const key of CONVERSION_KEYS) {
      if (key === "type" && filter) continue;
      const rule: Rule =
        key === "description"
          ? text(filter ? FILTER_DESCRIPTION_MAX : OPERATION_DESCRIPTION_MAX)
          : key === "type"
            ? labelled(choices(1, 2), OPERATION_TYPE_LABELS)
            : filter && key === "param1"
              ? labelled(choices(0, 1, 2), FILTER_TYPE_LABELS)
              : filter && key === "param2"
                ? labelled(choices(0, 1, 2, 3, 4, 5), FILTER_CONDITION_LABELS)
                : {};
      const label = key === "description" ? "Description" : key === "type" ? "Operation type" : paramLabels[Number(key.at(-1)) - 1];
      fields.push({
        id: conversionFieldId(list, index, key),
        group,
        key,
        label: `${filter ? "Filter" : "Operation"} “${name}” · ${label}`,
        screen: "configuration",
        section: "conv",
        base: base[key],
        positional: true,
        numericText: numericKeys.has(key),
        ...rule,
        check: check(key),
        patch: (value) => ({
          type: "updateConversion",
          list,
          index,
          patch: {
            [key]:
              key === "description"
                ? String(value)
                : typeof value === "number"
                  ? value
                  : (parseConversionNumber(String(value)) ?? Number.NaN),
          },
        }),
      });
    }
  }
  return fields;
}

/** The text the server writes for a conversion param, or the text itself when it is not a number. */
function canonicalNumberText(value: string): string {
  const number = parseConversionNumber(value);
  return number === undefined ? value : formatConversionNumber(number);
}

export function fieldValue(
  field: PropertyField,
  raw: PropertyValue,
): PropertyValue {
  if (field.numericText) return canonicalNumberText(String(raw));
  if (typeof field.base === "number")
    return String(raw).trim() === "" ? NaN : Number(raw);
  if (typeof field.base === "boolean")
    return raw === true || raw === "true" || raw === "1" || raw === 1;
  return String(raw);
}

/** A value as the user sees it in the form (option labels, empty numbers). */
export function formatFieldValue(field: PropertyField, raw: PropertyValue): string {
  const value = fieldValue(field, raw);
  if (typeof value === "number" && Number.isNaN(value)) return "(empty)";
  if (field.optionLabels) {
    const label = field.optionLabels[String(typeof value === "boolean" ? Number(value) : value)];
    if (label !== undefined) return label;
  }
  if (typeof value === "boolean") return value ? "On" : "Off";
  return value === "" ? "(empty)" : String(value);
}

export function validateField(
  field: PropertyField,
  raw: PropertyValue,
  valueOf?: (key: string) => PropertyValue,
  edited?: ReadonlySet<string>,
): string | undefined {
  const own = validateOwnValue(field, raw);
  if (own || !field.check) return own;
  return field.check(
    (key) => (key === field.key ? raw : (valueOf?.(key) ?? "")),
    edited ?? new Set([field.key]),
  );
}

function validateOwnValue(field: PropertyField, raw: PropertyValue): string | undefined {
  const value = fieldValue(field, raw);
  if (field.address && parsePhysicalAddress(String(value)) === undefined)
    return "Expected area.line.device, e.g. 15.15.255.";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "Enter a number.";
    if (field.integer && !Number.isSafeInteger(value))
      return "Enter a whole number.";
    if (field.min !== undefined && value < field.min)
      return `Minimum value: ${field.min}.`;
    if (field.max !== undefined && value > field.max)
      return `Maximum value: ${field.max}.`;
  }
  if (field.maxLength !== undefined && String(value).length > field.maxLength)
    return `Maximum ${field.maxLength} characters.`;
  if (field.options && !field.options.includes(value))
    return "Choose a supported value.";
}

/** Merge leaf patches without resending stale siblings (including the slaves array). */
export function buildPropertyPatches(
  fields: PropertyField[],
  edits: Record<string, PropertyValue>,
  view: ProjectView,
): ProjectPatchInput[] {
  const merged = new Map<string, ProjectPatchInput>();
  let slaves: { address: number; description: string }[] | undefined;
  for (const field of fields) {
    if (!(field.id in edits)) continue;
    const value = fieldValue(field, edits[field.id]);
    if (field.key.startsWith("slaves.") && view.family === "me-mbs") {
      slaves ??= view.project.mbs.slaves.map((s) => ({ ...s }));
      const [, index, key] = field.key.split(".");
      slaves[Number(index)] = { ...slaves[Number(index)], [key]: value };
      continue;
    }
    const patch = field.patch(value);
    const { patch: leaf, ...target } = patch as ProjectPatchInput & {
      patch?: Record<string, unknown>;
    };
    const key = leaf ? JSON.stringify(target) : patch.type;
    const previous = merged.get(key);
    if (previous && "patch" in previous && leaf) {
      const combined = { ...previous.patch, ...leaf };
      if ("pollRecords" in previous.patch && "pollRecords" in leaf) {
        Object.assign(combined, {
          pollRecords: {
            ...previous.patch.pollRecords,
            ...(leaf.pollRecords as object),
          },
        });
      }
      merged.set(key, { ...target, patch: combined } as ProjectPatchInput);
    } else
      merged.set(
        key,
        previous ? ({ ...previous, ...patch } as ProjectPatchInput) : patch,
      );
  }
  if (slaves) {
    const previous = merged.get(JSON.stringify({ type: "updateMbsConfig" }));
    merged.set(JSON.stringify({ type: "updateMbsConfig" }), {
      type: "updateMbsConfig",
      patch: {
        ...(previous?.type === "updateMbsConfig" ? previous.patch : {}),
        slaves,
      },
    });
  }
  return [...merged.values()];
}
