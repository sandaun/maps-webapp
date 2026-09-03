import { describe, expect, it } from "vitest";
import { GROUP_TYPES } from "@/protocols/me/types";
import {
  classifyBusScanLine,
  parseBusScanGroupLine,
  parseBusScanResult,
} from "./bus-scan";

const TYPICAL =
  "1ME:CMD:BUSSCAN:GROUP[1]:ADDRESS[3]:MODEL[IC]:FANSPEEDSW[4STAGES]:FANAUTOSW[DISABLE]:FANEXLOWSW[DISABLE]:CAPACITY[-1]";

describe("classifyBusScanLine", () => {
  it("classifies the terminators and stream markers", () => {
    expect(classifyBusScanLine("1ME:CMD:OK")).toBe("ok");
    expect(classifyBusScanLine("1ME:CMD:BUSSCAN:END")).toBe("end");
    expect(classifyBusScanLine("1ME:CMD:ERR")).toBe("error");
    expect(classifyBusScanLine("1ME:CMD:BUSSCAN:ERR")).toBe("error");
    expect(classifyBusScanLine(TYPICAL)).toBe("group");
    expect(classifyBusScanLine("1ME:CMD:BUSSCAN:PROGRESS=45%")).toBe("progress");
    expect(classifyBusScanLine("some noise")).toBe("other");
  });
});

describe("parseBusScanGroupLine", () => {
  it("parses a typical group line", () => {
    const group = parseBusScanGroupLine(TYPICAL);
    expect(group).toEqual({
      group: 1,
      addresses: [3],
      model: "IC",
      type: GROUP_TYPES.IC,
      fanSpeeds: 4,
      fanAuto: "DISABLE",
      fanExlow: "DISABLE",
      urc: false,
      capacity: -1,
    });
  });

  it("collects several ADDRESS tokens of the same group", () => {
    const group = parseBusScanGroupLine(
      "1ME:CMD:BUSSCAN:GROUP[4]:ADDRESS[3]:ADDRESS[4]:ADDRESS[7]:MODEL[LC]:FANSPEEDSW[2STAGES]:FANAUTOSW[ENABLE]:FANEXLOWSW[DISABLE]:CAPACITY[-1]",
    );
    expect(group?.addresses).toEqual([3, 4, 7]);
    expect(group?.type).toBe(GROUP_TYPES.LC);
    expect(group?.fanSpeeds).toBe(2);
    expect(group?.fanAuto).toBe("ENABLE");
  });

  it("dedupes repeated ADDRESS tokens", () => {
    const group = parseBusScanGroupLine(
      "1ME:CMD:BUSSCAN:GROUP[2]:ADDRESS[3]:ADDRESS[3]:MODEL[IC]:FANSPEEDSW[4STAGES]",
    );
    expect(group?.addresses).toEqual([3]);
  });

  it("maps each desktop model string to its GROUP_TYPES value", () => {
    const cases: Array<[string, number]> = [
      ["IC", GROUP_TYPES.IC],
      ["KIC", GROUP_TYPES.IC],
      ["AIC", GROUP_TYPES.IC],
      ["LC", GROUP_TYPES.LC],
      ["FU", GROUP_TYPES.FU],
      ["BU", GROUP_TYPES.BU],
      ["WH", GROUP_TYPES.WH],
      ["CEh", GROUP_TYPES.CEH],
      ["AE200", GROUP_TYPES.SYS_COMPONENT],
    ];
    for (const [model, type] of cases) {
      const group = parseBusScanGroupLine(
        `1ME:CMD:BUSSCAN:GROUP[1]:ADDRESS[1]:MODEL[${model}]:FANSPEEDSW[4STAGES]`,
      );
      expect(group?.type, model).toBe(type);
    }
  });

  it("flags URC when an address > 50 is followed by MODEL[URC]", () => {
    const group = parseBusScanGroupLine(
      "1ME:CMD:BUSSCAN:GROUP[7]:ADDRESS[3]:ADDRESS[51]:MODEL[URC]:FANSPEEDSW[NONE]:CAPACITY[-1]",
    );
    expect(group?.urc).toBe(true);
    expect(group?.model).toBe("");
    expect(group?.type).toBe(GROUP_TYPES.SYS_COMPONENT);
    expect(group?.fanSpeeds).toBe(0);
  });

  it("discards the line when an address > 50 is followed by another model", () => {
    expect(
      parseBusScanGroupLine(
        "1ME:CMD:BUSSCAN:GROUP[7]:ADDRESS[51]:MODEL[IC]:FANSPEEDSW[4STAGES]",
      ),
    ).toBeNull();
  });

  it("FANEXLOWSW[ENABLE] forces 3 fan speeds", () => {
    const group = parseBusScanGroupLine(
      "1ME:CMD:BUSSCAN:GROUP[1]:ADDRESS[3]:MODEL[IC]:FANSPEEDSW[4STAGES]:FANEXLOWSW[ENABLE]",
    );
    expect(group?.fanSpeeds).toBe(3);
  });

  it("FANSPEEDSW[NONE] maps to 0 fan speeds", () => {
    const group = parseBusScanGroupLine(
      "1ME:CMD:BUSSCAN:GROUP[1]:ADDRESS[3]:MODEL[WH]:FANSPEEDSW[NONE]:CAPACITY[14]",
    );
    expect(group?.fanSpeeds).toBe(0);
    expect(group?.capacity).toBe(14);
  });

  it("discards malformed lines", () => {
    // Too few tokens.
    expect(parseBusScanGroupLine("1ME:CMD:BUSSCAN:GROUP[1]")).toBeNull();
    // Non-numeric group index.
    expect(
      parseBusScanGroupLine("1ME:CMD:BUSSCAN:GROUP[x]:ADDRESS[3]:MODEL[IC]:FANSPEEDSW[4STAGES]"),
    ).toBeNull();
    // No ADDRESS[ / FANSPEEDSW[ token.
    expect(parseBusScanGroupLine("1ME:CMD:BUSSCAN:GROUP[1]:MODEL[IC]:FOO[BAR]")).toBeNull();
    // Missing GROUP[ marker.
    expect(parseBusScanGroupLine("1ME:CMD:BUSSCAN:ROW[1]:ADDRESS[3]:MODEL[IC]:FANSPEEDSW[4STAGES]")).toBeNull();
    // Non-integer capacity.
    expect(
      parseBusScanGroupLine(
        "1ME:CMD:BUSSCAN:GROUP[1]:ADDRESS[3]:MODEL[IC]:FANSPEEDSW[4STAGES]:CAPACITY[abc]",
      ),
    ).toBeNull();
    // Non-numeric address.
    expect(
      parseBusScanGroupLine("1ME:CMD:BUSSCAN:GROUP[1]:ADDRESS[x]:MODEL[IC]:FANSPEEDSW[4STAGES]"),
    ).toBeNull();
  });
});

describe("parseBusScanResult", () => {
  it("reduces a full successful scan", () => {
    const result = parseBusScanResult([
      "1ME:CMD:OK",
      "1ME:CMD:BUSSCAN:PROGRESS=10%",
      TYPICAL,
      "1ME:CMD:BUSSCAN:PROGRESS=90%",
      "1ME:CMD:BUSSCAN:GROUP[2]:ADDRESS[5]:MODEL[BU]:FANSPEEDSW[3STAGES]:CAPACITY[25]",
      "1ME:CMD:BUSSCAN:END",
    ]);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.groups.map((g) => g.group)).toEqual([1, 2]);
    expect(result.groups[1].type).toBe(GROUP_TYPES.BU);
    expect(result.groups[1].capacity).toBe(25);
  });

  it("merges repeated lines of the same group", () => {
    const result = parseBusScanResult([
      "1ME:CMD:BUSSCAN:GROUP[1]:ADDRESS[3]:MODEL[IC]:FANSPEEDSW[4STAGES]",
      "1ME:CMD:BUSSCAN:GROUP[1]:ADDRESS[4]:MODEL[IC]:FANSPEEDSW[4STAGES]",
      "1ME:CMD:BUSSCAN:END",
    ]);
    expect(result.ok).toBe(true);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].addresses).toEqual([3, 4]);
  });

  it("reports the error terminator and keeps parsed groups", () => {
    const result = parseBusScanResult([TYPICAL, "1ME:CMD:BUSSCAN:ERR"]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ERR");
    expect(result.groups).toHaveLength(1);
  });

  it("fails when the END terminator never arrives", () => {
    const result = parseBusScanResult(["1ME:CMD:OK", TYPICAL]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("END");
  });

  it("discards malformed group lines but keeps the scan", () => {
    const result = parseBusScanResult([
      "1ME:CMD:BUSSCAN:GROUP[1]:ADDRESS[51]:MODEL[IC]:FANSPEEDSW[4STAGES]",
      TYPICAL,
      "1ME:CMD:BUSSCAN:END",
    ]);
    expect(result.ok).toBe(true);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].group).toBe(1);
  });
});
