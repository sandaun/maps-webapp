import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { DELETE as deleteRoute } from "@/app/api/projects/[id]/route";
import { DELETE as deleteDemoRoute } from "@/app/api/projects/demo/route";
import { getGatewaySessionManager, resetGatewaySessionManagerForTests, type GatewaySessionStatus } from "../intesis-transport";
import { getProjectStore, resetProjectStoreForTests } from "../persistence";
import { beginProjectDeploy, deleteProject, listProjects, loadDemoProject, openIbmaps } from "./service";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "maps-delete-"));
  process.env.MAPS_DATA_DIR = dir;
  resetProjectStoreForTests();
  resetGatewaySessionManagerForTests();
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.MAPS_DATA_DIR;
  resetProjectStoreForTests();
  resetGatewaySessionManagerForTests();
  await rm(dir, { recursive: true, force: true });
});

describe("deleteProject", () => {
  it("removes the local project and reports a missing project as 404", async () => {
    await openIbmaps(SYNTHETIC_KNX_MBM_XML, { id: "one" });
    await openIbmaps(SYNTHETIC_KNX_MBM_XML, { id: "two" });
    await deleteProject("one");

    expect(await getProjectStore().get("one")).toBeUndefined();
    expect((await listProjects()).map((project) => project.id)).toEqual(["two"]);
    await expect(getProjectStore().readXml("one")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(deleteProject("one")).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a project selected by a live gateway session", async () => {
    await openIbmaps(SYNTHETIC_KNX_MBM_XML, { id: "one" });
    vi.spyOn(getGatewaySessionManager(), "list").mockReturnValue([{
      id: "session", projectId: "one", connected: true,
    } as GatewaySessionStatus]);

    await expect(deleteProject("one")).rejects.toMatchObject({ status: 409, code: "project-in-session" });
    expect(await getProjectStore().get("one")).toBeDefined();
  });

  it("refuses deletion throughout an active deploy, then allows it to finish", async () => {
    await openIbmaps(SYNTHETIC_KNX_MBM_XML, { id: "one" });
    const finish = await beginProjectDeploy("one");
    try {
      await expect(deleteProject("one")).rejects.toMatchObject({ status: 409, code: "project-uploading" });
      expect(await getProjectStore().get("one")).toBeDefined();
    } finally {
      finish();
    }
    await deleteProject("one");
    expect(await getProjectStore().get("one")).toBeUndefined();
  });

  it("rejects a second deploy without releasing the first claim", async () => {
    await openIbmaps(SYNTHETIC_KNX_MBM_XML, { id: "one" });
    const finish = await beginProjectDeploy("one");
    try {
      await expect(beginProjectDeploy("one")).rejects.toMatchObject({
        status: 409, code: "project-uploading",
      });
      await expect(deleteProject("one")).rejects.toMatchObject({ code: "project-uploading" });
    } finally {
      finish();
    }
    const finishNext = await beginProjectDeploy("one");
    finishNext();
  });

  it("preserves deploy protection across route module reloads", async () => {
    await openIbmaps(SYNTHETIC_KNX_MBM_XML, { id: "one" });
    const finish = await beginProjectDeploy("one");
    try {
      vi.resetModules();
      const reloaded = await import("./service");
      await expect(reloaded.deleteProject("one")).rejects.toMatchObject({
        status: 409, code: "project-uploading",
      });
      await expect(reloaded.beginProjectDeploy("one")).rejects.toMatchObject({
        status: 409, code: "project-uploading",
      });
      finish();
      // The callback from the old module releases the claim seen by the new one.
      await reloaded.deleteProject("one");
      expect(await getProjectStore().get("one")).toBeUndefined();
    } finally {
      finish();
    }
  });
});

describe("DELETE /api/projects/[id]", () => {
  it("returns 204 on deletion and 404 when repeated", async () => {
    await openIbmaps(SYNTHETIC_KNX_MBM_XML, { id: "one" });
    const request = new Request("http://localhost/api/projects/one", { method: "DELETE" });
    const context = { params: Promise.resolve({ id: "one" }) };
    expect((await deleteRoute(request, context)).status).toBe(204);
    expect((await deleteRoute(request, context)).status).toBe(404);
  });

  it("returns the session blocker as 409", async () => {
    await openIbmaps(SYNTHETIC_KNX_MBM_XML, { id: "one" });
    vi.spyOn(getGatewaySessionManager(), "list").mockReturnValue([{
      id: "session", projectId: "one", connected: true,
    } as GatewaySessionStatus]);
    const response = await deleteRoute(new Request("http://localhost/api/projects/one", { method: "DELETE" }), {
      params: Promise.resolve({ id: "one" }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "project-in-session" });
  });
});

describe("DELETE /api/projects/demo", () => {
  it("deletes the synthetic demo through its static route", async () => {
    await loadDemoProject();
    expect((await deleteDemoRoute()).status).toBe(204);
    expect(await getProjectStore().get("demo")).toBeUndefined();
    expect((await deleteDemoRoute()).status).toBe(404);
  });
});
