import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalProjectStore } from "./local-store";

let dir: string;
let store: LocalProjectStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "maps-store-"));
  store = new LocalProjectStore(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("LocalProjectStore", () => {
  const meta = {
    id: "p1",
    name: "Project 1",
    description: "",
    source: "file" as const,
    updatedAt: "2026-08-17T00:00:00.000Z",
  };

  it("upsert/get/list round-trip", async () => {
    expect(await store.list()).toEqual([]);
    await store.upsert(meta);
    await store.writeXml("p1", "<Project />");
    expect(await store.get("p1")).toEqual(meta);
    expect(await store.readXml("p1")).toBe("<Project />");
    expect(await store.list()).toEqual([meta]);
  });

  it("sanitizes unsafe ids", async () => {
    await store.upsert({ ...meta, id: "../../etc/passwd" });
    await expect(store.get("../../etc/passwd")).resolves.toBeDefined();
    // nothing was written outside the root
    await store.upsert({ ...meta, id: "ok id with spaces" });
    expect(await store.list()).toHaveLength(2);
  });

  it("rejects ids that sanitize to nothing", async () => {
    await expect(store.upsert({ ...meta, id: ".." })).rejects.toThrow(/Unsafe project id/);
  });

  it("complete blob storage", async () => {
    await store.upsert(meta);
    expect(await store.hasCompleteBlob("p1")).toBe(false);
    await store.writeCompleteBlob("p1", new Uint8Array([1, 2, 3]));
    expect(await store.hasCompleteBlob("p1")).toBe(true);
    expect([...(await store.readCompleteBlob("p1"))]).toEqual([1, 2, 3]);
  });

  it("delete removes everything", async () => {
    await store.upsert(meta);
    await store.writeXml("p1", "x");
    await store.delete("p1");
    expect(await store.get("p1")).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });
});
