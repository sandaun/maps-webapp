import "server-only";
import { XmlDocument } from "@/core/project-format";
import {
  addSignal as knxAddSignal,
  projectFromXml as knxFromXml,
  updateSignal as knxUpdateSignal,
} from "@/gateway-families/knx-mbm";
import {
  addSignal as meAddSignal,
  projectFromXml as meFromXml,
  updateSignal as meUpdateSignal,
} from "@/gateway-families/me-mbs";
import { parseGroupAddress } from "@/protocols/knx/address";
import { ProjectServiceError } from "../projects/errors";
import {
  expectedProtocols,
  parseSignalsXlsx,
  rowMap,
} from "../exports/xlsx-signals";
import {
  indexFromString,
  parseBoolCell,
  parseDeviceCell,
  parseDptCell,
  parseFlagCell,
  parseListening,
  parsePriorityCell,
} from "../exports/maps-grid-values";

export interface ImportXlsxResult {
  rows: number;
  appended: number;
  updated: number;
}

/**
 * Apply a MAPS Excel signal table like `AddObjectsFromExcel` /
 * `ManageRowFromDataGridView`: append ordinary rows; virtual rows (data
 * length `-`) update the matching virtual signal.
 */
export async function applySignalsXlsx(
  doc: XmlDocument,
  family: "knx-mbm" | "me-mbs",
  data: Uint8Array,
): Promise<ImportXlsxResult> {
  const parsed = await parseSignalsXlsx(data);
  const expected = expectedProtocols(family);
  if (
    (parsed.internalProtocol && parsed.internalProtocol !== expected.internal) ||
    (parsed.externalProtocol && parsed.externalProtocol !== expected.external)
  ) {
    throw new ProjectServiceError(
      422,
      `This Excel file is ${parsed.internalProtocol} ↔ ${parsed.externalProtocol}, not a ${expected.internal} ↔ ${expected.external} table.`,
    );
  }
  if (family === "knx-mbm") return applyKnx(doc, parsed.headers, parsed.rows);
  return applyMe(doc, parsed.headers, parsed.rows);
}

function applyKnx(doc: XmlDocument, headers: string[], rows: string[][]): ImportXlsxResult {
  let appended = 0;
  let updated = 0;
  for (const cells of rows) {
    const row = rowMap(headers, cells);
    const dataLength = (row["Data length"] ?? "").trim();
    const virtual = dataLength === "-";
    const project = knxFromXml(doc);
    const device = parseDeviceCell(project.mbm, row.Device ?? "");
    const sending = parseGroupAddress(row.Sending ?? "") ?? 0;
    const dpt = parseDptCell(row.DPT ?? "");
    const patch = {
      active: parseBoolCell(row.Active ?? "True"),
      description: row.Description ?? "",
      knx: {
        ...(dpt !== undefined ? { dpt } : {}),
        groupAddress: sending,
        additionalAddresses: parseListening(row.Listening ?? ""),
        flags: {
          u: parseFlagCell(row.U ?? "", "U"),
          t: parseFlagCell(row.T ?? "", "T"),
          ri: parseFlagCell(row.Ri ?? "", "Ri"),
          w: parseFlagCell(row.W ?? "", "W"),
          r: parseFlagCell(row.R ?? "", "R"),
        },
        priority: parsePriorityCell(row.Priority ?? ""),
      },
      modbus: {
        port: device.port,
        deviceIndex: device.deviceIndex,
        isBroadcast: device.isBroadcast,
        readFunc: indexFromString(row.Read ?? "-"),
        writeFunc: indexFromString(row.Write ?? "-"),
        lenBits: virtual ? -1 : indexFromString(row["Data length"] ?? "16"),
        format: indexFromString(row.Format ?? "-"),
        byteOrder: indexFromString(row["Byte order"] ?? "-"),
        address: virtual ? -1 : Number(row.Address || 0),
        bit: dashToNumber(row.Bit),
        numOfBits: dashToNumber(row["Bit length"]),
      },
      idxFilters: row.Filters ?? "",
      idxOperations: row.Operations ?? "",
    };

    if (virtual) {
      const match = project.signals.find(
        (s) => s.virtual && s.modbus.port === device.port && s.modbus.deviceIndex === device.deviceIndex,
      );
      if (match) {
        knxUpdateSignal(doc, match.id, {
          active: patch.active,
          description: patch.description,
          knx: patch.knx,
        });
        updated += 1;
        continue;
      }
    }
    const id = knxAddSignal(doc);
    knxUpdateSignal(doc, id, patch);
    appended += 1;
  }
  return { rows: rows.length, appended, updated };
}

function applyMe(doc: XmlDocument, headers: string[], rows: string[][]): ImportXlsxResult {
  let appended = 0;
  for (const cells of rows) {
    const row = rowMap(headers, cells);
    const id = meAddSignal(doc);
    meUpdateSignal(doc, id, {
      active: parseBoolCell(row.Active ?? "True"),
      description: row.Description ?? "",
      me: {
        g50Index: Number(row.Controller || 0),
        groupIndex: Number(row.Group || -1),
        unitId: Number(row.Unit || -1),
        signalSpecIndex: Number(row.Spec || 0),
        isStatus: parseBoolCell(row.Status ?? "False"),
      },
      modbus: {
        lenBits: indexFromString(row["Data length"] || "16"),
        format: indexFromString(row.Format ?? "0: Unsigned"),
        address: Number(row.Address || 0),
        bit: dashToNumber(row.Bit),
        readWrite: indexFromString(row["R/W"] ?? "0: Read") as 0 | 1 | 2,
        stringLength: dashToNumber(row["String length"]),
      },
    });
    appended += 1;
  }
  return { rows: rows.length, appended, updated: 0 };
}

function dashToNumber(raw: string | undefined): number {
  if (raw == null || raw.trim() === "" || raw.trim() === "-") return -1;
  const n = Number(raw);
  return Number.isFinite(n) ? n : -1;
}
