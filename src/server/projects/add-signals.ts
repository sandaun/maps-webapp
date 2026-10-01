import { XmlDocument } from "@/core/project-format";
import { planAddSignals, type AddSignalsOptions } from "@/core/signals/add-signals";
import * as master from "@/gateway-families/knx-mbm";
import * as slave from "@/gateway-families/mbs-knx";
import { ProjectServiceError } from "./errors";

/** Plan the entire batch before editing the preserved protocol nodes. */
export function addPlannedSignals(doc: XmlDocument, family: "knx-mbm" | "mbs-knx", options: AddSignalsOptions) {
  const project = family === "knx-mbm" ? master.projectFromXml(doc) : slave.projectFromXml(doc);
  let plan: ReturnType<typeof planAddSignals>;
  try { plan = planAddSignals(project, options); }
  catch (error) { throw new ProjectServiceError(422, (error as Error).message); }
  let firstId = -1;
  for (const entry of plan.entries) {
    const id = family === "knx-mbm" ? master.addSignal(doc) : slave.addSignal(doc);
    if (firstId < 0) firstId = id;
    const knx = { dpt: entry.dpt, groupAddress: entry.groupAddress, groupAddressLevel: 3 as const,
      flags: { u: true, t: true, ri: false, w: true, r: true } };
    if (family === "knx-mbm") {
      master.updateSignal(doc, id, { active: entry.active, description: entry.description, knx,
        modbus: { port: plan.device!.port, deviceIndex: plan.device!.deviceIndex, readFunc: 3, writeFunc: entry.writeFunc,
          lenBits: entry.lenBits, format: 0, byteOrder: 0, address: entry.address, bit: entry.bit, numOfBits: entry.numOfBits, deadband: 0 } });
    } else {
      slave.updateSignal(doc, id, { active: entry.active, description: entry.description, knx,
        modbus: { lenBits: entry.lenBits, format: 0, readWrite: 2, address: entry.address } });
    }
  }
  if (plan.insertIndex < project.signals.length) {
    if (family === "knx-mbm") master.moveSignal(doc, firstId, plan.insertIndex, options.count);
    else slave.moveSignal(doc, firstId, plan.insertIndex, options.count);
  }
}
