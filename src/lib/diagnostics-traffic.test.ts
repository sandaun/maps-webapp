import { describe, expect, it } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { projectFromXml } from "@/gateway-families/knx-mbm/from-xml";
import { SYNTHETIC_MBS_KNX_XML } from "@/gateway-families/mbs-knx/fixtures/synthetic-project";
import { projectFromXml as mbsFromXml } from "@/gateway-families/mbs-knx/from-xml";
import { SYNTHETIC_ME_MBS_XML } from "@/gateway-families/me-mbs/fixtures/synthetic-project";
import { projectFromXml as meFromXml } from "@/gateway-families/me-mbs/from-xml";
import type { ProjectView } from "./project-types";
import { parseMonitorLine } from "./diagnostics-parsing";
import { diagnosticTrafficSignals } from "./diagnostics-traffic";

function view(): Extract<ProjectView, { family: "knx-mbm" }> {
  return {
    family: "knx-mbm", project: projectFromXml(XmlDocument.parse(SYNTHETIC_KNX_MBM_XML)),
    meta: { id: "test", name: "test", description: "", source: "file", family: "knx-mbm", updatedAt: "" },
    mapsVersion: "", passwordValid: false, issues: [], hasCompleteBlob: false,
  };
}

function frames(lines: string[], interval = 25) {
  return lines.map((line, i) => parseMonitorLine(line, i, new Date(1_000_000 + i * interval).toISOString()));
}

// Fixture encoder; matcher checks the resulting wire frames independently.
function rtu(data: number[]): string {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xa001 : 0);
  }
  return [...data, crc & 255, crc >>> 8].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

function line(dir: "Tx" | "Rx", data: number[], head = "1MM:RTUB") {
  return `${head} [${dir}] ${rtu(data)}`;
}

describe("traffic signal association", () => {
  it("identifies ME–MBS register requests and replies, including multiple slaves", () => {
    const project = { ...view(), family: "me-mbs", project: meFromXml(XmlDocument.parse(SYNTHETIC_ME_MBS_XML)) } as Extract<ProjectView, { family: "me-mbs" }>;
    const row = project.project.signals[2];
    project.project.mbs.registerBase = 1;
    project.project.mbs.slaveAddressMode = 1;
    project.project.mbs.slaves = [{ address: 5, description: "AC group" }];
    row.modbus.slaveIndex = 0;
    const address = row.modbus.address - 1;
    const request = line("Rx", [5, 3, address >> 8, address & 255, 0, 1], "0MS:RTUB");
    const reply = line("Tx", [5, 3, 2, 0, 1], "0MS:RTUB");
    const matches = diagnosticTrafficSignals(project, frames([request, reply, reply]));
    expect(matches.get(0)?.label).toBe(row.description);
    expect(matches.get(1)?.label).toBe(row.description);
    expect(matches.get(2)?.label).toBe("—");
    expect(diagnosticTrafficSignals(project, frames([line("Rx", [1, 3, address >> 8, address & 255, 0, 1], "0MS:RTUB")])).get(0)?.label).toBe("—");
  });

  it("matches push IDs by complete protocol endpoint, with explicit fallback", () => {
    const matches = diagnosticTrafficSignals(view(), frames([
      "0KX:00020805=22.5;0", "1MM:00000000=1;0", "1KX:00020805=99;0", "1MM:RTUB Timeout!",
    ]));
    expect(matches.get(0)?.label).toBe("Room temperature");
    expect(matches.get(1)?.label).toBe("Heat pump on/off");
    expect(matches.get(2)).toMatchObject({ label: "00020805", detail: expect.stringContaining("no matching signal") });
    expect(matches.get(3)).toMatchObject({ label: "—", detail: expect.stringContaining("No signal") });
  });

  it("matches standard TP1 group telegrams, including listening addresses and repeated GAs", () => {
    const project = view();
    const bytes = [0xbc, 0x11, 0x01, 0x08, 0x04, 0xe1, 0x00, 0x81];
    const telegram = [...bytes, bytes.reduce((sum, byte) => sum ^ byte, 0xff)]
      .map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
    expect(diagnosticTrafficSignals(project, frames([`0KX:[Rx] ${telegram}`])).get(0)?.label).toBe("Heat pump on/off");
    expect(diagnosticTrafficSignals(project, frames([`0KX:[Tx] ${telegram}`])).get(0)?.label).toBe("—");
    project.project.signals[1].knx.groupAddress = 0x0804;
    expect(diagnosticTrafficSignals(project, frames([`0KX:[Rx] ${telegram}`])).get(0)?.label).toBe("2 signals");
    expect(diagnosticTrafficSignals(project, frames([`0KX:[Rx] ${telegram.slice(0, -2)}00`])).get(0)?.label).toBe("—");
  });

  it("associates real RTU request/reply bytes without requiring a runtime ID", () => {
    const project = view();
    project.project.signals[0].modbus.readFunc = 3;
    project.project.signals[0].modbus.address = 0;
    const matches = diagnosticTrafficSignals(project, frames([
      "1MM:RTUB [Tx] 01 03 00 00 00 01 84 0A",
      "1MM:RTUB [Rx] 01 03 02 00 01 79 84",
    ]));
    expect(matches.get(0)?.label).toBe("Heat pump on/off");
    expect(matches.get(1)?.label).toBe("Heat pump on/off");
  });

  it("uses device slave address, physical port, register base, width and function", () => {
    const project = view();
    project.project.mbm.rtuNodes[0].devices[0].baseRegister = 1;
    const match = (request: number[], head = "1MM:RTUB") => diagnosticTrafficSignals(project, frames([line("Tx", request, head)])).get(0)?.label;
    expect(match([1, 3, 0, 19, 0, 2])).toBe("Room temperature");
    expect(match([1, 3, 0, 20, 0, 1])).toBe("Room temperature");
    expect(match([1, 3, 0, 21, 0, 1])).toBe("—");
    expect(match([2, 3, 0, 19, 0, 2])).toBe("—");
    expect(match([1, 4, 0, 19, 0, 2])).toBe("—");
    expect(match([1, 3, 0, 19, 0, 2], "1MM:RTUA")).toBe("—");
    expect(match([1, 6, 0, 9, 0, 1])).toBe("Heat pump on/off");
    project.project.signals[1].active = false;
    expect(match([1, 3, 0, 19, 0, 2])).toBe("—");
  });

  it("lists every signal touched by a batch and matches write acknowledgements and exceptions", () => {
    const project = view();
    const request = line("Tx", [1, 3, 0, 10, 0, 12]);
    project.project.signals[0].modbus.readFunc = 3;
    const matches = diagnosticTrafficSignals(project, frames([request, line("Rx", [1, 0x83, 2])]));
    expect(matches.get(0)?.label).toBe("2 signals");
    expect(matches.get(0)?.detail).toContain("Room temperature");
    expect(matches.get(1)?.label).toBe("2 signals");
    const write = [1, 6, 0, 10, 0, 1];
    expect(diagnosticTrafficSignals(project, frames([line("Tx", write), line("Rx", write)])).get(1)?.label).toBe("Heat pump on/off");
  });

  it("never assigns orphan, expired, wrong-size, wrong-function or bad-CRC replies", () => {
    const project = view();
    const request = line("Tx", [1, 3, 0, 20, 0, 2]);
    const response = line("Rx", [1, 3, 4, 0, 0, 0, 1]);
    expect(diagnosticTrafficSignals(project, frames([response])).get(0)?.label).toBe("—");
    expect(diagnosticTrafficSignals(project, frames([request, response], 1001)).get(1)?.label).toBe("—");
    project.project.mbm.rtuNodes[0].devices[0].timeout = 100;
    expect(diagnosticTrafficSignals(project, frames([request, response], 101)).get(1)?.label).toBe("—");
    for (const reply of [line("Rx", [1, 3, 2, 0, 1]), line("Rx", [1, 4, 4, 0, 0, 0, 1]), `${response.slice(0, -2)}00`]) {
      expect(diagnosticTrafficSignals(project, frames([request, reply])).get(1)?.label).toBe("—");
    }
    expect(diagnosticTrafficSignals(project, frames([request, "1MM:RTUB Timeout!", response])).get(2)?.label).toBe("—");
    expect(diagnosticTrafficSignals(project, frames([request, line("Tx", [2, 3, 0, 20, 0, 2]), response])).get(2)?.label).toBe("—");
    expect(diagnosticTrafficSignals(project, frames([request, "1MM:RTUB [Tx] 01", response])).get(2)?.label).toBe("—");
  });

  it("reverses request/reply direction for the Modbus Slave family", () => {
    const project = { ...view(), family: "mbs-knx", project: mbsFromXml(XmlDocument.parse(SYNTHETIC_MBS_KNX_XML)) } as Extract<ProjectView, { family: "mbs-knx" }>;
    const slave = project.project.mbs.rtu.slaveNumber;
    const matches = diagnosticTrafficSignals(project, frames([
      line("Rx", [slave, 3, 0, 0, 0, 1], "0MS:RTUB"),
      line("Tx", [slave, 3, 2, 0, 1], "0MS:RTUB"),
    ]));
    expect(matches.get(0)?.label).toBe("Setpoint");
    expect(matches.get(1)?.label).toBe("Setpoint");
  });
});
