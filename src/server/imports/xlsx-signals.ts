import "server-only";
import { XmlDocument } from "@/core/project-format";
import {
  addSignal as knxAddSignal,
  projectFromXml as knxFromXml,
  setConversions as setKnxConversions,
  updateSignal as knxUpdateSignal,
} from "@/gateway-families/knx-mbm";
import {
  addSignal as meAddSignal,
  projectFromXml as meFromXml,
  updateSignal as meUpdateSignal,
} from "@/gateway-families/me-mbs";
import { groupAddressLevelOf, parseGroupAddress } from "@/protocols/knx/address";
import { ProjectServiceError } from "../projects/errors";
import {
  expectedProtocols,
  parseSignalsXlsx,
  rowMap,
  type ParsedSignalsSheet,
  type SignalsXlsxFamily,
} from "../exports/xlsx-signals";
import { importedConversions } from "./xlsx-conversions";
import { applyMbsKnxXlsx } from "./xlsx-mbs-knx";
import {
  indexFromString,
  parseBoolCell,
  parseDeviceCell,
  parseDptCell,
  parseFlagCell,
  KNX_SIGNAL_HEADERS,
  ME_SIGNAL_HEADERS,
  parseListening,
  parsePriorityCell,
} from "../exports/maps-grid-values";

/** MAPS `frmImport`: "Add signals" (`ImportExcelMode.ADD`) or "Replace signals" (`REPLACE`). */
export type ImportMode = "add" | "replace";

export interface ImportXlsxResult {
  rows: number;
  appended: number;
  updated: number;
  /** Signals removed first by a "Replace signals" import. */
  removed?: number;
  /** B3 of the file: the MAPS version that wrote it. */
  fileVersion?: string;
}

/**
 * Apply a MAPS Excel signal table like `AddObjectsFromExcel` /
 * `ManageRowFromDataGridView`: append ordinary rows; in KNX–MBM, virtual rows
 * (data length `-`) update the matching virtual signal. MBS–KNX: `xlsx-mbs-knx.ts`.
 */
export async function applySignalsXlsx(
  doc: XmlDocument,
  family: SignalsXlsxFamily,
  data: Uint8Array,
  mode: ImportMode = "add",
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
  return { ...applyFamily(doc, family, parsed, mode), fileVersion: parsed.version };
}

function applyFamily(
  doc: XmlDocument,
  family: SignalsXlsxFamily,
  parsed: ParsedSignalsSheet,
  mode: ImportMode,
): ImportXlsxResult {
  if (family === "mbs-knx") return applyMbsKnxXlsx(doc, parsed, mode);
  if (mode === "replace") {
    throw new ProjectServiceError(422, '"Replace signals" is not available yet for this kind of project.');
  }
  requireHeaders(parsed, family === "knx-mbm" ? KNX_SIGNAL_HEADERS : ME_SIGNAL_HEADERS);
  if (family === "knx-mbm") return applyKnx(doc, parsed);
  return applyMe(doc, parsed.headers, parsed.rows);
}

/**
 * KNX–MBM and ME–MBS read the columns by our header names, so a table with
 * other names (one exported by MAPS desktop: "Group Address", "Read Func"…)
 * would import default values. Such a table is rejected instead.
 */
function requireHeaders(parsed: ParsedSignalsSheet, expected: readonly string[]): void {
  const missing = expected.filter(
    (header) => header !== "Conv. Id" && header !== "Conversions" && !parsed.headers.includes(header),
  );
  if (missing.length === 0) return;
  throw new ProjectServiceError(
    422,
    `This Excel file does not have the columns ${missing.map((h) => `"${h}"`).join(", ")}. ` +
      "Tables exported by MAPS desktop cannot be imported yet for this kind of project.",
  );
}

function applyKnx(doc: XmlDocument, parsed: ParsedSignalsSheet): ImportXlsxResult {
  const { headers, rows } = parsed;
  // Validated before touching the document, so a rejected import changes nothing.
  const conversions = importedConversions(knxFromXml(doc), parsed);
  if (conversions) setKnxConversions(doc, conversions.list);
  let appended = 0;
  let updated = 0;
  for (const [i, cells] of rows.entries()) {
    const row = rowMap(headers, cells);
    const dataLength = (row["Data length"] ?? "").trim();
    const virtual = dataLength === "-";
    const project = knxFromXml(doc);
    const device = parseDeviceCell(project.mbm, row.Device ?? "");
    const sendingText = (row.Sending ?? "").trim();
    const sending = parseGroupAddress(sendingText) ?? 0;
    const listening = parseListening(row.Listening ?? "");
    const dpt = parseDptCell(row.DPT ?? "");
    const patch = {
      active: parseBoolCell(row.Active ?? "True"),
      description: row.Description ?? "",
      knx: {
        ...(dpt !== undefined ? { dpt } : {}),
        groupAddress: sending,
        ...(sending > 0 ? { groupAddressLevel: groupAddressLevelOf(sendingText) } : {}),
        additionalAddresses: listening.addresses,
        additionalAddressLevels: listening.levels,
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
      ...(conversions ? { conversionRefs: conversions.refs[i] } : {}),
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
