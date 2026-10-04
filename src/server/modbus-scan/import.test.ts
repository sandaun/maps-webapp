import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, afterEach, expect, it } from "vitest";
import { getProjectStore, resetProjectStoreForTests } from "@/server/persistence";
import { addScannedSignals, applyPatches, getProjectView, loadDemoProject } from "@/server/projects/service";
import { emptyScanResult, scanInputSchema } from "@/core/modbus-scan/model";
import { nodeFingerprint } from "./service";
let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "maps-scan-import-")); process.env.MAPS_DATA_DIR = dir; resetProjectStoreForTests(); await loadDemoProject(); });
afterEach(async () => { delete process.env.MAPS_DATA_DIR; resetProjectStoreForTests(); await rm(dir, { recursive: true, force: true }); });
const input = scanInputSchema.parse({ projectId: "demo", locator: { kind: "rtu", nodeIndex: 0 }, slave: 1, ranges: [{ function: 3, start: 100, end: 100 }] });
const rows = [
  { ...emptyScanResult({ function: 1, address: 100 }), samples: 2, attempts: 2, lastValue: 1, values: [1], status: "readable" as const },
  { ...emptyScanResult({ function: 3, address: 100 }), samples: 2, attempts: 2, lastValue: 65535, values: [65535], status: "readable" as const },
];
it("imports bits and raw unsigned words with explicit base conversion and writing disabled", async () => {
  const original = await getProjectView("demo");
  const changed = await applyPatches("demo", [{ type: "updateDevice", locator: input.locator, deviceIndex: 0, patch: { baseRegister: 1 } }]);
  const next = await addScannedSignals("demo", input, rows, changed.meta.revision!, nodeFingerprint(changed, input));
  expect(next.family).toBe("knx-mbm"); if (next.family !== "knx-mbm" || original.family !== "knx-mbm") return;
  const added = next.project.signals.slice(original.project.signals.length);
  expect(added.map((s) => s.modbus.address)).toEqual([101,101]); expect(added.map((s) => s.modbus.lenBits)).toEqual([1,16]);
  expect(added.every((s) => s.modbus.writeFunc === -1 && !s.knx.flags.w && !s.knx.flags.u && !s.knx.flags.t)).toBe(true);
  expect(added[1].modbus.format).toBe(0); expect(added[1].description).not.toContain("temperature");
  expect((await getProjectStore().listHistory("demo")).some((entry) => entry.text.includes("scan results"))).toBe(true);
});
it("rejects stale revisions and changed connection identities without editing the draft", async () => {
  const view = await getProjectView("demo"); const fingerprint = nodeFingerprint(view, input);
  const changed = await applyPatches("demo", [{ type: "updateRtuNode", nodeIndex: 0, patch: { baudrate: 19200 } }]);
  await expect(addScannedSignals("demo", input, rows, view.meta.revision!, fingerprint)).rejects.toThrow("project changed");
  await expect(addScannedSignals("demo", input, rows, changed.meta.revision!, fingerprint)).rejects.toThrow("connection settings changed");
  expect((await getProjectView("demo")).meta.revision).toBe(changed.meta.revision);
});
it("rejects failed reads rather than importing cached zeros", async () => {
  const view = await getProjectView("demo");
  await expect(addScannedSignals("demo", input, [emptyScanResult({ function: 3, address: 100 })], view.meta.revision!, nodeFingerprint(view, input))).rejects.toThrow("successfully read");
  expect((await getProjectView("demo")).meta.revision).toBe(view.meta.revision);
});
it("prevents accidental duplicate imports of a function/address pair", async () => {
  const view = await getProjectView("demo"); const next = await addScannedSignals("demo", input, rows, view.meta.revision!, nodeFingerprint(view, input));
  await expect(addScannedSignals("demo", input, rows, next.meta.revision!, nodeFingerprint(next, input))).rejects.toThrow("already exist");
});
