import { describe, expect, it } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { READ_WRITE } from "@/protocols/modbus/slave";
import { SYNTHETIC_ME_MBS_EMPTY_XML } from "./fixtures/synthetic-empty-project";
import { SYNTHETIC_ME_MBS_XML } from "./fixtures/synthetic-project";
import { projectFromXml } from "./from-xml";
import { updateControllerAndSignals, updateGroupAndSignals, updateMbsConfigAndSignals } from "./regeneration";
import { validateProject } from "./validate";
import type { MeMbsProject } from "./model";

/** Valid baseline: synthetic fixture without the disabled controller (drops ME-CTRL-DISABLED). */
function baseProject(): MeMbsProject {
  const project = projectFromXml(XmlDocument.parse(SYNTHETIC_ME_MBS_XML));
  project.me.controllers[0].enabled = true;
  return project;
}

function codes(project: MeMbsProject): string[] {
  return validateProject(project).map((i) => i.code);
}

describe("validateProject", () => {
  it("accepts the valid baseline", () => {
    expect(validateProject(baseProject())).toEqual([]);
  });

  it("SIG-LIMIT-ACTIVE: too many active signals", () => {
    const project = baseProject();
    const template = project.signals[2]; // group On/Off
    for (let i = 0; i < 3001; i++) {
      project.signals.push({ ...template, id: 1000 + i, active: true, modbus: { ...template.modbus, address: 2000 + i } });
    }
    expect(codes(project)).toContain("SIG-LIMIT-ACTIVE");
  });

  it("SIG-LIMIT-TOTAL: too many signal rows", () => {
    const project = baseProject();
    const template = project.signals[2];
    for (let i = 0; i < 5001; i++) {
      project.signals.push({ ...template, id: 1000 + i, active: false, modbus: { ...template.modbus, address: 2000 + i } });
    }
    expect(codes(project)).toContain("SIG-LIMIT-TOTAL");
  });

  it("MBS-SLAVE-RANGE: RTU slave id out of range", () => {
    const project = baseProject();
    project.mbs.rtu.slaveNumber = 0;
    expect(codes(project)).toContain("MBS-SLAVE-RANGE");
  });

  it("MBS-COMMERR-RANGE: communication error timeout out of range", () => {
    const project = baseProject();
    project.mbs.commErrorTout = 9999;
    expect(codes(project)).toContain("MBS-COMMERR-RANGE");
  });

  it("MBS-SLAVE-ADDRESS-RANGE: a slave past address 255 (CheckParams)", () => {
    const project = baseProject();
    project.mbs.slaves.push({ address: 256, description: "C1G9" });
    expect(codes(project)).toContain("MBS-SLAVE-ADDRESS-RANGE");
  });

  describe("MBS-SLAVE-INDEX: signals on the wrong slave (MULTIPLE)", () => {
    function multiple(apply: (doc: XmlDocument) => void): MeMbsProject {
      const doc = XmlDocument.parse(SYNTHETIC_ME_MBS_EMPTY_XML);
      updateMbsConfigAndSignals(doc, { slaveAddressMode: 1 });
      apply(doc);
      return projectFromXml(doc);
    }

    it("accepts the signals as MAPS creates them", () => {
      const project = multiple((doc) => {
        updateGroupAndSignals(doc, 0, 0, { enabled: true });
        updateGroupAndSignals(doc, 0, 1, { enabled: true });
        updateControllerAndSignals(doc, 0, { addErrorSignals: true });
        updateGroupAndSignals(doc, 1, 0, { enabled: true });
      });
      expect(codes(project)).not.toContain("MBS-SLAVE-INDEX");
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
    ])("reports %s", (_, apply) => {
      expect(codes(multiple(apply))).toContain("MBS-SLAVE-INDEX");
    });

    it("reports a slave list that does not match the groups", () => {
      const project = multiple((doc) => updateGroupAndSignals(doc, 0, 0, { enabled: true }));
      project.mbs.slaves[1] = { ...project.mbs.slaves[1], address: 9 };
      expect(codes(project)).toContain("MBS-SLAVE-INDEX");
    });

    it("is rebuilt by switching to a single slave and back", () => {
      const project = multiple((doc) => {
        updateGroupAndSignals(doc, 0, 0, { enabled: true });
        updateControllerAndSignals(doc, 0, { addErrorSignals: true });
        updateGroupAndSignals(doc, 0, 1, { enabled: true });
        updateMbsConfigAndSignals(doc, { slaveAddressMode: 0 });
        updateMbsConfigAndSignals(doc, { slaveAddressMode: 1 });
      });
      expect(codes(project)).not.toContain("MBS-SLAVE-INDEX");
    });
  });

  it("ME-CONTROLLER-LIMIT: more than 2 controllers", () => {
    const project = baseProject();
    project.me.controllers.push(project.me.controllers[0], project.me.controllers[0]);
    expect(codes(project)).toContain("ME-CONTROLLER-LIMIT");
  });

  it("ME-GROUP-LIMIT: more than 50 groups on a controller", () => {
    const project = baseProject();
    for (let i = 0; i < 50; i++) project.me.controllers[0].groups.push({ ...project.me.controllers[0].groups[1], index: i + 2 });
    expect(codes(project)).toContain("ME-GROUP-LIMIT");
  });

  it("ME-CTRL-DISABLED: disabled controller with enabled groups (warning)", () => {
    const project = baseProject();
    project.me.controllers[0].enabled = false;
    const issues = validateProject(project);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "ME-CTRL-DISABLED", severity: "warning" });
  });

  it("MBS-READWRITE: read/write value out of range", () => {
    const project = baseProject();
    project.signals[0].modbus.readWrite = 5 as never;
    expect(codes(project)).toContain("MBS-READWRITE");
  });

  it("MBS-ADDRESS-RANGE: address out of range", () => {
    const project = baseProject();
    project.signals[0].modbus.address = 70000;
    expect(codes(project)).toContain("MBS-ADDRESS-RANGE");
  });

  it("MBS-LEN-FORMAT: unsupported length/format combination", () => {
    const project = baseProject();
    project.signals[2].modbus.lenBits = 8;
    expect(codes(project)).toContain("MBS-LEN-FORMAT");
  });

  it("MBS-STRING-LEN: string format without length", () => {
    const project = baseProject();
    project.signals[2].modbus.format = 5; // STRING
    project.signals[2].modbus.stringLength = -1;
    project.signals[2].modbus.lenBits = 16;
    expect(codes(project)).toContain("MBS-STRING-LEN");
  });

  it("MBS-ADDRESS-DUP: two active signals on the same register", () => {
    const project = baseProject();
    project.signals[3].modbus.address = project.signals[2].modbus.address;
    expect(codes(project)).toContain("MBS-ADDRESS-DUP");
  });

  it("ME-SPEC-UNKNOWN: spec not in the catalog", () => {
    const project = baseProject();
    project.signals[2].me.signalSpecIndex = 99;
    expect(codes(project)).toContain("ME-SPEC-UNKNOWN");
  });

  it("ME-GROUP-REF: signal points to a group that does not exist", () => {
    const project = baseProject();
    project.signals[2].me.groupIndex = 7;
    expect(codes(project)).toContain("ME-GROUP-REF");
  });

  it("ME-GROUP-REF: signal points to a disabled group", () => {
    const project = baseProject();
    project.signals[2].me.groupIndex = 1; // disabled in the fixture
    project.signals[2].modbus.address = 200; // keep address consistent
    expect(codes(project)).toContain("ME-GROUP-REF");
  });

  it("ME-SPEC-ADDRESS: stored address does not match the FIXED map", () => {
    const project = baseProject();
    project.signals[2].modbus.address = 150; // spec 0 of group 0 must be 100
    expect(codes(project)).toContain("ME-SPEC-ADDRESS");
  });

  it("ME-SPEC-ADDRESS: not checked in CUSTOM address mode", () => {
    const project = baseProject();
    project.mbs.addressMode = 1;
    project.signals[2].modbus.address = 150;
    expect(codes(project)).not.toContain("ME-SPEC-ADDRESS");
  });

  it("TRIGGER signals are valid values of the read/write enum", () => {
    const project = baseProject();
    expect(project.signals[1].modbus.readWrite).toBe(READ_WRITE.TRIGGER);
    expect(codes(project)).not.toContain("MBS-READWRITE");
  });
});
