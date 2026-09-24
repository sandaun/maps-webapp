import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetProjectStoreForTests } from "@/server/persistence";
import { loadDemoProject } from "@/server/projects/service";
import { readFileSync, writeFileSync } from "node:fs";
import { GET } from "../route";
import { POST } from "./route";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "maps-patch-route-"));
  process.env.MAPS_DATA_DIR = dir;
  resetProjectStoreForTests();
  await loadDemoProject();
});

afterEach(async () => {
  delete process.env.MAPS_DATA_DIR;
  resetProjectStoreForTests();
  await rm(dir, { recursive: true, force: true });
});

function patch(ifMatch?: string) {
  return POST(
    new Request("http://local/api/projects/demo/patch", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(ifMatch ? { "If-Match": ifMatch } : {}) },
      body: JSON.stringify({ patches: [{ type: "setGeneralInfo", name: "Renamed" }] }),
    }),
    { params: Promise.resolve({ id: "demo" }) },
  );
}

describe("PATCH If-Match", () => {
  it("applies the batch when the revision matches and returns the new one", async () => {
    const response = await patch('"1"');
    expect(response.status).toBe(200);
    expect((await response.json()).meta.revision).toBe(2);
  });

  it("rejects a stale revision with 409 and a machine-readable code", async () => {
    await patch('"1"');
    const response = await patch('"1"');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "revision-conflict" });
  });

  it("rejects a malformed header with 400", async () => {
    expect((await patch("not-a-revision")).status).toBe(400);
  });

  it("round-trips an explicit revision 0 for projects stored before revisions existed", async () => {
    const metaPath = path.join(dir, "projects", "demo", "meta.json");
    const { revision: _revision, ...legacy } = JSON.parse(readFileSync(metaPath, "utf8"));
    writeFileSync(metaPath, JSON.stringify(legacy));
    const view = await (
      await GET(new Request("http://local/api/projects/demo"), { params: Promise.resolve({ id: "demo" }) })
    ).json();
    expect(view.meta.revision).toBe(0);
    const response = await patch(`"${view.meta.revision}"`);
    expect(response.status).toBe(200);
    expect((await response.json()).meta.revision).toBe(1);
  });

  it("still accepts requests without the header", async () => {
    expect((await patch()).status).toBe(200);
  });
});
