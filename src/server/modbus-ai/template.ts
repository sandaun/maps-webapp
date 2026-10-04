import "server-only";
import { XmlDocument } from "@/core/project-format";
import { wordCount, type CandidateSignal } from "@/core/modbus-ai/model";
import {
  MAX_ACTIVE_SIGNALS,
  MAX_TOTAL_SIGNAL_ROWS,
} from "@/core/signals/model";
import { refsFromSelection } from "@/core/signals/conversion-refs";
import {
  addDevice,
  updateDevice,
  addSignal,
  removeSignal,
  updateSignal,
  addConversion,
} from "@/gateway-families/knx-mbm/xml-ops";
import { projectFromXml } from "@/gateway-families/knx-mbm/from-xml";
import { validateProject } from "@/gateway-families/knx-mbm/validate";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { exportDeviceTemplate } from "@/server/device-templates/export";
import { ProjectServiceError } from "@/server/projects/errors";

export function appendCandidateSignals(
  doc: XmlDocument,
  rows: CandidateSignal[],
  target: {
    kind: "rtu" | "tcp";
    nodeIndex: number;
    slave: number;
    name: string;
    manufacturer: string;
  },
) {
  const original = projectFromXml(doc);
  const node =
    target.kind === "rtu"
      ? original.mbm.rtuNodes[target.nodeIndex]
      : original.mbm.tcpNodes[target.nodeIndex];
  if (!node)
    throw new ProjectServiceError(422, "Choose an existing Modbus node.");
  let deviceIndex = node.devices.findIndex((d) => d.slave === target.slave);
  const base = deviceIndex < 0 ? 0 : node.devices[deviceIndex].baseRegister;
  const port =
    target.kind === "rtu"
      ? target.nodeIndex
      : original.mbm.rtuNodes.length + target.nodeIndex;
  const existing = new Set(
    original.signals
      .filter(
        (s) => s.modbus.port === port && s.modbus.deviceIndex === deviceIndex,
      )
      .map((s) => `${s.modbus.readFunc}:${s.modbus.address}:${s.modbus.bit}`),
  );
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.function}:${row.address + base}:${row.bit ?? -1}`;
    if (existing.has(key) || seen.has(key))
      throw new ProjectServiceError(
        409,
        `${row.name}: function/address/bit already exists. Review duplicates before import.`,
      );
    seen.add(key);
    if (row.address + base + wordCount(row) - 1 > 65535)
      throw new ProjectServiceError(
        422,
        "Address span exceeds this device's range after base conversion.",
      );
    if (!row.reviewed || (wordCount(row) > 1 && row.byteOrder === null))
      throw new ProjectServiceError(
        422,
        "Review the map and byte order before importing.",
      );
  }
  if (
    original.signals.length + rows.length > MAX_TOTAL_SIGNAL_ROWS ||
    original.signals.filter((s) => s.active).length + rows.length >
      MAX_ACTIVE_SIGNALS
  )
    throw new ProjectServiceError(
      422,
      "Selected map exceeds project capacity.",
    );
  if (deviceIndex < 0) {
    deviceIndex = addDevice(doc, target);
    updateDevice(
      doc,
      { ...target, deviceIndex },
      {
        slave: target.slave,
        name: target.name.slice(0, 128),
        manufacturer: target.manufacturer.slice(0, 128),
        enabled: true,
        baseRegister: 0,
      },
    );
  }
  const usedGA = new Set(original.signals.map((s) => s.knx.groupAddress));
  let ga = 1;
  const added: number[] = [];
  for (const row of rows) {
    while (usedGA.has(ga)) ga++;
    if (ga > 0x7fff)
      throw new ProjectServiceError(
        422,
        "No free KNX group address available.",
      );
    usedGA.add(ga);
    const bit = row.function <= 2;
    const bitfield = !bit && row.bit !== null;
    const scaled = (row.scale ?? 1) !== 1 || (row.offset ?? 0) !== 0;
    const dpt =
      bit || bitfield
        ? 0x0101
        : row.unit === "°C"
          ? 0x0901
          : scaled || /float|32|64/.test(row.dataType)
            ? 0x0e00
            : row.dataType === "int16"
              ? 0x0801
              : 0x0701;
    const signalId = addSignal(doc);
    added.push(signalId);
    updateSignal(doc, signalId, {
      active: row.access !== "W" && row.access !== "Trigger",
      description: row.name.slice(0, 128),
      knx: {
        dpt,
        groupAddress: ga,
        additionalAddresses: [],
        flags: { r: true, t: false, ri: false, w: false, u: false },
      },
      modbus: {
        port,
        deviceIndex,
        isBroadcast: false,
        readFunc: row.function,
        writeFunc: -1,
        lenBits: bit ? 1 : wordCount(row) * 16,
        format: bit
          ? -1
          : bitfield
            ? 4
            : /float/.test(row.dataType)
              ? 3
              : /^int/.test(row.dataType)
                ? 1
                : 0,
        byteOrder: bit
          ? -1
          : wordCount(row) === 1
            ? ["BADC", "DCBA"].includes(row.byteOrder ?? "ABCD")
              ? 1
              : 0
            : ({ ABCD: 0, DCBA: 1, CDAB: 2, BADC: 3 } as const)[
                row.byteOrder ?? "ABCD"
              ],
        bit: bitfield ? row.bit! : -1,
        numOfBits: bitfield ? 1 : -1,
        address: row.address + base,
        deadband: 0,
      },
    });
    if (scaled && !bit && !bitfield) {
      // MAPS ARITH: (input + Param1) * Param2 + Param3. Assign once in the
      // Modbus → KNX read flow; never pre-scale raw registers or apply twice.
      const operation = addConversion(doc, 2, {
        description:
          `AI map scale ${row.scale ?? 1} offset ${row.offset ?? 0}`.slice(
            0,
            64,
          ),
        params: [0, row.scale ?? 1, row.offset ?? 0, 0],
      });
      updateSignal(doc, signalId, {
        conversionRefs: refsFromSelection(
          {
            internalFilter: null,
            operations: [operation],
            externalFilter: null,
            master: "external",
          },
          "read",
        ),
      });
    }
  }
  const issues = validateProject(projectFromXml(doc)).filter(
    (issue) =>
      issue.severity === "error" &&
      issue.ref?.id !== undefined &&
      added.includes(Number(issue.ref.id)),
  );
  if (issues.length)
    throw new ProjectServiceError(
      422,
      issues.map((issue) => issue.message).join("; "),
    );
  return { deviceIndex, signalIds: added };
}

/** The existing MAPS writer/encryption exports the new map as a native template. */
export function candidateTemplate(
  rows: CandidateSignal[],
  name: string,
  manufacturer: string,
) {
  const doc = XmlDocument.parse(SYNTHETIC_KNX_MBM_XML);
  for (const row of [...projectFromXml(doc).signals].reverse())
    removeSignal(doc, row.id);
  const target = {
    kind: "rtu" as const,
    nodeIndex: 0,
    slave: 247,
    name: name || "PDF device",
    manufacturer,
  };
  const { deviceIndex } = appendCandidateSignals(doc, rows, target);
  return exportDeviceTemplate(doc, { ...target, deviceIndex });
}
