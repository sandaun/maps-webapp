import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetProjectStoreForTests } from "../persistence";
import {
  applyPatches,
  getProjectView,
  loadDemoProject,
  openCompleteBlob,
  openIbmaps,
  ProjectServiceError,
} from "./service";

const REFERENCE_COMPLETE = "temp/maps-cloud/xbl-spec/referencia/projecte_192_168_2_34.bin";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "maps-svc-"));
  process.env.MAPS_DATA_DIR = dir;
  resetProjectStoreForTests();
});

afterEach(async () => {
  delete process.env.MAPS_DATA_DIR;
  resetProjectStoreForTests();
  await rm(dir, { recursive: true, force: true });
});

describe("project service", () => {
  it("loads the labelled demo project", async () => {
    const meta = await loadDemoProject();
    expect(meta.source).toBe("demo");
    const view = await getProjectView(meta.id);
    expect(view.project.signals.length).toBeGreaterThan(0);
    expect(view.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("rejects non-KNX–MBM .ibmaps files with 422", async () => {
    const xml = `\uFEFF<?xml version="1.0" encoding="UTF-8"?>\r\n<Project InternalProtocol="BACnet Server" ExternalProtocol="Modbus Master"></Project>\r\n`;
    const error = await openIbmaps(xml, { id: "x" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProjectServiceError);
    expect((error as ProjectServiceError).status).toBe(422);
  });

  it("patches survive a simulated restart", async () => {
    const meta = await loadDemoProject();
    await applyPatches(meta.id, [
      { type: "updateSignal", id: 0, patch: { description: "Changed desc" } },
      { type: "setGatewayInfo", name: "RESTART-TEST" },
    ]);
    // Simulate a process restart: new store instance over the same directory.
    resetProjectStoreForTests();
    const view = await getProjectView(meta.id);
    expect(view.project.signals[0].description).toBe("Changed desc");
    expect(view.project.gateway.name).toBe("RESTART-TEST");
  });

  it("patching a missing signal fails loudly", async () => {
    const meta = await loadDemoProject();
    await expect(
      applyPatches(meta.id, [{ type: "updateSignal", id: 999, patch: {} }]),
    ).rejects.toThrow();
  });

  it("opens the real complete blob when the reference checkout is present", async () => {
    if (!existsSync(REFERENCE_COMPLETE)) return;
    const bytes = new Uint8Array(readFileSync(REFERENCE_COMPLETE));
    // The reference is BACnet↔MBM, so it must be rejected as wrong family…
    await expect(openCompleteBlob(bytes, { id: "ref" })).rejects.toThrow(/KNX/);
  });
});
