import {
  formatPhysicalAddress,
  parsePhysicalAddress,
} from "@/protocols/knx/address";
import type { ProjectPatchInput, ProjectView } from "./project-types";

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
  address?: boolean;
  /** KNX nodes have positional API locators, so recovery must verify the entity. */
  anchor?: string;
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
    | "address"
  >
>;
const integer = (min = 0, max?: number): Rule => ({ integer: true, min, max });
const choices = (...options: PropertyValue[]): Rule => ({ options });
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
    anchor?: string,
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
        anchor,
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
        ["media", "media", "Connection type", choices(0, 1, 2)],
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
        // Changes made by this client rebase anchors after successful mutations.
        // On recovery, an externally changed positional entity requires review.
        const anchor = JSON.stringify(node);
        const rows: [string, string, string, Rule?][] =
          kind === "rtu"
            ? [
                ["baudrate", "baud", "Baudrate", integer(1200, 115200)],
                ["dataBits", "databits", "Data bits", integer(5, 8)],
                ["parity", "parity", "Parity", choices(0, 1, 2)],
                ["stopBits", "stopbits", "Stop bits", choices(1, 2)],
                ["timeInterFrame", "tir", "Inter-frame", integer()],
                ["physicalPort", "port", "Physical port", choices(0, 1)],
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
          anchor,
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
              ["baseRegister", "baseRegister", "Base register", choices(0, 1)],
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
            anchor,
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
        ["media", "media", "Media", choices(0, 1, 2)],
        ["addressMode", "addrmode", "Modbus addresses", choices(0, 1, 2)],
        ["byteOrder", "byteorder", "Byte order", choices(0, 1, 2, 3)],
        ["registerBase", "regbase", "Register base", choices(0, 1)],
        ["commErrorTout", "commerr", "Comm. error timeout", integer(0, 3600)],
        ["updateCOV", "updateCOV", "Update on change of value", toggle],
        ["slaveAddressMode", "slavemode", "Slave addressing", choices(0, 1)],
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
        ["parity", "parity", "Parity", choices(0, 1, 2)],
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
        ["temperatureMode", "tempMode", "Temperature units", choices(0, 1)],
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
          ["type", "type", "Type", choices(0, 1, 2, 3)],
          ["model", "model", "Model", choices(0, 1, 2, 3)],
          ["compatibility", "compat", "Compatibility", choices(0, 1)],
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
            ["type", "type", "Unit type", choices(0, 1, 2, 3, 4, 5, 6)],
            ["fanSpeeds", "fans", "Num of fan speeds", choices(0, 2, 3, 4)],
            ["dualSetPoint", "setpoint", "Setpoint type", choices(false, true)],
            ["urc", "urc", "URC controller", choices(false, true)],
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
  return fields;
}

export function fieldValue(
  field: PropertyField,
  raw: PropertyValue,
): PropertyValue {
  if (typeof field.base === "number")
    return String(raw).trim() === "" ? NaN : Number(raw);
  if (typeof field.base === "boolean")
    return raw === true || raw === "true" || raw === "1" || raw === 1;
  return String(raw);
}

export function validateField(
  field: PropertyField,
  raw: PropertyValue,
): string | undefined {
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
