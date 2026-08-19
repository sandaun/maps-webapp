import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KnxMbmProject } from "@/gateway-families/knx-mbm";
import { SYNTHETIC_ME_MBS_XML } from "@/gateway-families/me-mbs/fixtures/synthetic-project";
import { resetProjectStoreForTests } from "../persistence";
import {
  applyPatches,
  getProjectView,
  listProjects,
  loadDemoProject,
  openCompleteBlob,
  openIbmaps,
  ProjectServiceError,
  type ProjectView,
} from "./service";

const REFERENCE_COMPLETE = "temp/maps-cloud/xbl-spec/referencia/projecte_192_168_2_34.bin";
const REAL_ME_MBS_XML = ".local-data/fixtures/770air-me-mbs-2026-08-18.ibmaps.xml";

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

function knxProjectOf(view: ProjectView): KnxMbmProject {
  if (view.family !== "knx-mbm") throw new Error(`expected knx-mbm, got ${view.family}`);
  return view.project;
}

describe("project service", () => {
  it("loads the labelled demo project", async () => {
    const meta = await loadDemoProject();
    expect(meta.source).toBe("demo");
    expect(meta.family).toBe("knx-mbm");
    const view = await getProjectView(meta.id);
    expect(view.project.signals.length).toBeGreaterThan(0);
    expect(view.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("rejects unsupported .ibmaps files with 422 listing supported families", async () => {
    const xml = `\uFEFF<?xml version="1.0" encoding="UTF-8"?>\r\n<Project InternalProtocol="BACnet Server" ExternalProtocol="Modbus Master"></Project>\r\n`;
    const error = await openIbmaps(xml, { id: "x" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProjectServiceError);
    expect((error as ProjectServiceError).status).toBe(422);
    expect((error as ProjectServiceError).message).toMatch(/Supported families: .*KNX/);
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

  it("adds and edits an RTU node, enforcing the node limit", async () => {
    const meta = await loadDemoProject();
    const before = await getProjectView(meta.id);
    const rtuCount = knxProjectOf(before).mbm.rtuNodes.length;

    const view = await applyPatches(meta.id, [
      { type: "addRtuNode" },
      { type: "updateRtuNode", nodeIndex: rtuCount, patch: { baudrate: 19200, parity: 2 } },
    ]);
    expect(knxProjectOf(view).mbm.rtuNodes).toHaveLength(rtuCount + 1);
    expect(knxProjectOf(view).mbm.rtuNodes[rtuCount]).toMatchObject({ baudrate: 19200, parity: 2 });

    // The demo fixture has 1 RTU node; the second add hits MAX_RTU_NODES = 2.
    const error = await applyPatches(meta.id, [{ type: "addRtuNode" }]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProjectServiceError);
    expect((error as ProjectServiceError).status).toBe(409);
  });

  it("adds, edits and removes a device on a node", async () => {
    const meta = await loadDemoProject();
    const locator = { kind: "rtu" as const, nodeIndex: 0 };
    const before = await getProjectView(meta.id);
    const deviceCount = knxProjectOf(before).mbm.rtuNodes[0].devices.length;

    const view = await applyPatches(meta.id, [
      { type: "addDevice", locator },
      {
        type: "updateDevice",
        locator,
        deviceIndex: deviceCount,
        patch: { name: "Rooftop AHU", slave: 7 },
      },
    ]);
    const devices = knxProjectOf(view).mbm.rtuNodes[0].devices;
    expect(devices).toHaveLength(deviceCount + 1);
    expect(devices[deviceCount]).toMatchObject({ name: "Rooftop AHU", slave: 7 });

    const after = await applyPatches(meta.id, [
      { type: "removeDevice", locator, deviceIndex: deviceCount },
    ]);
    expect(knxProjectOf(after).mbm.rtuNodes[0].devices).toHaveLength(deviceCount);
  });

  it("backfills the family field on projects stored before it existed", async () => {
    const meta = await loadDemoProject();
    // Simulate a pre-2.5 stored meta: no family field.
    const metaFile = path.join(dir, "projects", meta.id, "meta.json");
    const legacy = JSON.parse(readFileSync(metaFile, "utf8")) as Record<string, unknown>;
    delete legacy.family;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(metaFile, JSON.stringify(legacy));

    const view = await getProjectView(meta.id);
    expect(view.family).toBe("knx-mbm");
    expect(view.meta.family).toBe("knx-mbm");
    // Re-persisted: list() shows the family too.
    expect((await listProjects()).find((m) => m.id === meta.id)?.family).toBe("knx-mbm");
  });

  it("opens the real complete blob when the reference checkout is present", async () => {
    if (!existsSync(REFERENCE_COMPLETE)) return;
    const bytes = new Uint8Array(readFileSync(REFERENCE_COMPLETE));
    // The reference is BACnet↔MBM, so it must be rejected as unsupported…
    await expect(openCompleteBlob(bytes, { id: "ref" })).rejects.toThrow(/KNX/);
  });
});

describe("project service — me-mbs family", () => {
  it("opens a ME–MBS .ibmaps and reports the family", async () => {
    const meta = await openIbmaps(SYNTHETIC_ME_MBS_XML, { id: "me", name: "ME test" });
    expect(meta.family).toBe("me-mbs");
    const view = await getProjectView(meta.id);
    expect(view.family).toBe("me-mbs");
    if (view.family !== "me-mbs") throw new Error("unreachable");
    expect(view.project.signals).toHaveLength(9);
    expect(view.project.me.controllers).toHaveLength(1);
    expect(view.project.mbs.rtu.slaveNumber).toBe(3);
  });

  it("applies me-mbs patches and persists them", async () => {
    const meta = await openIbmaps(SYNTHETIC_ME_MBS_XML, { id: "me" });
    const view = await applyPatches(meta.id, [
      { type: "updateSignal", id: 0, patch: { description: "Comm error (edited)" } },
      { type: "updateMbsConfig", patch: { commErrorTout: 60 } },
      { type: "updateRtuConfig", patch: { slaveNumber: 11 } },
      { type: "updateGroup", controllerIndex: 0, groupIndex: 0, patch: { description: "Office (edited)" } },
    ]);
    if (view.family !== "me-mbs") throw new Error("unreachable");
    expect(view.project.signals[0].description).toBe("Comm error (edited)");
    expect(view.project.mbs.commErrorTout).toBe(60);
    expect(view.project.mbs.rtu.slaveNumber).toBe(11);
    expect(view.project.me.controllers[0].groups[0].description).toBe("Office (edited)");

    // Survives a simulated restart.
    resetProjectStoreForTests();
    const reloaded = await getProjectView(meta.id);
    expect(reloaded.project.signals[0].description).toBe("Comm error (edited)");
  });

  it("rejects knx-mbm patches on a me-mbs project with 409", async () => {
    const meta = await openIbmaps(SYNTHETIC_ME_MBS_XML, { id: "me" });
    const nodePatch = await applyPatches(meta.id, [{ type: "addRtuNode" }]).catch((e: unknown) => e);
    expect(nodePatch).toBeInstanceOf(ProjectServiceError);
    expect((nodePatch as ProjectServiceError).status).toBe(409);
    expect((nodePatch as ProjectServiceError).message).toMatch(/Mitsubishi Electric/);

    const knxSignal = await applyPatches(meta.id, [
      { type: "updateSignal", id: 0, patch: { knx: { dpt: 1 } } },
    ]).catch((e: unknown) => e);
    expect(knxSignal).toBeInstanceOf(ProjectServiceError);
    expect((knxSignal as ProjectServiceError).status).toBe(409);
  });

  it("rejects me-mbs patches on a knx-mbm project with 409", async () => {
    const meta = await loadDemoProject();
    const error = await applyPatches(meta.id, [
      { type: "updateMbsConfig", patch: { commErrorTout: 60 } },
    ]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProjectServiceError);
    expect((error as ProjectServiceError).status).toBe(409);
    expect((error as ProjectServiceError).message).toMatch(/KNX/);
  });

  it("opens, patches and validates the real 770 Air fixture when present", async () => {
    if (!existsSync(REAL_ME_MBS_XML)) return;
    const xml = readFileSync(REAL_ME_MBS_XML, "utf8");
    const meta = await openIbmaps(xml, { id: "real-770", name: "770 Air" });
    expect(meta.family).toBe("me-mbs");

    const view = await getProjectView(meta.id);
    expect(view.project.signals).toHaveLength(222);
    expect(view.issues.filter((i) => i.severity === "error")).toEqual([]);

    const patched = await applyPatches(meta.id, [
      { type: "updateSignal", id: 0, patch: { description: "Edited from the smoke test" } },
    ]);
    expect(patched.project.signals[0].description).toBe("Edited from the smoke test");
    // The rest of the document stays intact.
    expect(patched.project.signals).toHaveLength(222);
  });
});
