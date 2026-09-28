import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCompleteBlob, buildProjectZip, parseCompleteBlob, XmlDocument } from "@/core/project-format";
import { decodeElements } from "@/core/xbl";
import { generateKnxMbmXbl } from "@/gateway-families/knx-mbm";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import {
  generateMeMbsXbl,
  updateControllerAndSignals,
  updateGroupAndSignals,
  updateMbsConfigAndSignals,
} from "@/gateway-families/me-mbs";
import { SYNTHETIC_ME_MBS_EMPTY_XML } from "@/gateway-families/me-mbs/fixtures/synthetic-empty-project";
import { SYNTHETIC_ME_MBS_XML } from "@/gateway-families/me-mbs/fixtures/synthetic-project";
import type { GatewaySessions, GatewaySessionStatus } from "../intesis-transport";
import { resetProjectStoreForTests } from "../persistence";
import { applyPatches, getProjectView, loadDemoProject, openCompleteBlob, openIbmaps } from "../projects/service";
import { DEPLOY_FAMILIES, deployProject, DeployGateError, getDeployStatus } from "./service";

/**
 * Deploy gate tests (Pas 2.6 / 3.4): each gate blocks correctly per family
 * and the happy path regenerates the XBL (via the family's descriptor) before
 * handing the blob to the session manager. No real gateway: the
 * `GatewaySessions` double only captures the upload.
 */

let dir: string;
let capabilitiesPath: string;

// The shared synthetic fixture references conversions/LUTs it does not
// declare (mirroring the real 770 Air project); the XBL generator needs them.
// Same in-memory enrichment as xbl/generate.test.ts.
const CONVERSIONS = [
  '      <Conversion Id="0" Description="" Type="2" Param1="1" Param2="1" Param3="0" Param4="0" />',
  '      <Conversion Id="1" Description="" Type="2" Param1="-2" Param2="1" Param3="0" Param4="0" />',
  ...Array.from(
    { length: 16 },
    (_, i) =>
      `      <Conversion Id="${i + 2}" Description="" Type="4" Param1="${i}" Param2="0" Param3="0" Param4="0" />`,
  ),
].join("\r\n");

const REMAP_LUTS = [
  '    <RemapLUTs>',
  '      <RemapLUT Id="0" NumOfElements="1" Default="0" InvDefault="0">',
  '        <Element InValue="7" OutValue="42" />',
  "      </RemapLUT>",
  "    </RemapLUTs>",
].join("\r\n");

const ME_MBS_XML = SYNTHETIC_ME_MBS_XML.replace(
  /      <Conversion Id="0"[^\r\n]*/,
  CONVERSIONS,
).replace("    </Conversions>", `    </Conversions>\r\n${REMAP_LUTS}`);

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "maps-deploy-"));
  capabilitiesPath = path.join(dir, "capabilities.json");
  process.env.MAPS_DATA_DIR = path.join(dir, "store");
  resetProjectStoreForTests();
});

afterEach(async () => {
  delete process.env.MAPS_DATA_DIR;
  resetProjectStoreForTests();
  await rm(dir, { recursive: true, force: true });
});

async function writeGenuineCapability(key: "meMbsXblVerified" | "knxMbmXblVerified" = "meMbsXblVerified"): Promise<void> {
  const sha = "a".repeat(64);
  await writeFile(
    capabilitiesPath,
    JSON.stringify({
      [key]: {
        verifiedAt: new Date().toISOString(),
        projectSha256: sha,
        referenceSha256: sha,
        xblLength: 8205,
        maskedTimestamp: true,
        swVersion: "1.2.31.0",
      },
    }),
  );
}

function fakeSessions(opts: { appId?: number; connected?: boolean; known?: boolean } = {}) {
  const uploads: Uint8Array[] = [];
  const status: GatewaySessionStatus = {
    id: "sess-1",
    host: "192.168.2.130",
    port: 23,
    connected: opts.connected ?? true,
    encrypted: true,
    busy: false,
    monitoring: false,
    monitorComms: false,
    monitorDebug: false,
    connectedAt: new Date().toISOString(),
    gateway: { appId: opts.appId ?? 64, bootloader: false, noApp: false },
  };
  const sessions: GatewaySessions = {
    connect: () => Promise.reject(new Error("not implemented")),
    disconnect: () => {},
    list: () => [status],
    getStatus: (id: string) => {
      if (opts.known === false || id !== status.id) {
        const error = new Error(`Gateway session "${id}" not found`);
        (error as { status?: number }).status = 404;
        throw error;
      }
      return status;
    },
    queryInfo: () => Promise.reject(new Error("not implemented")),
    receiveProject: () => Promise.reject(new Error("not implemented")),
    runConsoleCommand: () => Promise.reject(new Error("not implemented")),
    setMonitor: () => Promise.reject(new Error("not implemented")),
    sendComplete: (_id, blob) => {
      uploads.push(blob);
      return Promise.resolve();
    },
    subscribe: () => () => {},
  };
  return { sessions, uploads };
}

async function openMeMbsProject(id = "p1"): Promise<void> {
  await openIbmaps(ME_MBS_XML, { id, name: "ME project" });
}

async function openKnxMbmProject(id = "k1"): Promise<void> {
  await openIbmaps(SYNTHETIC_KNX_MBM_XML, { id, name: "KNX project" });
}

/** Zero the 6 volatile timestamp bytes (header tag 1 → child tag 4). */
function maskTimestamp(xbl: Uint8Array): Uint8Array {
  const copy = new Uint8Array(xbl);
  const header = decodeElements(copy).find((el) => el.tag === 1 && el.kind === "container");
  const ts = header?.children?.find((c) => c.tag === 4);
  if (ts) copy.fill(0, ts.contentOffset, ts.contentOffset + 6);
  return copy;
}

describe("deploy gates", () => {
  it("deploys a me-mbs project when every gate passes, regenerating the XBL", async () => {
    await openMeMbsProject();
    await writeGenuineCapability();
    const { sessions, uploads } = fakeSessions({ appId: 64 });

    const result = await deployProject("p1", "sess-1", { sessions, capabilitiesPath });

    expect(uploads).toHaveLength(1);
    const blob = parseCompleteBlob(uploads[0]);
    // Same as the freshly generated XBL except the 6 volatile timestamp bytes.
    const expected = generateMeMbsXbl(ME_MBS_XML, { now: new Date() });
    expect(maskTimestamp(blob.xbl)).toEqual(maskTimestamp(expected));
    expect(result.bytes).toBe(uploads[0].length);
    expect(result.xblBytes).toBe(blob.xbl.length);
    expect(result.appId).toBe(64);
    expect(result.swVersion).toBe("1.2.31.0"); // no original blob → generator default
  });

  it("reuses the original blob's SW version when available", async () => {
    const originalXbl = generateMeMbsXbl(ME_MBS_XML, {
      swVersion: [9, 8, 7, 6],
      now: new Date("2026-01-01T00:00:00"),
    });
    const originalBlob = buildCompleteBlob(
      originalXbl,
      buildProjectZip("p2.ibmaps", ME_MBS_XML),
    );
    await openCompleteBlob(originalBlob, { id: "p2", name: "ME project" });
    await writeGenuineCapability();
    const { sessions } = fakeSessions({ appId: 64 });

    const result = await deployProject("p2", "sess-1", { sessions, capabilitiesPath });
    expect(result.swVersion).toBe("9.8.7.6");
  });

  it("blocks projects of families without a deploy descriptor at the family gate (422)", async () => {
    // No unsupported family exists to open, so simulate one by removing the
    // knx-mbm descriptor: the family gate must reject with 422 and no upload.
    const saved = DEPLOY_FAMILIES["knx-mbm"];
    delete DEPLOY_FAMILIES["knx-mbm"];
    try {
      const meta = await loadDemoProject();
      await writeGenuineCapability("knxMbmXblVerified");
      const { sessions, uploads } = fakeSessions({ appId: 4 });

      const error = await deployProject(meta.id, "sess-1", { sessions, capabilitiesPath }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(DeployGateError);
      expect((error as DeployGateError).gate).toBe("family");
      expect((error as DeployGateError).status).toBe(422);
      expect(uploads).toHaveLength(0);
    } finally {
      DEPLOY_FAMILIES["knx-mbm"] = saved;
    }
  });

  it("blocks when the capability artefact is missing (403)", async () => {
    await openMeMbsProject();
    const { sessions, uploads } = fakeSessions({ appId: 64 });

    const error = await deployProject("p1", "sess-1", { sessions, capabilitiesPath }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DeployGateError);
    expect((error as DeployGateError).gate).toBe("capability");
    expect((error as DeployGateError).status).toBe(403);
    expect(uploads).toHaveLength(0);
  });

  it("rejects hand-forged capability entries", async () => {
    await openMeMbsProject();
    await mkdir(path.dirname(capabilitiesPath), { recursive: true });
    for (const forged of [true, { verifiedAt: "now" }, { projectSha256: "x".repeat(64) }]) {
      await writeFile(capabilitiesPath, JSON.stringify({ meMbsXblVerified: forged }));
      const { sessions, uploads } = fakeSessions({ appId: 64 });
      const error = await deployProject("p1", "sess-1", { sessions, capabilitiesPath }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(DeployGateError);
      expect((error as DeployGateError).gate).toBe("capability");
      expect(uploads).toHaveLength(0);
    }
  });

  it("blocks when the gateway AppId does not match the ME unit (409)", async () => {
    await openMeMbsProject();
    await writeGenuineCapability();
    const { sessions, uploads } = fakeSessions({ appId: 4 }); // KNX–MBM unit

    const error = await deployProject("p1", "sess-1", { sessions, capabilitiesPath }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DeployGateError);
    expect((error as DeployGateError).gate).toBe("session-appid");
    expect((error as DeployGateError).status).toBe(409);
    expect(uploads).toHaveLength(0);
  });

  it("blocks unknown sessions at the session gate (409)", async () => {
    await openMeMbsProject();
    await writeGenuineCapability();
    const { sessions } = fakeSessions({ known: false });

    const error = await deployProject("p1", "sess-1", { sessions, capabilitiesPath }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DeployGateError);
    expect((error as DeployGateError).gate).toBe("session-appid");
  });
});

describe("getDeployStatus", () => {
  it("reports each gate and the aggregate deployable flag", async () => {
    await openMeMbsProject();
    await writeGenuineCapability();
    const { sessions } = fakeSessions({ appId: 64 });

    const ok = await getDeployStatus("p1", "sess-1", { sessions, capabilitiesPath });
    expect(ok.deployable).toBe(true);
    expect(ok.checks.map((c) => c.id)).toEqual(["family", "capability", "session-appid", "project"]);

    await rm(capabilitiesPath);
    const blocked = await getDeployStatus("p1", "sess-1", { sessions, capabilitiesPath });
    expect(blocked.deployable).toBe(false);
    expect(blocked.checks.find((c) => c.id === "capability")?.ok).toBe(false);
  });

  it("blocks a me-mbs project with signals on the wrong Modbus slave (422)", async () => {
    // MULTIPLE slaves, alarm codes on, then another group: MAPS shifts the
    // alarm codes' SlaveIndex too, and the XBL would carry it as it is.
    const doc = XmlDocument.parse(SYNTHETIC_ME_MBS_EMPTY_XML);
    updateMbsConfigAndSignals(doc, { slaveAddressMode: 1 });
    updateGroupAndSignals(doc, 0, 0, { enabled: true });
    updateControllerAndSignals(doc, 0, { addErrorSignals: true });
    updateGroupAndSignals(doc, 0, 1, { enabled: true });
    await openIbmaps(doc.serialize(), { id: "p3", name: "ME project" });
    await writeGenuineCapability();
    const { sessions, uploads } = fakeSessions({ appId: 64 });

    const status = await getDeployStatus("p3", "sess-1", { sessions, capabilitiesPath });
    expect(status.deployable).toBe(false);
    expect(status.checks.find((c) => c.id === "project")?.detail).toMatch(/wrong slave/);
    const error = await deployProject("p3", "sess-1", { sessions, capabilitiesPath }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DeployGateError);
    expect((error as DeployGateError).gate).toBe("project");
    expect((error as DeployGateError).status).toBe(422);
    expect(uploads).toHaveLength(0);
    expect(() => generateMeMbsXbl(doc.serialize())).toThrow(/wrong slave/);
  });

  it.each([
    [
      "alarm codes shifted by a later group",
      (doc: XmlDocument) => {
        updateGroupAndSignals(doc, 0, 0, { enabled: true });
        updateControllerAndSignals(doc, 0, { addErrorSignals: true });
        updateGroupAndSignals(doc, 0, 1, { enabled: true });
      },
    ],
    [
      "the other controller after ModifyController",
      (doc: XmlDocument) => {
        updateGroupAndSignals(doc, 0, 0, { enabled: true });
        updateGroupAndSignals(doc, 1, 0, { enabled: true });
        updateControllerAndSignals(doc, 0, { addErrorSignals: true });
      },
    ],
  ])("unblocks the deploy once Single → Multiple rebuilds the slaves (%s)", async (_, stale) => {
    // Two controllers, with the conversions the XBL needs at the end.
    const doc = XmlDocument.parse(
      SYNTHETIC_ME_MBS_EMPTY_XML.replace(
        /(  <IBOX [^\r\n]*?) \/>/,
        `$1>\r\n    <Conversions>\r\n${CONVERSIONS}\r\n    </Conversions>\r\n${REMAP_LUTS}\r\n  </IBOX>`,
      ),
    );
    updateMbsConfigAndSignals(doc, { slaveAddressMode: 1 });
    stale(doc);
    await openIbmaps(doc.serialize(), { id: "p4", name: "ME project" });
    await writeGenuineCapability();
    const { sessions, uploads } = fakeSessions({ appId: 64 });
    expect((await getDeployStatus("p4", "sess-1", { sessions, capabilitiesPath })).deployable).toBe(false);

    await applyPatches("p4", [{ type: "updateMbsConfig", patch: { slaveAddressMode: 0 } }]);
    await applyPatches("p4", [{ type: "updateMbsConfig", patch: { slaveAddressMode: 1 } }]);

    const view = await getProjectView("p4");
    if (view.family !== "me-mbs") throw new Error("unreachable");
    expect(view.issues.map((i) => i.code)).not.toContain("MBS-SLAVE-INDEX");
    // Every Modbus signal sits on its own slave again; alarm codes keep the
    // MAPS format (SlaveIndex -1, the slave as the operation).
    const slaveOf = (description: string) => view.project.mbs.slaves.findIndex((x) => x.description === description);
    for (const signal of view.project.signals) {
      const c = signal.me.g50Index + 1;
      if (signal.me.unitId !== -1) {
        expect(signal.modbus.slaveIndex).toBe(-1);
        expect(signal.modbus.operations).toEqual([slaveOf(`Error Signals Controller ${c}`)]);
      } else {
        const own = signal.me.groupIndex === -1 ? `General Controller ${c}` : `C${c}G${signal.me.groupIndex + 1}`;
        expect(signal.modbus.slaveIndex).toBe(slaveOf(own));
      }
    }
    const status = await getDeployStatus("p4", "sess-1", { sessions, capabilitiesPath });
    expect(status.checks.find((c) => c.id === "project")?.ok).toBe(true);
    expect(status.deployable).toBe(true);
    await deployProject("p4", "sess-1", { sessions, capabilitiesPath });
    expect(uploads).toHaveLength(1);
  });

  it("resolves the knx-mbm descriptor (capability key and AppId 4)", async () => {
    await openKnxMbmProject();
    await writeGenuineCapability("knxMbmXblVerified");
    const { sessions } = fakeSessions({ appId: 4 });

    const ok = await getDeployStatus("k1", "sess-1", { sessions, capabilitiesPath });
    expect(ok.deployable).toBe(true);
    expect(ok.checks.map((c) => c.id)).toEqual(["family", "capability", "session-appid"]);
    expect(ok.checks[1].detail).toContain("knxMbmXblVerified");
    expect(ok.checks[2].detail).toContain("AppId 4");
  });
});

describe("deploy gates (knx-mbm)", () => {
  it("deploys a knx-mbm project when every gate passes, regenerating the XBL", async () => {
    await openKnxMbmProject();
    await writeGenuineCapability("knxMbmXblVerified");
    const { sessions, uploads } = fakeSessions({ appId: 4 });

    const result = await deployProject("k1", "sess-1", { sessions, capabilitiesPath });

    expect(uploads).toHaveLength(1);
    const blob = parseCompleteBlob(uploads[0]);
    // Same as the freshly generated XBL except the 6 volatile timestamp bytes.
    const expected = generateKnxMbmXbl(SYNTHETIC_KNX_MBM_XML, { now: new Date(), appId: 4 });
    expect(maskTimestamp(blob.xbl)).toEqual(maskTimestamp(expected));
    expect(result.bytes).toBe(uploads[0].length);
    expect(result.xblBytes).toBe(blob.xbl.length);
    expect(result.appId).toBe(4);
    expect(result.swVersion).toBe("1.2.31.0"); // no original blob → generator default
  });

  it("reuses the original blob's SW version when available", async () => {
    const originalXbl = generateKnxMbmXbl(SYNTHETIC_KNX_MBM_XML, {
      swVersion: [1, 2, 33, 0],
      now: new Date("2026-09-01T00:00:00"),
    });
    const originalBlob = buildCompleteBlob(
      originalXbl,
      buildProjectZip("k2.ibmaps", SYNTHETIC_KNX_MBM_XML),
    );
    await openCompleteBlob(originalBlob, { id: "k2", name: "KNX project" });
    await writeGenuineCapability("knxMbmXblVerified");
    const { sessions, uploads } = fakeSessions({ appId: 4 });

    const result = await deployProject("k2", "sess-1", { sessions, capabilitiesPath });
    expect(result.swVersion).toBe("1.2.33.0");
    // And the regenerated XBL actually carries that version in header tag 2.
    const header = decodeElements(parseCompleteBlob(uploads[0]).xbl).find(
      (el) => el.tag === 1 && el.kind === "container",
    );
    const sw = header?.children?.find((c) => c.tag === 2);
    expect(sw && Array.from(parseCompleteBlob(uploads[0]).xbl.subarray(sw.contentOffset, sw.contentOffset + 4))).toEqual([1, 2, 33, 0]);
  });

  it("blocks when the knx-mbm capability artefact is missing (403)", async () => {
    await openKnxMbmProject();
    const { sessions, uploads } = fakeSessions({ appId: 4 });

    const error = await deployProject("k1", "sess-1", { sessions, capabilitiesPath }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DeployGateError);
    expect((error as DeployGateError).gate).toBe("capability");
    expect((error as DeployGateError).status).toBe(403);
    expect(uploads).toHaveLength(0);
  });

  it("does not accept the other family's capability", async () => {
    await openKnxMbmProject();
    await writeGenuineCapability("meMbsXblVerified"); // wrong key for knx-mbm
    const { sessions, uploads } = fakeSessions({ appId: 4 });

    const error = await deployProject("k1", "sess-1", { sessions, capabilitiesPath }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DeployGateError);
    expect((error as DeployGateError).gate).toBe("capability");
    expect(uploads).toHaveLength(0);
  });

  it("rejects hand-forged knx-mbm capability entries", async () => {
    await openKnxMbmProject();
    await mkdir(path.dirname(capabilitiesPath), { recursive: true });
    for (const forged of [true, { verifiedAt: "now" }, { projectSha256: "x".repeat(64) }]) {
      await writeFile(capabilitiesPath, JSON.stringify({ knxMbmXblVerified: forged }));
      const { sessions, uploads } = fakeSessions({ appId: 4 });
      const error = await deployProject("k1", "sess-1", { sessions, capabilitiesPath }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(DeployGateError);
      expect((error as DeployGateError).gate).toBe("capability");
      expect(uploads).toHaveLength(0);
    }
  });

  it("blocks when the gateway AppId does not match the KNX–MBM unit (409)", async () => {
    await openKnxMbmProject();
    await writeGenuineCapability("knxMbmXblVerified");
    const { sessions, uploads } = fakeSessions({ appId: 64 }); // ME unit

    const error = await deployProject("k1", "sess-1", { sessions, capabilitiesPath }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DeployGateError);
    expect((error as DeployGateError).gate).toBe("session-appid");
    expect((error as DeployGateError).status).toBe(409);
    expect(uploads).toHaveLength(0);
  });

  it("blocks unknown sessions at the session gate (409)", async () => {
    await openKnxMbmProject();
    await writeGenuineCapability("knxMbmXblVerified");
    const { sessions } = fakeSessions({ known: false });

    const error = await deployProject("k1", "sess-1", { sessions, capabilitiesPath }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DeployGateError);
    expect((error as DeployGateError).gate).toBe("session-appid");
  });
});

/**
 * Byte-exact round-trip gate against the real KNX–MBM fixture (gitignored
 * under .local-data/ — it may contain credentials). Skipped when absent (CI).
 * Deploying the UNMODIFIED fixture project must regenerate an XBL identical
 * to the fixture's own XBL once the volatile 6-byte timestamp is masked.
 */
const REAL_KNX_BLOB = ".local-data/fixtures/knx-mbm-2026-09-01.bin";
const hasRealKnxFixture = existsSync(REAL_KNX_BLOB);

describe.skipIf(!hasRealKnxFixture)(
  "real KNX–MBM fixture round-trip (present only in the local checkout)",
  () => {
    it("deploy-build of the unmodified fixture project reproduces the fixture XBL (masked timestamp)", async () => {
      const fixtureBlob = new Uint8Array(readFileSync(REAL_KNX_BLOB));
      const fixtureXbl = parseCompleteBlob(fixtureBlob).xbl;
      await openCompleteBlob(fixtureBlob, { id: "knx-real", name: "IN701KNX fixture" });
      await writeGenuineCapability("knxMbmXblVerified");
      const { sessions, uploads } = fakeSessions({ appId: 4 });

      const result = await deployProject("knx-real", "sess-1", { sessions, capabilitiesPath });

      expect(uploads).toHaveLength(1);
      const deployedXbl = parseCompleteBlob(uploads[0]).xbl;
      expect(maskTimestamp(deployedXbl)).toEqual(maskTimestamp(fixtureXbl));
      expect(result.appId).toBe(4);
      // SW version recovered from the stored original blob header.
      expect(result.swVersion).toBe("1.2.33.0");
    });
  },
);
