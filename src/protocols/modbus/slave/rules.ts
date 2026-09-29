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

/** Highest register address when the family passes none (`InternalMbs` default `maxAddress`, InternalMbs.cs:405). */
export const MBS_DEFAULT_MAX_ADDRESS = 20000;

export type MbsObjectRuleCode =
  | "MBS-FORMAT-NONE"
  | "MBS-STRING-LEN"
  | "MBS-ADDRESS-DUP"
  | "MBS-BIT-DUP"
  | "MBS-ADDRESS-USED"
  | "MBS-ADDRESS-RANGE"
  | "MBS-ADDRESS-BASE";

export interface MbsObjectShape {
  id: number;
  lenBits: number;
  format: number;
  bit: number;
  address: number;
  stringLength: number;
  slaveIndex: number;
}

/**
 * Literal port of `InternalMbs.CheckProjectObjects` (InternalMbs.cs:1528-1597)
 * over the active signals. MAPS stops at the first error; here every signal
 * gets at most one violation, the first MAPS would report for it, and `id` is
 * the signal MAPS points at (for a repeat, the OTHER signal). Kept as MAPS
 * has it — see docs/reference/mbs-knx-analisi.md §5:
 * - a 16-bit register compares with the CURRENT signal's format, so it also
 *   collides with a BitFields at the same address, and skips only the 32-bit
 *   ones (a 64-bit one at the same address collides);
 * - 32/64-bit registers only look at `address` and `address + 1`.
 */
export function checkMbsObjects(
  active: MbsObjectShape[],
  options: { maxAddress: number; registerBase: number },
): Array<{ code: MbsObjectRuleCode; id: number }> {
  const out: Array<{ code: MbsObjectRuleCode; id: number }> = [];
  for (const obj of active) {
    const others = active.filter((x) => x.id !== obj.id && x.slaveIndex === obj.slaveIndex);
    if (obj.format === FORMATS.NO_FORMAT) {
      out.push({ code: "MBS-FORMAT-NONE", id: obj.id });
      continue;
    }
    if (obj.format === FORMATS.STRING && obj.stringLength === -1) {
      out.push({ code: "MBS-STRING-LEN", id: obj.id });
      continue;
    }
    let clash: MbsObjectShape | undefined;
    let clashCode: MbsObjectRuleCode = "MBS-ADDRESS-DUP";
    if (obj.lenBits === 16 && obj.format !== FORMATS.BITFIELDS) {
      clash = others.find((x) => x.lenBits !== 32 && x.address === obj.address);
    } else if ((obj.lenBits === 32 || obj.lenBits === 64) && obj.format !== FORMATS.BITFIELDS) {
      clash = others.find((x) => x.address === obj.address || x.address === obj.address + 1);
    } else if (obj.format === FORMATS.BITFIELDS) {
      clashCode = "MBS-BIT-DUP";
      clash = others.find((x) => x.format === obj.format && x.address === obj.address && x.bit === obj.bit);
    } else if (obj.format === FORMATS.STRING) {
      clashCode = "MBS-ADDRESS-USED";
      const end = obj.address + Math.trunc(obj.stringLength / 2);
      clash = others.find((x) => x.address >= obj.address && x.address < end);
    }
    if (clash) {
      out.push({ code: clashCode, id: clash.id });
      continue;
    }
    if (obj.address > options.maxAddress) {
      out.push({ code: "MBS-ADDRESS-RANGE", id: obj.id });
      continue;
    }
    if (obj.address === 0 && options.registerBase === 1) {
      out.push({ code: "MBS-ADDRESS-BASE", id: obj.id });
    }
  }
  return out;
}
