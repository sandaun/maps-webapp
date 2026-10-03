import { expect, it } from "vitest";
import { temperature } from "@/core/modbus-ai/test-fixtures";
import { candidateTemplate, appendCandidateSignals } from "./template";
import { readDeviceTemplate } from "@/server/device-templates/read";
import { XmlDocument } from "@/core/project-format";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { projectFromXml } from "@/gateway-families/knx-mbm/from-xml";
import { updateDevice } from "@/gateway-families/knx-mbm/xml-ops";
it("exports and reopens a native MAPS template with scale applied exactly once in read direction", () => {
  const result = candidateTemplate([temperature()], "test map", "test vendor");
  const parsed = readDeviceTemplate(result.bytes);
  expect(parsed.preview.signals).toHaveLength(1); const signal = parsed.preview.signals[0];
  expect(signal.modbus).toMatchObject({ readFunc: 3, writeFunc: -1, lenBits: 16, format: 1, address: 104 });
  expect(signal.knx.flags.w).toBe(false); expect(signal.conversions.internal.operations).toHaveLength(0); expect(signal.conversions.external.operations).toEqual([{ index: 0, inverted: false }]);
  expect(parsed.preview.conversions).toHaveLength(1); expect(parsed.preview.conversions[0].params.map(Number)).toEqual([0, 0.1, 0, 0]);
});
it("imports into an existing base-one device without changing original rows and blocks duplicates", () => {
  const doc = XmlDocument.parse(SYNTHETIC_KNX_MBM_XML); const before = projectFromXml(doc);
  updateDevice(doc, { kind: "rtu", nodeIndex: 0, deviceIndex: 0 }, { baseRegister: 1 });
  const target = { kind: "rtu" as const, nodeIndex: 0, slave: before.mbm.rtuNodes[0].devices[0].slave, name: "existing", manufacturer: "" };
  appendCandidateSignals(doc, [temperature()], target);
  const after = projectFromXml(doc); expect(after.signals.slice(0, before.signals.length)).toEqual(before.signals); expect(after.signals.at(-1)!.modbus.address).toBe(105);
  expect(() => appendCandidateSignals(doc, [temperature()], target)).toThrow("already exists");
});
it("keeps documented write-only and Trigger rows inactive and all writes disabled", () => {
  const parsed = readDeviceTemplate(candidateTemplate([temperature({ access: "Trigger" })], "reset", "").bytes);
  expect(parsed.preview.signals[0].active).toBe(false); expect(parsed.preview.signals[0].modbus.writeFunc).toBe(-1);
});
