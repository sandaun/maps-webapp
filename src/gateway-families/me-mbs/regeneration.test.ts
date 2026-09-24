import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { SYNTHETIC_ME_MBS_EMPTY_XML } from "./fixtures/synthetic-empty-project";
import { readMbsConfig, readMeConfig } from "./from-xml";
import {
  regenerateSignals,
  updateControllerAndSignals,
  updateGroupAndSignals,
  updateMbsConfigAndSignals,
  updateMeScalarsAndSignals,
} from "./regeneration";
import { MeMbsSignalEngine, UnsupportedRegenerationError } from "./signals-engine";
import { updateMbsConfig } from "./xml-ops";

/**
 * The model patches wired to MAPS' handlers (regeneration.ts). The engine
 * itself is covered by signals-engine.test.ts; here, which handler each edit
 * runs, the form rules applied with it, and a replay of the MAPS reference
 * files through the same functions the API uses.
 */

const REF_DIR = ".local-data/fixtures/me-mbs-maps-ref";

function emptyProject(): XmlDocument {
  return XmlDocument.parse(SYNTHETIC_ME_MBS_EMPTY_XML);
}

const engineOf = (doc: XmlDocument) => MeMbsSignalEngine.fromXml(doc);

function groupSignals(doc: XmlDocument, controller: number, group: number) {
  return engineOf(doc).me.filter((x) => x.g50Id === controller && x.groupId === group && x.unitId === -1);
}

/** Disable the Modbus signal of a group spec, as a signal-table edit would. */
function disableSignal(doc: XmlDocument, group: number, spec: number): void {
  regenerateSignals(doc, (e) => {
    const i = e.me.findIndex((x) => x.g50Id === 0 && x.groupId === group && x.signalSpecIndex === spec);
    e.mbs[i].isEnabled = false;
  });
}

/** Both signal lists, every column. */
function signalsOf(doc: XmlDocument) {
  const { mbs, me } = engineOf(doc);
  return { mbs, me };
}

const disabledCount = (doc: XmlDocument) => engineOf(doc).mbs.filter((x) => !x.isEnabled).length;

describe("ME-MBS model patches → MAPS handlers", () => {
  describe("groups", () => {
    it("creates and deletes the signals when the group is enabled or disabled (EnableGroup)", () => {
      const doc = emptyProject();
      updateGroupAndSignals(doc, 0, 0, { enabled: true });
      expect(engineOf(doc).me).toHaveLength(64);
      updateGroupAndSignals(doc, 0, 0, { enabled: false });
      expect(engineOf(doc).me).toHaveLength(0);
    });

    it("does nothing when the enabled flag does not change", () => {
      const doc = emptyProject();
      updateGroupAndSignals(doc, 0, 0, { enabled: true });
      const before = doc.serialize();
      updateGroupAndSignals(doc, 0, 0, { enabled: true });
      updateGroupAndSignals(doc, 0, 0, { type: 0, fanSpeeds: 4 });
      expect(doc.serialize()).toBe(before);
    });

    it("regenerates an enabled group when a signal field changes (ModifyGroupUpdate)", () => {
      for (const patch of [{ description: "Office" }, { fanSpeeds: 3 }, { dualSetPoint: false }, { urc: true }]) {
        const doc = emptyProject();
        updateGroupAndSignals(doc, 0, 0, { enabled: true });
        disableSignal(doc, 0, 6);
        updateGroupAndSignals(doc, 0, 0, patch);
        // Recreated from the model: the table edit is gone, like in MAPS.
        expect(disabledCount(doc)).toBe(0);
      }
    });

    it("keeps the signals when only the capacity changes", () => {
      const doc = emptyProject();
      updateGroupAndSignals(doc, 0, 0, { enabled: true });
      disableSignal(doc, 0, 6);
      const before = signalsOf(doc);
      updateGroupAndSignals(doc, 0, 0, { capacity: 12 });
      expect(signalsOf(doc)).toEqual(before);
    });

    it("forces 0 fan speeds for BU, WH and CEH groups, like the MAPS form", () => {
      const doc = emptyProject();
      updateGroupAndSignals(doc, 0, 0, { enabled: true });
      updateGroupAndSignals(doc, 0, 0, { type: 3 });
      expect(readMeConfig(doc).controllers[0].groups[0].fanSpeeds).toBe(0);
      expect(groupSignals(doc, 0, 0)).toHaveLength(18);
      // Back to LC the fan speeds stay 0 (reference file grup-fans).
      updateGroupAndSignals(doc, 0, 0, { type: 1 });
      expect(groupSignals(doc, 0, 0)).toHaveLength(14);
    });
  });

  describe("controllers", () => {
    it("does not regenerate for description, IP, port, type or the enabled flag", () => {
      const doc = emptyProject();
      updateGroupAndSignals(doc, 0, 0, { enabled: true });
      disableSignal(doc, 0, 6);
      updateControllerAndSignals(doc, 0, { description: "VRF", ip: "10.0.0.2", port: 81, type: 1, enabled: true });
      expect(disabledCount(doc)).toBe(1);
    });

    it("adds and removes the error signals (ModifyController)", () => {
      const doc = emptyProject();
      updateGroupAndSignals(doc, 0, 0, { enabled: true });
      updateControllerAndSignals(doc, 0, { addErrorSignals: true });
      expect(engineOf(doc).me).toHaveLength(164);
      updateControllerAndSignals(doc, 0, { addErrorSignals: false });
      expect(engineOf(doc).me).toHaveLength(64);
    });

    it("only stores the flags of a controller without enabled groups", () => {
      const doc = emptyProject();
      updateControllerAndSignals(doc, 0, { addErrorSignals: true, model: 1 });
      expect(engineOf(doc).me).toHaveLength(0);
      expect(readMeConfig(doc).controllers[0]).toMatchObject({ addErrorSignals: true, model: 1 });
    });

    it("applies the MAPS model rules to the compatibility and the groups", () => {
      const doc = emptyProject();
      updateGroupAndSignals(doc, 0, 0, { enabled: true, urc: true });
      // AG-150: old compatibility, no URC and no dual setpoint.
      updateControllerAndSignals(doc, 0, { model: 0 });
      let controller = readMeConfig(doc).controllers[0];
      expect(controller.compatibility).toBe(1);
      expect(controller.groups.every((g) => !g.urc && !g.dualSetPoint)).toBe(true);
      expect(groupSignals(doc, 0, 0)).toHaveLength(25);
      // Any other model resets the compatibility to the new one.
      updateControllerAndSignals(doc, 0, { model: 2 });
      controller = readMeConfig(doc).controllers[0];
      expect(controller.compatibility).toBe(0);
      expect(groupSignals(doc, 0, 0)).toHaveLength(29);
      // The old compatibility clears the dual setpoint.
      updateGroupAndSignals(doc, 0, 0, { dualSetPoint: true });
      updateControllerAndSignals(doc, 0, { compatibility: 1 });
      expect(readMeConfig(doc).controllers[0].groups[0].dualSetPoint).toBe(false);
      expect(groupSignals(doc, 0, 0)).toHaveLength(26);
    });
  });

  describe("global parameters", () => {
    it("regenerates everything and restores the activation on a temperature unit change", () => {
      const doc = emptyProject();
      updateGroupAndSignals(doc, 0, 0, { enabled: true });
      disableSignal(doc, 0, 6);
      updateMeScalarsAndSignals(doc, { temperatureMode: 1, pollPeriod: 300 });
      const e = engineOf(doc);
      expect(e.mbs[e.me.findIndex((x) => x.groupId === 0 && x.signalSpecIndex === 9)].description).toBe(
        "Ambient Temperature (x10ºF)  [32..211,82 ºF]",
      );
      expect(disabledCount(doc)).toBe(1);
    });

    it("adds the consumption signals and restores the activation", () => {
      const doc = emptyProject();
      updateGroupAndSignals(doc, 0, 0, { enabled: true });
      disableSignal(doc, 0, 6);
      updateMeScalarsAndSignals(doc, { consumptionEnabled: true });
      expect(groupSignals(doc, 0, 0)).toHaveLength(37);
      expect(disabledCount(doc)).toBe(1);
    });

    it("leaves the signals alone for polling and timeouts", () => {
      const doc = emptyProject();
      updateGroupAndSignals(doc, 0, 0, { enabled: true });
      updateGroupAndSignals(doc, 0, 0, { enabled: false });
      updateGroupAndSignals(doc, 0, 1, { enabled: true });
      const before = signalsOf(doc);
      updateMeScalarsAndSignals(doc, { pollPeriod: 300, ansTimeout: 40, controllerTout: 40, writeMaxBurst: 3 });
      expect(signalsOf(doc)).toEqual(before);
    });
  });

  describe("Modbus address and slave modes", () => {
    it("switches to CUSTOM without touching the signals, and back to FIXED regenerating them", () => {
      const doc = emptyProject();
      updateGroupAndSignals(doc, 0, 0, { enabled: true });
      disableSignal(doc, 0, 6);
      updateMbsConfig(doc, { registerBase: 1 });
      updateMbsConfigAndSignals(doc, { addressMode: 1 });
      expect(readMbsConfig(doc).registerBase).toBe(0);
      expect(disabledCount(doc)).toBe(1);
      // No RestoreUserConfig here (AddressModeChanged → InitializeControllers).
      updateMbsConfigAndSignals(doc, { addressMode: 0 });
      expect(disabledCount(doc)).toBe(0);
      expect(engineOf(doc).me).toHaveLength(64);
    });

    it("drops the stored user addresses when switching back to FIXED", () => {
      const xml = emptyProject()
        .serialize()
        .replace(
          "  </ExternalProtocol>\r\n",
          '  </ExternalProtocol>\r\n  <HvacAddresses>\r\n    <UserAddress RequiresCustom="True" Enabled="True" Address="4000" Type="0" SignalIndex="0" HvacUnitIndex="0" Port="0" OUIndex="-1" />\r\n  </HvacAddresses>\r\n',
        );
      const doc = XmlDocument.parse(xml);
      updateMbsConfig(doc, { addressMode: 1 });
      updateMbsConfigAndSignals(doc, { addressMode: 0 });
      expect(doc.serialize()).toBe(emptyProject().serialize());
    });

    it("rejects V4 compatibility and multiple slaves, which regenerate the signals", () => {
      for (const patch of [{ addressMode: 2 }, { slaveAddressMode: 1 }] as const) {
        const doc = emptyProject();
        updateGroupAndSignals(doc, 0, 0, { enabled: true });
        expect(() => updateMbsConfigAndSignals(doc, patch)).toThrow(UnsupportedRegenerationError);
      }
    });

    it("regenerates controller by controller when switching back to a single slave", () => {
      const doc = emptyProject();
      updateGroupAndSignals(doc, 0, 0, { enabled: true });
      updateGroupAndSignals(doc, 1, 0, { enabled: true });
      disableSignal(doc, 0, 6);
      updateMbsConfig(doc, { slaveAddressMode: 1 });
      updateMbsConfigAndSignals(doc, { slaveAddressMode: 0 });
      const e = engineOf(doc);
      // Recreating C2 deletes its signals first, which renumbers C1's generals.
      expect(new Set(e.me.slice(0, 30).map((x) => x.externalId - x.configId))).toEqual(new Set([0]));
      expect(new Set(e.me.slice(64, 94).map((x) => x.externalId - x.configId))).toEqual(new Set([1]));
      expect(disabledCount(doc)).toBe(1);
    });
  });
});

type RefName = "base" | "grup-on" | "grup-off" | "grup-tipus" | "grup-fans" | "ctrl-errors" | "ctrl-2" | "consum";

/** The reference derivation (signals-engine.test.ts), as the API patches send it. */
const PATCH_STEPS: Array<{ name: RefName; parent: RefName; apply: (doc: XmlDocument) => void }> = [
  { name: "grup-on", parent: "base", apply: (d) => [0, 1, 2].forEach((g) => updateGroupAndSignals(d, 0, g, { enabled: true })) },
  { name: "grup-off", parent: "grup-on", apply: (d) => updateGroupAndSignals(d, 0, 1, { enabled: false }) },
  // The type alone: the fan speeds follow the form rule.
  { name: "grup-tipus", parent: "grup-on", apply: (d) => updateGroupAndSignals(d, 0, 2, { type: 3 }) },
  { name: "grup-fans", parent: "grup-tipus", apply: (d) => updateGroupAndSignals(d, 0, 2, { type: 1 }) },
  {
    name: "ctrl-errors",
    parent: "grup-fans",
    apply: (d) => {
      updateGroupAndSignals(d, 0, 2, { fanSpeeds: 3 });
      updateControllerAndSignals(d, 0, { addErrorSignals: true });
    },
  },
  { name: "ctrl-2", parent: "ctrl-errors", apply: (d) => updateGroupAndSignals(d, 1, 0, { enabled: true }) },
  { name: "consum", parent: "ctrl-2", apply: (d) => updateMeScalarsAndSignals(d, { consumptionEnabled: true }) },
];

function normalize(xml: string): string {
  return xml
    .replace(/\r\n *(<MBSlavesArray>[\s\S]*?<\/MBSlavesArray>|<MBSlavesArray \/>)/, "")
    .replace(/ ProjectName="[^"]*"/, "");
}

describe.skipIf(!existsSync(`${REF_DIR}/base.ibmaps`))("ME-MBS model patches vs MAPS reference files", () => {
  const load = (name: RefName) => XmlDocument.parse(readFileSync(`${REF_DIR}/${name}.ibmaps`, "utf8"));

  for (const step of PATCH_STEPS) {
    it(`${step.parent} → ${step.name}`, () => {
      const doc = load(step.parent);
      step.apply(doc);
      expect(normalize(doc.serialize())).toBe(normalize(load(step.name).serialize()));
    });
  }
});
