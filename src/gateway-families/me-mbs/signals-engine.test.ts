import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { SYNTHETIC_ME_MBS_EMPTY_XML } from "./fixtures/synthetic-empty-project";
import { MeMbsSignalEngine, UnsupportedRegenerationError } from "./signals-engine";
import { updateController, updateGroup, updateMbsConfig, updateMeScalars } from "./xml-ops";
import { generateMeMbsXbl } from "./xbl";

/**
 * The engine's basic behaviour runs on a synthetic empty project (in Git).
 * On top of that, a reference gate against projects saved with the desktop
 * MAPS tool (.local-data/fixtures/me-mbs-maps-ref/, outside Git; skipped
 * when absent) and the real 770 Air fixture.
 *
 * The files are not one cumulative sequence. Each step below is the minimal
 * derivation from its parent that is compatible with the saved content —
 * not the proven history (see docs/reference/me-mbs-regeneracio-senyals.md §2).
 * Every step replays the MAPS handler the form would call, and the result is
 * compared signal by signal (every column, idxExternal included), as full XML
 * (MBSlavesArray and ProjectName excluded) and as generated XBL.
 */

const REF_DIR = ".local-data/fixtures/me-mbs-maps-ref";
const REAL_IBMAPS = ".local-data/fixtures/770air-me-mbs-2026-08-18.ibmaps.xml";
const NOW = new Date(2026, 0, 1, 12, 0, 0);

type RefName =
  | "base"
  | "grup-on"
  | "grup-off"
  | "grup-tipus"
  | "grup-fans"
  | "ctrl-errors"
  | "ctrl-2"
  | "consum";

interface Step {
  name: RefName;
  parent: RefName;
  apply: (doc: XmlDocument) => void;
}

/** Apply one MAPS handler on the document's signal lists. */
function regenerate(doc: XmlDocument, handler: (engine: MeMbsSignalEngine) => void): void {
  const engine = MeMbsSignalEngine.fromXml(doc);
  handler(engine);
  engine.writeTo(doc);
}

const STEPS: Step[] = [
  {
    name: "grup-on",
    parent: "base",
    apply: (doc) => {
      for (const group of [0, 1, 2]) {
        updateGroup(doc, 0, group, { enabled: true });
        regenerate(doc, (e) => e.enableGroup(0, group));
      }
    },
  },
  {
    name: "grup-off",
    parent: "grup-on",
    apply: (doc) => {
      updateGroup(doc, 0, 1, { enabled: false });
      regenerate(doc, (e) => e.enableGroup(0, 1));
    },
  },
  {
    // IC → BU: the form forces the fan speeds to 0 and saves both at once.
    name: "grup-tipus",
    parent: "grup-on",
    apply: (doc) => {
      updateGroup(doc, 0, 2, { type: 3, fanSpeeds: 0 });
      regenerate(doc, (e) => e.modifyGroupUpdate(0, 2));
    },
  },
  {
    name: "grup-fans",
    parent: "grup-tipus",
    apply: (doc) => {
      updateGroup(doc, 0, 2, { type: 1 });
      regenerate(doc, (e) => e.modifyGroupUpdate(0, 2));
    },
  },
  {
    // Order fixed by idxExternal: the fan change must come before the
    // controller regeneration, whose fresh general signals keep +1.
    name: "ctrl-errors",
    parent: "grup-fans",
    apply: (doc) => {
      updateGroup(doc, 0, 2, { fanSpeeds: 3 });
      regenerate(doc, (e) => e.modifyGroupUpdate(0, 2));
      updateController(doc, 0, { addErrorSignals: true });
      regenerate(doc, (e) => e.modifyController(0));
    },
  },
  {
    name: "ctrl-2",
    parent: "ctrl-errors",
    apply: (doc) => {
      updateGroup(doc, 1, 0, { enabled: true });
      regenerate(doc, (e) => e.enableGroup(1, 0));
    },
  },
  {
    name: "consum",
    parent: "ctrl-2",
    apply: (doc) => {
      updateMeScalars(doc, { consumptionEnabled: true });
      regenerate(doc, (e) => e.initializeAndRestore());
    },
  },
];

const hasRefs = existsSync(`${REF_DIR}/base.ibmaps`);

function loadRef(name: RefName): XmlDocument {
  return XmlDocument.parse(readFileSync(`${REF_DIR}/${name}.ibmaps`, "utf8"));
}

/** The derived slave list is out of scope; the project name is the file name. */
function normalize(xml: string): string {
  return xml
    .replace(/\r\n *(<MBSlavesArray>[\s\S]*?<\/MBSlavesArray>|<MBSlavesArray \/>)/, "")
    .replace(/ ProjectName="[^"]*"/, "");
}

function expectMatchesRef(doc: XmlDocument, name: RefName): void {
  const ref = loadRef(name);
  const ours = MeMbsSignalEngine.fromXml(doc);
  const theirs = MeMbsSignalEngine.fromXml(ref);
  expect(ours.mbs.length).toBe(theirs.mbs.length);
  ours.mbs.forEach((signal, i) => expect({ i, ...signal }).toEqual({ i, ...theirs.mbs[i] }));
  ours.me.forEach((signal, i) => expect({ i, ...signal }).toEqual({ i, ...theirs.me[i] }));

  expect(normalize(doc.serialize())).toBe(normalize(ref.serialize()));

  // Same project name so only the content differs; our slave list is kept.
  const ourXml = doc.serialize().replace(/ ProjectName="[^"]*"/, ` ProjectName="${ref.getAttr([], "ProjectName")}"`);
  if (ours.model.consumption.enabled) {
    // The XBL generator still refuses the consumption function (pending, own
    // branch: docs/plans/gaps-families-v11.md).
    expect(() => generateMeMbsXbl(ourXml, { now: NOW })).toThrow(/consumption/);
    expect(() => generateMeMbsXbl(ref.serialize(), { now: NOW })).toThrow(/consumption/);
    return;
  }
  expect(generateMeMbsXbl(ourXml, { now: NOW })).toEqual(generateMeMbsXbl(ref.serialize(), { now: NOW }));
}

// --- synthetic project (no local fixtures) ------------------------------------------

function emptyProject(): XmlDocument {
  return XmlDocument.parse(SYNTHETIC_ME_MBS_EMPTY_XML);
}

function setGroupEnabled(doc: XmlDocument, controller: number, group: number, enabled: boolean): void {
  updateGroup(doc, controller, group, { enabled });
  regenerate(doc, (e) => e.enableGroup(controller, group));
}

/** Index of the first signal matching the ME identity. */
function indexOf(engine: MeMbsSignalEngine, controller: number, group: number, spec: number, unit = -1): number {
  const i = engine.me.findIndex(
    (x) => x.g50Id === controller && x.groupId === group && x.signalSpecIndex === spec && x.unitId === unit,
  );
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
}

/** Signals of one block: [first idxConfig, count]. */
function block(engine: MeMbsSignalEngine, controller: number, group: number): [number, number] {
  const ids = engine.me.filter((x) => x.g50Id === controller && x.groupId === group && x.unitId === -1).map((x) => x.configId);
  return [ids[0], ids.length];
}

/** The ME idxExternal offsets (idxExternal - idxConfig) of a range. */
function externalOffsets(engine: MeMbsSignalEngine, from: number, count: number): number[] {
  return [...new Set(engine.me.slice(from, from + count).map((x) => x.externalId - x.configId))];
}

/** Add a `<HvacAddresses>` entry, placed where MAPS writes it. */
function withHvacAddress(doc: XmlDocument, attrs: string): XmlDocument {
  const xml = doc.serialize().replace(
    "  </ExternalProtocol>\r\n",
    `  </ExternalProtocol>\r\n  <HvacAddresses>\r\n    <UserAddress ${attrs} />\r\n  </HvacAddresses>\r\n`,
  );
  return XmlDocument.parse(xml);
}

describe("ME-MBS signal engine", () => {
  it("creates the controller signals and the group signals on the first enable", () => {
    const doc = emptyProject();
    setGroupEnabled(doc, 0, 0, true);
    const e = MeMbsSignalEngine.fromXml(doc);
    expect(e.mbs.length).toBe(64);
    expect(e.me.length).toBe(64);
    // CreateMEObject(idx++, idx, …) on the 30 generals.
    expect(externalOffsets(e, 0, 30)).toEqual([1]);
    expect(externalOffsets(e, 30, 34)).toEqual([0]);
    expect(e.mbs.every((x, i) => x.configId === i && x.externalId === i)).toBe(true);
    expect(e.mbs[0]).toMatchObject({
      description: "Centralized controller communication error  [0-Ok, 1-Communication error]",
      address: 0,
      readWrite: 0,
      isVirtual: true,
      isGeneral: true,
    });
    expect(e.mbs[29]).toMatchObject({ address: 27, operations: [{ index: 0, inverted: true }] });
    expect(e.me[0]).toMatchObject({ signalIndex: 9, signalSpecIndex: 0, isStatus: true, groupId: -1 });
    expect(e.mbs[30]).toMatchObject({ description: "On/Off  [0-Off, 1-On]", address: 100, readWrite: 2 });
    expect(e.mbs[indexOf(e, 0, 0, 4)]).toMatchObject({ address: 102, operations: [{ index: 17, inverted: false }] });
    expect(e.me[indexOf(e, 0, 0, 4)].operations).toEqual([{ index: 17, inverted: true }]);
  });

  it.each([
    ["IC, 4 fan speeds", 0, 4, 34],
    ["BU", 3, 0, 18],
    ["LC, no fan speed", 1, 0, 14],
    ["LC, 3 fan speeds", 1, 3, 15],
    ["system component", 6, 4, 0],
  ])("creates the group signals of a %s group", (_, type, fanSpeeds, expected) => {
    const doc = emptyProject();
    updateGroup(doc, 0, 0, { type: type as 0 | 1 | 3 | 6, fanSpeeds });
    setGroupEnabled(doc, 0, 0, true);
    const e = MeMbsSignalEngine.fromXml(doc);
    expect(e.me.filter((x) => x.groupId === 0).length).toBe(expected);
    expect(e.me.length).toBe(30 + expected);
  });

  it("renumbers every signal after deleting a group", () => {
    const doc = emptyProject();
    for (const group of [0, 1, 2]) setGroupEnabled(doc, 0, group, true);
    const g3Before = MeMbsSignalEngine.fromXml(doc).mbs.slice(98).map((x) => x.address);
    setGroupEnabled(doc, 0, 1, false);
    const e = MeMbsSignalEngine.fromXml(doc);
    expect(e.me.length).toBe(98);
    expect(e.me.every((x, i) => x.configId === i && x.externalId === i)).toBe(true);
    // The unchanged block keeps its content; only its identifiers move.
    expect(block(e, 0, 2)).toEqual([64, 34]);
    expect(e.mbs.slice(64).map((x) => x.address)).toEqual(g3Before);
  });

  it("gives the dirty-filter reset of a group inserted before another idxExternal = MeObjects.Count", () => {
    const doc = emptyProject();
    setGroupEnabled(doc, 0, 1, true);
    setGroupEnabled(doc, 0, 0, true);
    const e = MeMbsSignalEngine.fromXml(doc);
    expect(block(e, 0, 0)).toEqual([30, 34]);
    expect(block(e, 0, 1)).toEqual([64, 34]);
    const filterReset = indexOf(e, 0, 0, 46);
    expect(filterReset).toBe(63);
    // 30 generals + 34 of G2 + the 33 of G1 created before it.
    expect(e.me[filterReset].externalId).toBe(97);
    expect(externalOffsets(e, 30, 33)).toEqual([0]);
    expect(externalOffsets(e, 64, 34)).toEqual([0]);
    expect(externalOffsets(e, 0, 30)).toEqual([1]);
  });

  it("adds the error signals at the end of the controller block", () => {
    const doc = emptyProject();
    updateController(doc, 0, { addErrorSignals: true });
    setGroupEnabled(doc, 0, 0, true);
    let e = MeMbsSignalEngine.fromXml(doc);
    expect(e.me.length).toBe(164);
    const indoor1 = indexOf(e, 0, -1, 0, 0);
    const outdoor1 = indexOf(e, 0, -1, 0, 50);
    expect([indoor1, outdoor1]).toEqual([64, 114]);
    expect(e.mbs[indoor1]).toMatchObject({ description: "AlarmCode Indoor unit 1 [0..9999]", address: 21001, format: 1 });
    expect(e.mbs[outdoor1]).toMatchObject({ description: "AlarmCode Outdoor unit 1 [0..9999]", address: 21051 });
    expect(e.me[indoor1].isIndoor).toBe(true);
    expect(e.me[outdoor1].isIndoor).toBe(false);

    setGroupEnabled(doc, 0, 1, true);
    e = MeMbsSignalEngine.fromXml(doc);
    expect(block(e, 0, 1)).toEqual([64, 34]);
    expect(indexOf(e, 0, -1, 0, 0)).toBe(98);
  });

  it("keeps the second controller after the first one", () => {
    const doc = emptyProject();
    setGroupEnabled(doc, 1, 0, true);
    setGroupEnabled(doc, 0, 0, true);
    const e = MeMbsSignalEngine.fromXml(doc);
    expect(block(e, 0, -1)).toEqual([0, 30]);
    expect(block(e, 1, -1)).toEqual([64, 30]);
    expect(e.mbs[64].address).toBe(30);
    expect(e.mbs[94].address).toBe(5100);
    // IncrementIdxConfig resets the shifted generals' idxExternal.
    expect(externalOffsets(e, 0, 30)).toEqual([1]);
    expect(externalOffsets(e, 64, 30)).toEqual([0]);
  });

  it("ignores ModifyGroupUpdate on a disabled group", () => {
    const doc = emptyProject();
    setGroupEnabled(doc, 0, 0, true);
    const before = doc.serialize();
    updateGroup(doc, 0, 1, { type: 3, fanSpeeds: 0 });
    regenerate(doc, (e) => e.modifyGroupUpdate(0, 1));
    const after = MeMbsSignalEngine.fromXml(doc);
    const original = MeMbsSignalEngine.fromXml(XmlDocument.parse(before));
    expect(after.mbs).toEqual(original.mbs);
    expect(after.me).toEqual(original.me);
  });

  it("adds the consumption signals on a full regeneration", () => {
    const doc = emptyProject();
    setGroupEnabled(doc, 0, 0, true);
    updateMeScalars(doc, { consumptionEnabled: true });
    regenerate(doc, (e) => e.initializeAndRestore());
    const e = MeMbsSignalEngine.fromXml(doc);
    expect(e.me.length).toBe(67);
    expect(e.mbs.slice(64).map((x) => [x.address, x.dataLength, x.description])).toEqual([
      [138, 32, "Consumption Yesterday [Wh]"],
      [140, 32, "Consumption Today [Wh]"],
      [142, 32, "Consumption Total [Wh]"],
    ]);
  });

  it("writes an empty <Signals /> once the last group is disabled", () => {
    const doc = emptyProject();
    setGroupEnabled(doc, 0, 0, true);
    setGroupEnabled(doc, 0, 0, false);
    expect(doc.serialize()).toBe(SYNTHETIC_ME_MBS_EMPTY_XML);
  });

  it("rewrites unchanged signals byte for byte", () => {
    const doc = emptyProject();
    updateController(doc, 0, { addErrorSignals: true });
    for (const group of [0, 1]) setGroupEnabled(doc, 0, group, true);
    setGroupEnabled(doc, 1, 0, true);
    const before = doc.serialize();
    MeMbsSignalEngine.fromXml(doc).writeTo(doc);
    expect(doc.serialize()).toBe(before);
  });

  it("rejects regeneration outside FIXED address mode and single slave", () => {
    for (const patch of [{ addressMode: 1 }, { addressMode: 2 }, { slaveAddressMode: 1 }] as const) {
      const doc = emptyProject();
      updateMbsConfig(doc, patch);
      updateGroup(doc, 0, 0, { enabled: true });
      expect(() => regenerate(doc, (e) => e.enableGroup(0, 0))).toThrow(UnsupportedRegenerationError);
    }
  });

  describe("user configuration", () => {
    it("recreates a signal disabled in HvacAddresses as disabled (GetActiveFromUnit)", () => {
      const base = emptyProject();
      for (const group of [0, 1, 2]) setGroupEnabled(base, 0, group, true);
      // Vane position (spec 6) of G3, disabled by the user in MAPS.
      const doc = withHvacAddress(
        base,
        'RequiresCustom="False" Enabled="False" Address="303" Type="0" SignalIndex="6" HvacUnitIndex="2" Port="0" OUIndex="-1"',
      );
      updateGroup(doc, 0, 2, { fanSpeeds: 3 });
      regenerate(doc, (e) => e.modifyGroupUpdate(0, 2));
      const e = MeMbsSignalEngine.fromXml(doc);
      expect(e.mbs[indexOf(e, 0, 2, 6)].isEnabled).toBe(false);
      expect(e.mbs[indexOf(e, 0, 1, 6)].isEnabled).toBe(true);
    });

    it("loses isEnabled on a group regeneration without HvacAddresses, like MAPS", () => {
      const doc = emptyProject();
      setGroupEnabled(doc, 0, 0, true);
      const engine = MeMbsSignalEngine.fromXml(doc);
      engine.mbs[indexOf(engine, 0, 0, 6)].isEnabled = false;
      engine.writeTo(doc);
      updateGroup(doc, 0, 0, { fanSpeeds: 3 });
      regenerate(doc, (e) => e.modifyGroupUpdate(0, 0));
      const e = MeMbsSignalEngine.fromXml(doc);
      expect(e.mbs[indexOf(e, 0, 0, 6)].isEnabled).toBe(true);
    });

    it("keeps isEnabled across a full regeneration, alarm codes included (RestoreUserConfig)", () => {
      const doc = emptyProject();
      updateController(doc, 0, { addErrorSignals: true });
      setGroupEnabled(doc, 0, 0, true);
      const engine = MeMbsSignalEngine.fromXml(doc);
      engine.mbs[indexOf(engine, 0, 0, 6)].isEnabled = false;
      engine.mbs[indexOf(engine, 0, -1, 0, 4)].isEnabled = false; // AlarmCode Indoor unit 5
      engine.writeTo(doc);
      updateMeScalars(doc, { consumptionEnabled: true });
      regenerate(doc, (e) => e.initializeAndRestore());
      const e = MeMbsSignalEngine.fromXml(doc);
      expect(e.mbs[indexOf(e, 0, 0, 6)].isEnabled).toBe(false);
      expect(e.mbs[indexOf(e, 0, -1, 0, 4)].isEnabled).toBe(false);
      expect(e.mbs.filter((x) => !x.isEnabled).length).toBe(2);
    });

    it("does not bring alarm codes back through HvacAddresses, like MAPS", () => {
      const base = emptyProject();
      updateController(base, 0, { addErrorSignals: true });
      setGroupEnabled(base, 0, 0, true);
      // What StoreUserAddress writes for an edited alarm-code row of
      // controller 0: HvacUnitIndex = GroupID = -1, OUIndex = -1.
      const doc = withHvacAddress(
        base,
        'RequiresCustom="False" Enabled="False" Address="21005" Type="0" SignalIndex="0" HvacUnitIndex="-1" Port="0" OUIndex="-1"',
      );
      regenerate(doc, (e) => e.modifyController(0));
      const e = MeMbsSignalEngine.fromXml(doc);
      // The key is general spec 0's, which takes the edit instead.
      expect(e.mbs[indexOf(e, 0, -1, 0)].isEnabled).toBe(false);
      expect(e.me.filter((x) => x.unitId !== -1).every((_, i) => e.mbs[64 + i].isEnabled)).toBe(true);
    });
  });
});

describe.skipIf(!hasRefs)("ME-MBS signal regeneration vs MAPS reference files", () => {
  for (const step of STEPS) {
    it(`${step.parent} → ${step.name}`, () => {
      const doc = loadRef(step.parent);
      step.apply(doc);
      expectMatchesRef(doc, step.name);
    });
  }

  it("replays the whole derivation from base, keeping the history", () => {
    const docs = new Map<RefName, XmlDocument>([["base", loadRef("base")]]);
    for (const step of STEPS) {
      const doc = XmlDocument.parse(docs.get(step.parent)!.serialize());
      step.apply(doc);
      expectMatchesRef(doc, step.name);
      docs.set(step.name, doc);
    }
  });

  it("rewrites unchanged signals byte for byte", () => {
    for (const name of ["grup-on", "ctrl-errors", "consum"] as const) {
      const doc = loadRef(name);
      const before = doc.serialize();
      MeMbsSignalEngine.fromXml(doc).writeTo(doc);
      expect(doc.serialize()).toBe(before);
    }
  });

  it("writes an empty <Signals /> once the last group is disabled", () => {
    const doc = loadRef("grup-off");
    for (const group of [0, 2]) {
      updateGroup(doc, 0, group, { enabled: false });
      regenerate(doc, (e) => e.enableGroup(0, group));
    }
    expect(normalize(doc.serialize())).toBe(normalize(loadRef("base").serialize()));
  });

  it("ignores ModifyGroupUpdate on a disabled group", () => {
    const doc = loadRef("grup-off");
    const before = MeMbsSignalEngine.fromXml(doc);
    updateGroup(doc, 0, 1, { type: 3, fanSpeeds: 0 });
    regenerate(doc, (e) => e.modifyGroupUpdate(0, 1));
    const after = MeMbsSignalEngine.fromXml(doc);
    expect(after.mbs).toEqual(before.mbs);
    expect(after.me).toEqual(before.me);
  });
});

describe.skipIf(!existsSync(REAL_IBMAPS))("ME-MBS signal engine on the real 770 Air fixture", () => {
  const load = () => XmlDocument.parse(readFileSync(REAL_IBMAPS, "utf8"));

  it("round-trips the signal sections byte for byte", () => {
    const doc = load();
    const before = doc.serialize();
    MeMbsSignalEngine.fromXml(doc).writeTo(doc);
    expect(doc.serialize()).toBe(before);
  });

  it("regenerates the same signals from the model, idxExternal included", () => {
    const doc = load();
    const original = MeMbsSignalEngine.fromXml(doc);
    const engine = MeMbsSignalEngine.fromXml(doc);
    engine.initializeAndRestore();
    expect(engine.mbs).toEqual(original.mbs);
    expect(engine.me).toEqual(original.me);
    const before = doc.serialize();
    engine.writeTo(doc);
    expect(doc.serialize()).toBe(before);
  });
});
