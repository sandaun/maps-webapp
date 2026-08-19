import { mkdtemp, rm } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCompleteBlob, buildProjectZip, parseCompleteBlob } from "@/core/project-format";
import { decodeElements } from "@/core/xbl";
import { generateMeMbsXbl } from "@/gateway-families/me-mbs";
import { SYNTHETIC_ME_MBS_XML } from "@/gateway-families/me-mbs/fixtures/synthetic-project";
import type { GatewaySessions, GatewaySessionStatus } from "../intesis-transport";
import { resetProjectStoreForTests } from "../persistence";
import { loadDemoProject, openCompleteBlob, openIbmaps } from "../projects/service";
import { deployProject, DeployGateError, getDeployStatus } from "./service";

/**
 * Deploy gate tests (Pas 2.6): each gate blocks correctly and the happy path
 * regenerates the XBL before handing the blob to the session manager. No real
 * gateway: the `GatewaySessions` double only captures the upload.
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

async function writeGenuineCapability(): Promise<void> {
  const sha = "a".repeat(64);
  await writeFile(
    capabilitiesPath,
    JSON.stringify({
      meMbsXblVerified: {
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

  it("blocks knx-mbm projects at the family gate (422)", async () => {
    const meta = await loadDemoProject();
    await writeGenuineCapability();
    const { sessions, uploads } = fakeSessions({ appId: 64 });

    const error = await deployProject(meta.id, "sess-1", { sessions, capabilitiesPath }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DeployGateError);
    expect((error as DeployGateError).gate).toBe("family");
    expect((error as DeployGateError).status).toBe(422);
    expect(uploads).toHaveLength(0);
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
    expect(ok.checks.map((c) => c.id)).toEqual(["family", "capability", "session-appid"]);

    await rm(capabilitiesPath);
    const blocked = await getDeployStatus("p1", "sess-1", { sessions, capabilitiesPath });
    expect(blocked.deployable).toBe(false);
    expect(blocked.checks.find((c) => c.id === "capability")?.ok).toBe(false);
  });
});
