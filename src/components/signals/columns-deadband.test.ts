import { describe, expect, it } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { projectFromXml } from "@/gateway-families/knx-mbm/from-xml";
import type { KnxMbmSignal } from "@/gateway-families/knx-mbm/model";
import { knxMbmColumns, toKnxRow } from "./columns-knx-mbm";

describe("KNX–MBM deadband column (MAPS ch_deadband)", () => {
  const project = projectFromXml(XmlDocument.parse(SYNTHETIC_KNX_MBM_XML));
  const column = knxMbmColumns(project).find((c) => c.id === "deadband")!;
  const row = (patch: Partial<KnxMbmSignal>, deadband = 2.5) => {
    const signal = project.signals[0];
    return toKnxRow(project.mbm, { ...signal, ...patch, modbus: { ...signal.modbus, deadband } });
  };
  const ordinary = row({ virtual: false, modbusVirtual: false, modbusFixed: false });

  it("starts hidden and is editable on ordinary signals", () => {
    expect(column.defaultHidden).toBe(true);
    expect(column.getText(ordinary)).toBe("2.5");
    expect(column.readOnly!(ordinary)).toBe(false);
    expect(column.parse!(ordinary, "0,5")).toEqual({ patch: { modbus: { deadband: 0.5 } } });
    expect(column.inverseFromText!(ordinary)).toEqual({ modbus: { deadband: 2.5 } });
  });

  it("accepts 0–100 only, with the MAPS message", () => {
    // `CheckFloatFormat` also refuses signs, spaces and exponents.
    for (const raw of ["-1", "100.5", "abc", "", "1E-05", "1e-5", " 2.5", "+1"]) {
      expect(column.parse!(ordinary, raw)).toEqual({ error: "Invalid value for Deadband (0..100)" });
    }
    expect(column.parse!(ordinary, "100")).toEqual({ patch: { modbus: { deadband: 100 } } });
  });

  it("is read-only on virtual rows (a dash) and fixed Modbus signals (their value)", () => {
    const virtual = row({ virtual: true, modbusVirtual: true, modbusFixed: true }, 0);
    expect(column.readOnly!(virtual)).toBe(true);
    expect(column.getText(virtual)).toBe("-");
    const fixed = row({ virtual: false, modbusVirtual: false, modbusFixed: true });
    expect(column.readOnly!(fixed)).toBe(true);
    expect(column.getText(fixed)).toBe("2.5");
  });
});
