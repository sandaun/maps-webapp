import "server-only";
import { XmlDocument } from "@/core/project-format";
import { runXblPipeline } from "@/gateway-families/knx-mbm/xbl/pipeline";
import { functionCell, POLL_PLAN_HEADERS } from "./maps-grid-values";
import {
  newWorkbook,
  styleHeaderRow,
  workbookToBuffer,
  writeFileHeaders,
  writeTextRow,
} from "./xlsx-workbook";

/**
 * Poll-plan XLSX. Columns match `PollRecord.GetMyRow`; rows come from
 * `generateAllPollRecords` even when `<PollRecords Enabled>` is false.
 */
export async function buildPollPlanXlsx(
  doc: XmlDocument,
  opts: { projectName: string; now?: Date },
): Promise<Buffer> {
  const pipeline = runXblPipeline(doc, { pollRecords: "always" });
  const workbook = newWorkbook();
  const sheet = workbook.addWorksheet("Poll plan");
  writeFileHeaders(sheet, {
    title: "MAPS Web Modbus poll plan",
    projectName: opts.projectName,
    version: "0.1.0",
    internalProtocol: "KNX",
    externalProtocol: "Modbus Master",
    timestamp: (opts.now ?? new Date()).toLocaleDateString(),
  });
  writeTextRow(sheet, 7, [...POLL_PLAN_HEADERS]);
  styleHeaderRow(sheet.getRow(7), POLL_PLAN_HEADERS.length);

  pipeline.mbm.pollRecords.forEach((rec, i) => {
    writeTextRow(sheet, 8 + i, [
      String(i),
      pollDeviceCell(pipeline, rec.portIndex, rec.deviceIndex),
      functionCell(rec.function),
      String(rec.regStart),
      String(rec.regStop - rec.regStart + 1),
      String(rec.indexFirst),
      String(rec.indexLast),
    ]);
  });

  return workbookToBuffer(workbook);
}

/** `PollRecord.GetDeviceCellValue` — Port A/B by enabled-node index, not XML PhysicalPort. */
function pollDeviceCell(
  pipeline: ReturnType<typeof runXblPipeline>,
  portIndex: number,
  deviceIndex: number,
): string {
  const rtuCount = pipeline.mbm.rtuNodes.length;
  if (portIndex < rtuCount) {
    const portName = portIndex === 0 ? "Port A" : "Port B";
    const name = pipeline.mbm.rtuNodes[portIndex]?.devices[deviceIndex]?.name ?? "";
    return `RTU // ${portName} // ${name}`;
  }
  const tcp = pipeline.mbm.tcpNodes[portIndex - rtuCount];
  const name = tcp?.devices[deviceIndex]?.name ?? "";
  return `TCP // ${tcp?.description ?? ""} // ${name}`;
}
