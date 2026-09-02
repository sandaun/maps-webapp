import { describe, expect, it } from "vitest";
import {
  formatRates,
  formatUptime,
  isFailureText,
  isTimeoutText,
  knxConsoleId,
  mbmConsoleId,
  parseKnxPush,
  parseMbmPush,
  parseMonitorLine,
  parseReadValue,
  rollingRates,
} from "./diagnostics-parsing";

describe("parseMonitorLine", () => {
  it("parses a Modbus COMMS Tx line", () => {
    const frame = parseMonitorLine("1MM:RTUB [Tx] 01 03 00 01 00 01 D5 CA", 0, "2026-09-02T10:00:00.000Z");
    expect(frame).toMatchObject({
      proto: "MODBUS",
      dir: "TX",
      frame: "01 03 00 01 00 01 D5 CA",
      obj: "",
      dec: "1MM:RTUB [Tx] 01 03 00 01 00 01 D5 CA",
    });
  });

  it("parses a KNX COMMS Rx line (case-insensitive tag)", () => {
    const frame = parseMonitorLine("0KX: [rx] BC 11 01 08 03 E1 00 81", 1, "2026-09-02T10:00:01.000Z");
    expect(frame.proto).toBe("KNX");
    expect(frame.dir).toBe("RX");
    expect(frame.frame).toBe("BC 11 01 08 03 E1 00 81");
  });

  it("parses a KNX SPONS push as an object assignment", () => {
    const frame = parseMonitorLine("0KX:00020003=22.50;0", 2, "2026-09-02T10:00:02.000Z");
    expect(frame).toMatchObject({ proto: "KNX", dir: "—", frame: "", obj: "00020003" });
  });

  it("parses a Modbus SPONS push", () => {
    const frame = parseMonitorLine("1MM:00000001=225;0", 3, "2026-09-02T10:00:03.000Z");
    expect(frame).toMatchObject({ proto: "MODBUS", dir: "—", obj: "00000001" });
  });

  it("keeps the protocol for DEBUG lines without a direction tag", () => {
    const frame = parseMonitorLine("1MM:RTUB Timeout!", 4, "2026-09-02T10:00:04.000Z");
    expect(frame).toMatchObject({ proto: "MODBUS", dir: "—", frame: "", obj: "" });
  });

  it("treats anything else as a system event", () => {
    const frame = parseMonitorLine("Slave 22 marked offline after 3 retries", 5, "2026-09-02T10:00:05.000Z");
    expect(frame).toMatchObject({ proto: "SYS", dir: "—", frame: "", obj: "" });
  });
});

describe("signal push parsing and console id mapping", () => {
  it("parses KNX pushes into objIdx + GA + value", () => {
    expect(parseKnxPush("0KX:00020003=22.50;0")).toEqual({ objIdx: 2, groupAddress: 3, value: "22.50" });
    expect(parseKnxPush("0KX:00010803=1;0")).toEqual({ objIdx: 1, groupAddress: 0x0803, value: "1" });
    expect(parseKnxPush("0KX:RTUB [Tx] 01")).toBeNull();
  });

  it("parses Modbus pushes into extId + value", () => {
    expect(parseMbmPush("1MM:00000001=225;0")).toEqual({ extId: 1, value: "225" });
    expect(parseMbmPush("1MM:0000000a=-4.5;0")).toEqual({ extId: 10, value: "-4.5" });
    expect(parseMbmPush("0KX:00020003=22.50;0")).toBeNull();
  });

  it("builds console ids matching the documented formats", () => {
    // docs/reference/console-protocol.md §2: object config ID 1 with GA 0/0/3 → 00020003
    expect(knxConsoleId(2, 3)).toBe("00020003");
    expect(mbmConsoleId(1)).toBe("00000001");
    expect(mbmConsoleId(0)).toBe("00000000");
  });

  it("extracts values from read answers and rejects invalid ones", () => {
    expect(parseReadValue("0KX:00020003=0.00;0")).toBe("0.00");
    expect(parseReadValue("1MM:00000001=225;0")).toBe("225");
    expect(parseReadValue("0KX:00020003=f;0")).toBeNull();
    expect(parseReadValue("0KX:00020003=;0")).toBeNull();
    expect(parseReadValue("INFO:STATUS:RUNNING")).toBeNull();
  });
});

describe("failure/timeout detection", () => {
  it("flags the documented failure wordings", () => {
    expect(isFailureText("NO RESPONSE from slave 22 (timeout 1000 ms)")).toBe(true);
    expect(isFailureText("1MM:RTUB Timeout!")).toBe(true);
    expect(isFailureText("Blocked — read-only register")).toBe(true);
    expect(isFailureText("No ACK from 2/1/7")).toBe(true);
    expect(isFailureText("lamp failure")).toBe(true);
    expect(isFailureText("0KX:00020003=22.50;0")).toBe(false);
  });

  it("counts only Timeout/NO RESPONSE as timeouts", () => {
    expect(isTimeoutText("1MM:RTUB Timeout!")).toBe(true);
    expect(isTimeoutText("NO RESPONSE from slave 22")).toBe(true);
    expect(isTimeoutText("Blocked — read-only register")).toBe(false);
  });
});

describe("rolling rates", () => {
  const now = Date.parse("2026-09-02T10:01:00.000Z");
  const at = (secondsAgo: number) => new Date(now - secondsAgo * 1000).toISOString();

  it("counts frames inside the 60 s window per protocol", () => {
    const rates = rollingRates(
      [
        { at: at(5), proto: "KNX" as const },
        { at: at(10), proto: "KNX" as const },
        { at: at(30), proto: "MODBUS" as const },
        { at: at(120), proto: "KNX" as const }, // outside the window
      ],
      now,
    );
    expect(rates.knxPerMin).toBe(2);
    expect(rates.modbusPerMin).toBe(1);
    expect(rates.modbusPerSec).toBeCloseTo(1 / 60);
  });

  it("ignores invalid and future timestamps", () => {
    const rates = rollingRates(
      [
        { at: "not-a-date", proto: "KNX" as const },
        { at: new Date(now + 60_000).toISOString(), proto: "KNX" as const },
      ],
      now,
    );
    expect(rates.knxPerMin).toBe(0);
  });

  it("formats the footer label", () => {
    expect(formatRates({ knxPerMin: 24, modbusPerMin: 26, modbusPerSec: 26 / 60 })).toBe(
      "KNX 24 tg/min · Modbus 0.4 req/s",
    );
  });
});

describe("formatUptime", () => {
  const now = Date.parse("2026-09-02T12:00:00.000Z");

  it("renders days, hours and minutes compactly", () => {
    expect(formatUptime("2026-08-31T07:48:00.000Z", now)).toBe("2d 4h 12m");
    expect(formatUptime("2026-09-02T08:55:00.000Z", now)).toBe("3h 5m");
    expect(formatUptime("2026-09-02T11:47:30.000Z", now)).toBe("12m 30s");
  });

  it("is honest about bogus input", () => {
    expect(formatUptime("nope", now)).toBe("—");
    expect(formatUptime("2026-09-03T00:00:00.000Z", now)).toBe("—");
  });
});
