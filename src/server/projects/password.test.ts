import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { parseXblIbox } from "@/core/xbl/ibox-xml";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { SYNTHETIC_ME_MBS_XML } from "@/gateway-families/me-mbs/fixtures/synthetic-project";
import { SYNTHETIC_MBS_KNX_XML } from "@/gateway-families/mbs-knx/fixtures/synthetic-project";
import { getProjectStore, resetProjectStoreForTests } from "../persistence";
import { applyPatches, getProjectView, listProjectHistory, openIbmaps, restoreProjectHistory } from "./service";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "maps-password-"));
  process.env.MAPS_DATA_DIR = dir;
  resetProjectStoreForTests();
});
afterEach(async () => {
  delete process.env.MAPS_DATA_DIR;
  resetProjectStoreForTests();
  await rm(dir, { recursive: true, force: true });
});

describe.each([
  ["knx-mbm", SYNTHETIC_KNX_MBM_XML],
  ["me-mbs", SYNTHETIC_ME_MBS_XML],
  ["mbs-knx", SYNTHETIC_MBS_KNX_XML],
])("write-only password (%s)", (_family, xml) => {
  it.each([false, true])("persists only IBOX/Pwd, survives reload and reaches XBL parsing (compact=%s)", async (compact) => {
    const doc = XmlDocument.parse(compact ? xml.replace(/>\s+</g, "><") : xml);
    doc.setAttr(["Connection"], "Pwd", "connect1");
    doc.setAttr(["IBOX"], "Pwd", "old-test");
    const original = doc.serialize();
    await openIbmaps(original, { id: "p" });
    const password = ' A&"<>~ ';
    const view = await applyPatches("p", [{ type: "setProjectPassword", password }], { expectedRevision: 1 });
    expect(view.passwordValid).toBe(true);
    expect(view.meta.revision).toBe(2);
    expect(JSON.stringify(view)).not.toContain("old-test");
    expect(JSON.stringify(view)).not.toContain(JSON.stringify(password).slice(1, -1));
    resetProjectStoreForTests();
    const stored = XmlDocument.parse(await getProjectStore().readXml("p"));
    expect(stored.getAttr(["Connection"], "Pwd")).toBe("connect1");
    expect(parseXblIbox(stored).pwd).toBe(password);
    expect((await getProjectView("p")).passwordValid).toBe(true);
    // Reverting the one attribute recovers every unrelated byte.
    stored.setAttr(["IBOX"], "Pwd", "old-test");
    expect(stored.serialize()).toBe(original);
    expect(JSON.stringify(await listProjectHistory("p"))).not.toContain(password);
  });

  it("rejects invalid values atomically and protects against stale revisions", async () => {
    await openIbmaps(xml, { id: "p" });
    for (const password of ["", "café", "123456789", "bad\n", "\u0000"]) {
      await expect(applyPatches("p", [
        { type: "setGeneralInfo", name: "Should not persist" },
        { type: "setProjectPassword", password },
      ])).rejects.toMatchObject({ status: 422 });
      expect(await getProjectStore().readXml("p")).toBe(xml);
      expect((await getProjectView("p")).meta.revision).toBe(1);
    }
    await applyPatches("p", [{ type: "setProjectPassword", password: "new-test" }], { expectedRevision: 1 });
    await expect(applyPatches("p", [{ type: "setProjectPassword", password: "stale" }], { expectedRevision: 1 }))
      .rejects.toMatchObject({ status: 409, code: "revision-conflict" });
    expect(XmlDocument.parse(await getProjectStore().readXml("p")).getAttr(["IBOX"], "Pwd")).toBe("new-test");
  });

  it("derives status from imported XML and again after a history restore", async () => {
    await openIbmaps(xml, { id: "p" });
    expect((await getProjectView("p")).passwordValid).toBe(false);
    await applyPatches("p", [{ type: "setGeneralInfo", name: "Before password" }]);
    const [draft] = await listProjectHistory("p");
    await applyPatches("p", [{ type: "setProjectPassword", password: "new-test" }]);
    expect((await restoreProjectHistory("p", draft.id)).passwordValid).toBe(false);
    const doc = XmlDocument.parse(xml);
    doc.setAttr(["IBOX"], "Pwd", "non-ascii-é");
    await openIbmaps(doc.serialize(), { id: "p" });
    expect((await getProjectView("p")).passwordValid).toBe(false);
  });
});
