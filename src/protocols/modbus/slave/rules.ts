import { FORMATS, MAX_ADDRESS, SLAVE_ID_RANGE } from "./types";

/**
 * Pure Modbus Slave signal/config checks. The family-level validator maps
 * codes to messages and refs. Server side: every signal is a holding
 * register the gateway answers for, so two active signals on the same
 * address collide (unlike the master's overlap-merging reads).
 */

export interface MbsSignalShape {
  active: boolean;
  lenBits: number;
  format: number;
  bit: number;
  address: number;
  readWrite: number;
  stringLength: number;
}

/** All violated rule codes for one signal (empty = valid). */
export function checkMbsSignal(signal: MbsSignalShape): string[] {
  const violations: string[] = [];

  if (signal.readWrite < 0 || signal.readWrite > 2) violations.push("MBS-READWRITE");
  if (signal.address < 0 || signal.address > MAX_ADDRESS) violations.push("MBS-ADDRESS-RANGE");

  if (signal.format === FORMATS.STRING) {
    if (signal.stringLength < 1) violations.push("MBS-STRING-LEN");
  } else {
    // Only 16/32-bit register data has been observed (fixture is 16 only;
    // 32 appears for consumption signals in the desktop creation logic).
    if (signal.lenBits !== 16 && signal.lenBits !== 32) violations.push("MBS-LEN-FORMAT");
    if (signal.format !== FORMATS.UNSIGNED && signal.format !== FORMATS.SIGNED_C2) {
      violations.push("MBS-LEN-FORMAT");
    }
  }

  return violations;
}

/** Address collisions between active signals (same address + slave index). */
export function findAddressCollisions(
  signals: Array<{ id: number; active: boolean; address: number; slaveIndex: number }>,
): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  const seen = new Map<string, number>();
  for (const s of signals) {
    if (!s.active) continue;
    const key = `${s.slaveIndex}:${s.address}`;
    const first = seen.get(key);
    if (first !== undefined) pairs.push([first, s.id]);
    else seen.set(key, s.id);
  }
  return pairs;
}

export function isValidSlaveId(id: number): boolean {
  return id >= SLAVE_ID_RANGE.min && id <= SLAVE_ID_RANGE.max;
}
