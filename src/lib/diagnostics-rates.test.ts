import { describe, expect, it } from "vitest";
import { createDiagnosticRateCounter } from "./diagnostics-rates";

describe("traffic rates independent of display retention", () => {
  it("counts 90,000 lines in a minute without capping the rate at the display window", () => {
    const counter = createDiagnosticRateCounter();
    const now = Date.parse("2026-10-05T10:01:00Z");
    for (let i = 1; i <= 90_000; i++) counter.add({ i, at: new Date(now - 59_000 + Math.floor((i - 1) / 1500) * 1000).toISOString(), proto: "MODBUS" });
    expect(counter.read(now)).toMatchObject({ modbusPerMin: 90_000, modbusPerSec: 1500 });
    counter.add({ i: 90_000, at: new Date(now).toISOString(), proto: "MODBUS" });
    expect(counter.read(now).modbusPerMin).toBe(90_000);
    expect(counter.read(now + 61_000).modbusPerMin).toBe(0);
  });

  it("separates protocols and clears local counters without recounting replay", () => {
    const counter = createDiagnosticRateCounter();
    const now = Date.parse("2026-10-05T10:00:00Z");
    for (const [i, proto] of [[1, "KNX"], [2, "MODBUS"], [3, "SYS"]] as const) counter.add({ i, proto, at: new Date(now).toISOString() });
    expect(counter.read(now)).toMatchObject({ knxPerMin: 1, modbusPerMin: 1 });
    counter.clear();
    counter.add({ i: 1, proto: "KNX", at: new Date(now).toISOString() });
    expect(counter.read(now)).toMatchObject({ knxPerMin: 0, modbusPerMin: 0 });
  });
});
