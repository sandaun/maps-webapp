import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getAttr, getText, XmlDocument } from "@/core/project-format";
import { ADDRESS_MODES, getSignalAddress, READ_WRITE } from "@/protocols/modbus/slave";
import { SYNTHETIC_ME_MBS_XML } from "./fixtures/synthetic-project";
import { describeProjectFamily, isMeMbsProject } from "./detect";
import { projectFromXml } from "./from-xml";
import {
  addSignal,
  removeSignal,
  setGatewayInfo,
  updateGroup,
  updateMbsConfig,
  updateRtuConfig,
  updateSignal,
} from "./xml-ops";
import { validateProject } from "./validate";

function parseFixture() {
  return XmlDocument.parse(SYNTHETIC_ME_MBS_XML);
}

describe("detect", () => {
  it("recognises the ME–MBS family", () => {
    expect(isMeMbsProject(parseFixture())).toBe(true);
  });
  it("rejects other families and platforms", () => {
    const doc = parseFixture();
    doc.setAttr([], "InternalProtocol", "KNX");
    expect(isMeMbsProject(doc)).toBe(false);
    expect(describeProjectFamily(doc)).toBe("KNX ↔ Mitsubishi Electric");
    const flat = parseFixture();
    flat.setAttr([], "Platform", "2"); // RT, not RT_AIR
    expect(isMeMbsProject(flat)).toBe(false);
  });
});

describe("projectFromXml (synthetic)", () => {
  it("maps the synthetic fixture to the model", () => {
    const project = projectFromXml(parseFixture());
    expect(project.name).toBe("synthetic-me-mbs.ibmaps");
    expect(project.gateway.name).toBe("SYNTH-ME-MBS");
    expect(project.gateway.dhcp).toBe(false);

    expect(project.mbs.media).toBe(2); // Both
    expect(project.mbs.addressMode).toBe(ADDRESS_MODES.FIXED);
    expect(project.mbs.commErrorTout).toBe(180);
    expect(project.mbs.rtu).toMatchObject({ baudrate: 9600, slaveNumber: 3 });
    expect(project.mbs.tcp).toMatchObject({ port: 502, keepAlive: 10 });
    expect(project.mbs.slaves).toEqual([
      { address: 3, description: "General Controller 1" },
      { address: 4, description: "C1G1" },
    ]);

    expect(project.me.pollPeriod).toBe(100);
    expect(project.me.consumptionEnabled).toBe(false);
    expect(project.me.controllers).toHaveLength(1);
    const ctrl = project.me.controllers[0];
    expect(ctrl).toMatchObject({ index: 0, description: "VRF", enabled: false, ip: "192.168.1.129" });
    expect(ctrl.groups[0]).toMatchObject({ index: 0, enabled: true, description: "Office", urc: true });
    expect(ctrl.groups[1].enabled).toBe(false);

    expect(project.signals).toHaveLength(9);
    const [commErr, onAll, onOff, , fan, setpoint] = project.signals;
    expect(commErr.me).toMatchObject({ groupIndex: -1, signalSpecIndex: 0, isStatus: true });
    expect(commErr.modbus).toMatchObject({ address: 0, readWrite: READ_WRITE.READ });
    expect(onAll.modbus.readWrite).toBe(READ_WRITE.TRIGGER);
    expect(onOff.modbus).toMatchObject({ address: 100, readWrite: READ_WRITE.READWRITE });
    expect(onOff.me).toMatchObject({ groupIndex: 0, signalIndex: 0 });
    expect(fan.idxOperations).toBe("17,0");
    expect(setpoint.modbus.format).toBe(1); // Signed C2
    expect(setpoint.idxOperations).toBe("0,1");

    expect(project.conversions).toHaveLength(1);
  });

  it("does not expose credentials in the model", () => {
    const json = JSON.stringify(projectFromXml(parseFixture()));
    expect(json).not.toContain("Pwd");
    expect(json).not.toContain("AuthPassword");
    expect(json).not.toContain("AuthUserId");
  });

  it("no-change round-trip stays byte-identical", () => {
    const doc = parseFixture();
    projectFromXml(doc); // parse only
    expect(doc.serialize()).toBe(SYNTHETIC_ME_MBS_XML);
  });

  it("synthetic fixture validates clean except the disabled-controller warning", () => {
    const issues = validateProject(projectFromXml(parseFixture()));
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(issues.map((i) => i.code)).toEqual(["ME-CTRL-DISABLED"]);
  });
});

describe("xml-ops", () => {
  it("updateSignal patches both protocol sides", () => {
    const doc = parseFixture();
    updateSignal(doc, 2, {
      description: "Renamed",
      me: { signalSpecIndex: 6 },
      modbus: { address: 103, readWrite: READ_WRITE.READ },
    });
    const xml = doc.serialize();
    expect(xml).toContain("<Description>Renamed</Description>");
    expect(xml).toContain("<SignalSpecIndex>6</SignalSpecIndex>");
    expect(xml).toContain("<Address>103</Address>");
    // the other signals are untouched
    expect(xml).toContain("<Description>Operation Mode IC  [0-Auto");
  });

  it("addSignal appends aligned nodes with defaults and removeSignal restores", () => {
    const doc = parseFixture();
    const before = doc.serialize();
    const id = addSignal(doc);
    expect(id).toBe(9);
    const project = projectFromXml(doc);
    expect(project.signals).toHaveLength(10);
    const added = project.signals[9];
    expect(added.modbus).toMatchObject({ address: 0, readWrite: 2, lenBits: 16, slaveIndex: -1 });
    expect(added.me).toMatchObject({ groupIndex: -1, unitId: -1, signalSpecIndex: -1 });
    expect(removeSignal(doc, id)).toBe(true);
    expect(doc.serialize()).toBe(before);
  });

  it("setGatewayInfo never touches Pwd", () => {
    const doc = parseFixture();
    setGatewayInfo(doc, { name: "NEW-NAME", ip: "10.0.0.5" });
    const xml = doc.serialize();
    expect(xml).toContain('Name="NEW-NAME"');
    expect(xml).toContain('Pwd=""');
  });

  it("updates mbs config and rtu settings", () => {
    const doc = parseFixture();
    updateMbsConfig(doc, { commErrorTout: 60, updateCOV: false });
    updateRtuConfig(doc, { slaveNumber: 7, baudrate: 19200 });
    const xml = doc.serialize();
    expect(xml).toContain("<CommErrorTout>60</CommErrorTout>");
    expect(xml).toContain("<UpdateCOV>False</UpdateCOV>");
    expect(xml).toContain('Baudrate="19200"');
    expect(xml).toContain('SlaveNumber="7"');
  });

  it("updates a group without touching neighbours", () => {
    const doc = parseFixture();
    updateGroup(doc, 0, 1, { enabled: true, description: "Kitchen", urc: true });
    const project = projectFromXml(doc);
    expect(project.me.controllers[0].groups[1]).toMatchObject({
      enabled: true,
      description: "Kitchen",
      urc: true,
    });
    expect(project.me.controllers[0].groups[0].description).toBe("Office");
  });
});

/**
 * Gate test against the real 770 Air fixture (gitignored under
 * .local-data/ — it may contain credentials). Skipped when absent (CI).
 * Invariants per docs/ac-me-mbs-analisi.md.
 */
const REAL_IBMAPS = ".local-data/fixtures/770air-me-mbs-2026-08-18.ibmaps.xml";
const hasRealFixture = existsSync(REAL_IBMAPS);

describe.skipIf(!hasRealFixture)("real 770 Air fixture (present only in the local checkout)", () => {
  function parseReal() {
    const xml = readFileSync(REAL_IBMAPS, "utf8");
    return { xml, doc: XmlDocument.parse(xml) };
  }

  it("parses 222+222 signals with 1:1 idxConfig and the headline counts", () => {
    const { doc } = parseReal();
    const project = projectFromXml(doc);

    expect(project.signals).toHaveLength(222);
    // 1:1 alignment: ID attribute == idxConfig text on both protocol sides.
    for (const side of ["InternalProtocol", "ExternalProtocol"] as const) {
      for (const el of doc.findAll([side, "Signals", "Signal"])) {
        const id = getAttr(el, "ID");
        const idxConfig = el.children.find((c) => c.kind === "element" && c.tag === "idxConfig");
        expect(idxConfig && idxConfig.kind === "element" ? getText(idxConfig) : undefined).toBe(id);
      }
    }

    const count = (pred: (s: (typeof project.signals)[number]) => boolean) =>
      project.signals.filter(pred).length;
    expect(count((s) => s.modbus.readWrite === READ_WRITE.READ)).toBe(61);
    expect(count((s) => s.modbus.readWrite === READ_WRITE.TRIGGER)).toBe(41);
    expect(count((s) => s.modbus.readWrite === READ_WRITE.READWRITE)).toBe(120);
    expect(count((s) => s.modbus.format === 0)).toBe(168); // Unsigned
    expect(count((s) => s.modbus.format === 1)).toBe(54); // Signed C2
    expect(count((s) => s.me.isStatus)).toBe(181);
    expect(count((s) => s.me.groupIndex === -1)).toBe(30); // general signals
    expect(count((s) => s.me.unitId !== -1)).toBe(0);

    // Topology: 2 controllers × 50 groups, 6 enabled on controller 0.
    expect(project.me.controllers).toHaveLength(2);
    expect(project.me.controllers.map((c) => c.groups.length)).toEqual([50, 50]);
    expect(project.me.controllers[0].groups.filter((g) => g.enabled)).toHaveLength(6);
    expect(project.me.controllers[1].groups.filter((g) => g.enabled)).toHaveLength(0);

    // Virtual slave array: 3 + one per enabled group (skipping group 3).
    expect(project.mbs.slaves.map((s) => s.address)).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  it("reproduces every stored address with the FIXED map (222/222)", () => {
    const { doc } = parseReal();
    const project = projectFromXml(doc);
    expect(project.mbs.addressMode).toBe(ADDRESS_MODES.FIXED);
    for (const s of project.signals) {
      const expected = getSignalAddress(ADDRESS_MODES.FIXED, {
        g50Index: s.me.g50Index,
        groupIndex: s.me.groupIndex,
        unitIndex: s.me.unitId,
        signalSpecIndex: s.me.signalSpecIndex,
      });
      expect(expected, `signal #${s.id}`).toBe(s.modbus.address);
    }
  });

  it("validates with no errors (only the disabled-controller warning)", () => {
    const { doc } = parseReal();
    const issues = validateProject(projectFromXml(doc));
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(issues.map((i) => i.code)).toEqual(["ME-CTRL-DISABLED"]);
  });

  it("round-trips byte-identical", () => {
    const { xml, doc } = parseReal();
    expect(doc.serialize()).toBe(xml);
  });

  it("never leaks credentials into the model", () => {
    const { doc } = parseReal();
    const json = JSON.stringify(projectFromXml(doc));
    expect(json).not.toContain("Pwd");
    expect(json).not.toContain("AuthPassword");
  });
});
