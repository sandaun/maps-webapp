import type { MonitorFrame, RollingRates } from "./diagnostics-parsing";

/** At most 61 one-second buckets. A sliding display window must not cap the
 * measured traffic rate when more than 10,000 lines arrive in a minute. */
export function createDiagnosticRateCounter() {
  const buckets = new Map<number, { knx: number; modbus: number }>();
  let lastSequence = -1;
  const prune = (second: number) => {
    for (const key of buckets.keys()) if (key < second - 60) buckets.delete(key);
  };
  return {
    add(frame: Pick<MonitorFrame, "i" | "at" | "proto">) {
      if (frame.i <= lastSequence) return;
      lastSequence = frame.i;
      const second = Math.floor(Date.parse(frame.at) / 1000);
      if (!Number.isFinite(second)) return;
      prune(second);
      const bucket = buckets.get(second) ?? { knx: 0, modbus: 0 };
      if (frame.proto === "KNX") bucket.knx++;
      else if (frame.proto === "MODBUS") bucket.modbus++;
      buckets.set(second, bucket);
    },
    read(nowMs: number): RollingRates {
      const second = Math.floor(nowMs / 1000);
      prune(second);
      let knx = 0;
      let modbus = 0;
      for (const [at, bucket] of buckets) {
        if (at > second) continue;
        knx += bucket.knx;
        modbus += bucket.modbus;
      }
      return { knxPerMin: knx, modbusPerMin: modbus, modbusPerSec: modbus / 60 };
    },
    clear() { buckets.clear(); },
  };
}
