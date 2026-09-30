import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { resetProjectStoreForTests, getProjectStore } from "@/server/persistence";
import { openIbmaps, getProjectView, applyPatches, listProjectHistory } from "@/server/projects/service";
import { parseDeviceTemplate } from "./read";
import { rememberTemplate } from "./cache";
import { TEMPLATE_XML } from "./fixtures";
import type { ApplyDeviceTemplate } from "@/core/device-templates/types";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(),"maps-device-template-"));
  process.env.MAPS_DATA_DIR = dir; resetProjectStoreForTests();
});
afterEach(async () => {
  delete process.env.MAPS_DATA_DIR; resetProjectStoreForTests();
  vi.useRealTimers();
  await rm(dir,{recursive:true,force:true});
});

async function prepare() {
  const meta = await openIbmaps(SYNTHETIC_KNX_MBM_XML,{id:"template-project"});
  const view = await getProjectView(meta.id);
  const token = rememberTemplate(meta.id,view.meta.revision ?? 0,parseDeviceTemplate(TEMPLATE_XML));
  const patch: ApplyDeviceTemplate = {type:"applyDeviceTemplate",token,locator:{kind:"rtu",nodeIndex:0},name:"Imported AHU",slave:2,enabled:[0],includeDisabled:true};
  return {meta,view,patch};
}

describe("atomic project template imports", () => {
  it("persists all rows and a history entry in one revision, then restores exact original XML on undo", async () => {
    const {meta,view,patch} = await prepare();
    const xml = await getProjectStore().readXml(meta.id);
    const history = await listProjectHistory(meta.id);
    const imported = await applyPatches(meta.id,[patch],{expectedRevision:view.meta.revision});
    expect(imported.meta.revision).toBe(view.meta.revision!+1);
    expect(imported.project.signals).toHaveLength(5);
    expect(await listProjectHistory(meta.id)).toHaveLength(history.length+1);
    resetProjectStoreForTests();
    expect((await getProjectView(meta.id)).project.signals).toHaveLength(5);
    const undone = await applyPatches(meta.id,[{type:"undoDeviceTemplate",token:patch.token}],{expectedRevision:imported.meta.revision});
    expect(undone.project).toEqual(view.project);
    expect(await getProjectStore().readXml(meta.id)).toBe(xml);
  });

  it("rejects stale and cross-project previews even without If-Match, leaving persisted data intact", async () => {
    const {meta,patch} = await prepare();
    await openIbmaps(SYNTHETIC_KNX_MBM_XML,{id:"another"});
    await expect(applyPatches("another",[patch])).rejects.toMatchObject({status:409,code:"revision-conflict"});
    await applyPatches(meta.id,[{type:"setGeneralInfo",name:"Changed"}]);
    const before = await getProjectView(meta.id);
    await expect(applyPatches(meta.id,[patch])).rejects.toMatchObject({status:409,code:"revision-conflict"});
    expect(await getProjectView(meta.id)).toEqual(before);
  });

  it("prevents duplicate concurrent imports and an undo that would erase a later edit", async () => {
    const {meta,patch} = await prepare();
    const results = await Promise.allSettled([applyPatches(meta.id,[patch]),applyPatches(meta.id,[patch])]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await applyPatches(meta.id,[{type:"setGeneralInfo",name:"Keep later edit"}]);
    const before = await getProjectView(meta.id);
    await expect(applyPatches(meta.id,[{type:"undoDeviceTemplate",token:patch.token}])).rejects.toMatchObject({status:409});
    expect(await getProjectView(meta.id)).toEqual(before);
  });

  it("does not persist failed selection/destination, rejects mixed patch batches, and expires previews", async () => {
    const {meta,view,patch} = await prepare();
    const xml = await getProjectStore().readXml(meta.id);
    await expect(applyPatches(meta.id,[{...patch,slave:1}])).rejects.toMatchObject({status:422});
    await expect(applyPatches(meta.id,[{type:"setGeneralInfo",name:"Must not change"},patch])).rejects.toMatchObject({status:422});
    expect((await getProjectView(meta.id)).meta).toEqual(view.meta);
    expect(await getProjectStore().readXml(meta.id)).toBe(xml);
    vi.useFakeTimers(); vi.setSystemTime(Date.now()+31*60*1000);
    await expect(applyPatches(meta.id,[patch])).rejects.toMatchObject({status:409,code:"template-expired"});
  });
});
