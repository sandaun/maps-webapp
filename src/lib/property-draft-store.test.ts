import { beforeEach, describe, expect, it, vi } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { familyById } from "@/server/projects/families";
import { projectFromXml as readKnx } from "@/gateway-families/knx-mbm";
import { projectFromXml as readMe } from "@/gateway-families/me-mbs";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { SYNTHETIC_ME_MBS_XML } from "@/gateway-families/me-mbs/fixtures/synthetic-project";
import type { FamilyId, ProjectView, ProjectPatchInput } from "./project-types";
import {
  buildPropertyPatches,
  propertyFields,
  validateField,
} from "./property-fields";
import {
  createPropertyDraftStore,
  DRAFT_STORAGE_PREFIX,
} from "./property-draft-store";

function fixture(family: FamilyId = "knx-mbm") {
  const doc = XmlDocument.parse(
    family === "knx-mbm" ? SYNTHETIC_KNX_MBM_XML : SYNTHETIC_ME_MBS_XML,
  );
  // Mirrors the server write counter: every applied batch bumps it.
  let revision = 1;
  const meta = () => ({
    id: family,
    family,
    name: "Test",
    description: "",
    source: "demo" as const,
    updatedAt: "2026-01-01",
    revision,
  });
  const view = (): ProjectView =>
    family === "knx-mbm"
      ? {
          family,
          meta: meta(),
          project: readKnx(doc),
          issues: [],
          hasCompleteBlob: false,
        }
      : {
          family,
          meta: meta(),
          project: readMe(doc),
          issues: [],
          hasCompleteBlob: false,
        };
  const patch = (patches: ProjectPatchInput[]) => {
    familyById(family).applyPatches(doc, patches);
    revision++;
    return view();
  };
  return { view, patch };
}
const field = (view: ProjectView, id: string) =>
  propertyFields(view).find((field) => field.id === id)!;
const store = () => {
  const result = createPropertyDraftStore();
  result.hydrate(() => localStorage);
  return result;
};

beforeEach(() => localStorage.clear());

describe("property drafts", () => {
  it("counts properties, removes reversions and keeps screens/projects separate", () => {
    const draft = store(),
      a = fixture().view(),
      b = fixture("me-mbs").view();
    draft.stage(a, field(a, "cfg-name"), "First");
    draft.stage(a, field(a, "cfg-name"), "Second");
    draft.stage(a, field(a, "rtu-0-baud"), 19200);
    draft.stage(b, field(b, "cfg-name"), "Other");
    expect(draft.editsFor(a.meta.id, "configuration")).toHaveLength(1);
    draft.stage(a, field(a, "cfg-name"), a.project.name);
    expect(draft.editsFor(a.meta.id, "configuration")).toHaveLength(0);
    expect(draft.editsFor(a.meta.id, "devices")).toHaveLength(1);
    expect(draft.editsFor(b.meta.id, "configuration")).toHaveLength(1);
  });

  it("recovers immediately persisted edits and discard clears only its scope", () => {
    const a = fixture().view(),
      first = store();
    first.stage(a, field(a, "cfg-name"), "Recover me");
    first.stage(a, field(a, "rtu-0-baud"), 19200);
    const recovered = store();
    recovered.reconcile(a);
    expect(recovered.editsFor(a.meta.id, "configuration")[0].value).toBe(
      "Recover me",
    );
    recovered.discard(a.meta.id, "configuration");
    expect(store().editsFor(a.meta.id, "configuration")).toHaveLength(0);
    expect(store().editsFor(a.meta.id, "devices")).toHaveLength(1);
  });

  it("builds one batch of minimal nested patches and preserves current siblings", () => {
    const a = fixture().view();
    const patches = buildPropertyPatches(
      propertyFields(a),
      {
        "cfg-name": "New name",
        "cfg-desc": "New description",
        "cfg-mbm-maxreg": "31",
        "cfg-mbm-deadband": "0.5",
        "rtu-0-baud": "19200",
      },
      a,
    );
    expect(patches).toEqual([
      {
        type: "setGeneralInfo",
        name: "New name",
        description: "New description",
      },
      {
        type: "updateMbmConfig",
        patch: { deadband: 0.5, pollRecords: { maxRegisters: 31 } },
      },
      { type: "updateRtuNode", nodeIndex: 0, patch: { baudrate: 19200 } },
    ]);
  });

  it("merges multiple slave edits into the latest complete array", () => {
    const f = fixture("me-mbs");
    const a = f.patch([
      {
        type: "updateMbsConfig",
        patch: {
          slaves: [
            { address: 1, description: "A" },
            { address: 2, description: "B" },
          ],
        },
      },
    ]);
    const patches = buildPropertyPatches(
      propertyFields(a),
      {
        "cfg-mbs-slaves-0-address": "7",
        "cfg-mbs-slaves-1-description": "Changed",
      },
      a,
    );
    expect(patches).toEqual([
      {
        type: "updateMbsConfig",
        patch: {
          slaves: [
            { address: 7, description: "A" },
            { address: 2, description: "Changed" },
          ],
        },
      },
    ]);
  });

  it("retains empty and invalid numbers across recovery and validates hidden fields", () => {
    const a = fixture().view(),
      draft = store();
    draft.stage(a, field(a, "cfg-mbm-maxreg"), "");
    draft.stage(a, field(a, "cfg-knx-address"), "99.99.999");
    const recovered = store();
    const prepared = recovered.prepare(a, "configuration");
    expect(prepared.invalid["cfg-mbm-maxreg"]).toBe("Enter a number.");
    expect(prepared.invalid["cfg-knx-address"]).toMatch(/area.line.device/);
    expect(prepared.patches).toHaveLength(0);
    expect(validateField(field(a, "cfg-mbm-deadband"), "0.25")).toBeUndefined();
    expect(validateField(field(a, "cfg-mbm-maxreg"), "1.5")).toBe(
      "Enter a whole number.",
    );
  });

  it("does not lose a staged name when a different property is saved immediately", () => {
    const f = fixture(),
      a = f.view(),
      draft = store();
    draft.stage(a, field(a, "cfg-name"), "Unsaved");
    const patches: ProjectPatchInput[] = [
      { type: "setGatewayInfo", dhcp: !a.project.gateway.dhcp },
    ];
    const next = f.patch(patches);
    draft.afterMutation(a, next, patches);
    expect(draft.editsFor(a.meta.id, "configuration")[0]).toMatchObject({
      value: "Unsaved",
      conflict: undefined,
    });
    expect(draft.prepare(next, "configuration").patches).toEqual([
      { type: "setGeneralInfo", name: "Unsaved" },
    ]);
  });

  it("recognizes a save completed before its response was lost", () => {
    const f = fixture(),
      a = f.view(),
      draft = store();
    draft.stage(a, field(a, "cfg-name"), "Saved");
    const next = f.patch([{ type: "setGeneralInfo", name: "Saved" }]);
    const recovered = store();
    recovered.reconcile(next);
    expect(recovered.editsFor(a.meta.id, "configuration")).toHaveLength(0);
    expect(
      localStorage.getItem(
        DRAFT_STORAGE_PREFIX + encodeURIComponent(a.meta.id),
      ),
    ).toBeNull();
  });

  it("retains changed baselines as conflicts until explicitly resolved", () => {
    const f = fixture(),
      a = f.view(),
      draft = store();
    draft.stage(a, field(a, "cfg-name"), "Mine");
    const next = f.patch([{ type: "setGeneralInfo", name: "Someone else's" }]);
    expect(
      draft.prepare(next, "configuration").invalid["cfg-name"],
    ).toBeDefined();
    expect(draft.editsFor(a.meta.id, "configuration")[0].conflict).toBe(
      "value",
    );
    draft.resolve(next, "cfg-name", true);
    expect(draft.prepare(next, "configuration").patches).toEqual([
      { type: "setGeneralInfo", name: "Mine" },
    ]);
  });

  it("remaps KNX drafts after a known node removal, without applying to its successor", () => {
    const f = fixture();
    const a = f.patch([{ type: "addTcpNode" }, { type: "addTcpNode" }]);
    if (a.family !== "knx-mbm") throw new Error();
    const index = a.project.mbm.tcpNodes.length - 1;
    const draft = store();
    draft.stage(a, field(a, `tcp-${index}-desc`), "Keep the last node");
    const patches: ProjectPatchInput[] = [
      { type: "removeNode", locator: { kind: "tcp", nodeIndex: 0 } },
    ];
    const next = f.patch(patches);
    draft.afterMutation(a, next, patches);
    expect(draft.editsFor(a.meta.id, "devices")[0]).toMatchObject({
      id: `tcp-${index - 1}-desc`,
      conflict: undefined,
    });
    expect(draft.prepare(next, "devices").patches).toEqual([
      {
        type: "updateTcpNode",
        nodeIndex: index - 1,
        patch: { description: "Keep the last node" },
      },
    ]);
  });

  it("remaps device drafts by position after a known device removal", () => {
    const f = fixture();
    const a = f.patch([
      { type: "addDevice", locator: { kind: "rtu", nodeIndex: 0 } },
      { type: "addDevice", locator: { kind: "rtu", nodeIndex: 0 } },
    ]);
    const draft = store();
    draft.stage(a, field(a, "rtu-0-device-1-name"), "Removed with its device");
    draft.stage(a, field(a, "rtu-0-device-2-name"), "Follows its device");
    const patches: ProjectPatchInput[] = [
      {
        type: "removeDevice",
        locator: { kind: "rtu", nodeIndex: 0 },
        deviceIndex: 1,
        signals: "delete",
      },
    ];
    const next = f.patch(patches);
    draft.afterMutation(a, next, patches);
    expect(draft.editsFor(a.meta.id, "devices")).toEqual([
      expect.objectContaining({ id: "rtu-0-device-1-name", conflict: undefined }),
    ]);
    expect(draft.prepare(next, "devices").patches).toEqual([
      {
        type: "updateDevice",
        locator: { kind: "rtu", nodeIndex: 0 },
        deviceIndex: 1,
        patch: { name: "Follows its device" },
      },
    ]);
  });

  it("blocks positional drafts after an unknown change even when the node and count look the same", () => {
    const f = fixture();
    const a = f.patch([{ type: "addTcpNode" }, { type: "addTcpNode" }]);
    const draft = store();
    draft.stage(a, field(a, "tcp-1-desc"), "For the old node");
    // Another session replaces the node at position 1: same count, same locator.
    const next = f.patch([
      { type: "removeNode", locator: { kind: "tcp", nodeIndex: 1 } },
      { type: "addTcpNode" },
    ]);
    draft.reconcile(next);
    expect(draft.editsFor(a.meta.id, "devices")[0].conflict).toBe("entity");
    draft.resolve(next, "tcp-1-desc", true);
    expect(draft.editsFor(a.meta.id, "devices")[0].conflict).toBe("entity");
    expect(draft.prepare(next, "devices").invalid["tcp-1-desc"]).toBeDefined();
  });

  it("keeps positional drafts across this client's own mutations of sibling entities", () => {
    const f = fixture();
    const a = f.patch([{ type: "addDevice", locator: { kind: "rtu", nodeIndex: 0 } }]);
    const draft = store();
    draft.stage(a, field(a, "rtu-0-baud"), 19200);
    const patches: ProjectPatchInput[] = [
      { type: "updateDevice", locator: { kind: "rtu", nodeIndex: 0 }, deviceIndex: 1, patch: { enabled: false } },
    ];
    const next = f.patch(patches);
    draft.afterMutation(a, next, patches);
    expect(draft.editsFor(a.meta.id, "devices")[0].conflict).toBeUndefined();
  });

  it("reconciles an unseen change before applying a known mutation", () => {
    const f = fixture(),
      a = f.view(),
      draft = store();
    draft.stage(a, field(a, "rtu-0-baud"), 19200);
    const unseen = f.patch([{ type: "setGeneralInfo", name: "Elsewhere" }]);
    const patches: ProjectPatchInput[] = [{ type: "setGatewayInfo", dhcp: true }];
    draft.afterMutation(unseen, f.patch(patches), patches);
    expect(draft.editsFor(a.meta.id, "devices")[0].conflict).toBe("entity");
  });

  it("recovers positional drafts only when the project revision did not move", () => {
    const f = fixture(),
      a = f.view();
    store().stage(a, field(a, "rtu-0-baud"), 19200);
    const sameRevision = store();
    sameRevision.reconcile(a);
    expect(sameRevision.editsFor(a.meta.id, "devices")[0].conflict).toBeUndefined();
    const moved = f.patch([{ type: "setGeneralInfo", name: "Elsewhere" }]);
    const afterMove = store();
    afterMove.reconcile(moved);
    expect(afterMove.editsFor(a.meta.id, "devices")[0].conflict).toBe("entity");
  });

  it("still offers Keep my edit for fields with a reliable identity", () => {
    const f = fixture(),
      a = f.view(),
      draft = store();
    draft.stage(a, field(a, "cfg-gw-name"), "Mine");
    draft.stage(a, field(a, "cfg-name"), "Untouched elsewhere");
    const next = f.patch([{ type: "setGatewayInfo", name: "Theirs" }]);
    draft.reconcile(next);
    const edits = Object.fromEntries(draft.editsFor(a.meta.id, "configuration").map((e) => [e.id, e.conflict]));
    expect(edits).toEqual({ "cfg-gw-name": "value", "cfg-name": undefined });
  });

  it("quarantines recovered positional entities that changed externally", () => {
    const f = fixture(),
      a = f.view(),
      draft = store();
    draft.stage(a, field(a, "rtu-0-baud"), 19200);
    const next = f.patch([
      { type: "updateRtuNode", nodeIndex: 0, patch: { parity: 2 } },
    ]);
    draft.reconcile(next);
    expect(draft.editsFor(a.meta.id, "devices")[0].conflict).toBe("entity");
    draft.resolve(next, "rtu-0-baud", true);
    expect(draft.prepare(next, "devices").patches).toHaveLength(0);
  });

  it("removes only a deleted slave's edits and remaps surviving list entries", () => {
    const f = fixture("me-mbs"),
      draft = store();
    const a = f.patch([
      {
        type: "updateMbsConfig",
        patch: {
          slaves: [
            { address: 1, description: "A" },
            { address: 2, description: "B" },
          ],
        },
      },
    ]);
    draft.stage(a, field(a, "cfg-mbs-slaves-0-description"), "Removed edit");
    draft.stage(a, field(a, "cfg-mbs-slaves-1-description"), "Keep edit");
    const patches: ProjectPatchInput[] = [
      {
        type: "updateMbsConfig",
        patch: { slaves: [{ address: 2, description: "B" }] },
      },
    ];
    const next = f.patch(patches);
    draft.afterMutation(a, next, patches);
    expect(draft.editsFor(a.meta.id, "configuration")).toHaveLength(1);
    expect(draft.editsFor(a.meta.id, "configuration")[0]).toMatchObject({
      id: "cfg-mbs-slaves-0-description",
      value: "Keep edit",
      conflict: undefined,
    });
  });

  it("keeps drafts when storage fails and reports recovery unavailability", () => {
    const broken = {
      length: 0,
      key: () => null,
      getItem: () => null,
      removeItem: vi.fn(),
      setItem: () => {
        throw new Error("Quota");
      },
    } as unknown as Storage;
    const draft = createPropertyDraftStore();
    draft.hydrate(() => broken);
    const a = fixture().view();
    draft.stage(a, field(a, "cfg-name"), "Still here");
    expect(draft.editsFor(a.meta.id, "configuration")[0].value).toBe(
      "Still here",
    );
    expect(draft.getSnapshot().storageWarning).toMatch(/unavailable/);
  });

  it("ignores malformed recovery records without crashing", () => {
    localStorage.setItem(DRAFT_STORAGE_PREFIX + "broken", "{oops");
    expect(store().getSnapshot()).toMatchObject({ ready: true, projects: {} });
  });
});
