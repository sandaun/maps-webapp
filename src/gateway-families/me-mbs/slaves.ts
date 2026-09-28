import type { MeControllerInfo, MeGroupInfo } from "@/protocols/me";
import type { MbsSlave } from "@/protocols/modbus/slave";

/**
 * The ME-MBS Modbus slave list (`mInternal.MbSlavesArray`) and the slave a
 * signal belongs to, ported from the desktop tool
 * (`IntesisBoxMAPS.Projects/IntesisProjectMbsMe_RT.cs`, `P`). MAPS derives
 * the list from the groups in both slave modes; only MULTIPLE uses it for
 * the signals and the XBL.
 */

/**
 * `InitializeMbSlaves` (P:3102) with `InternalMbs.CreateMbSlave`
 * (InternalMbs.cs:2166): per controller with enabled groups, a general
 * slave, one per enabled group and one for the alarm codes; addresses
 * start at the RTU slave number.
 */
export function deriveMbSlaves(controllers: MeControllerInfo[], slaveNumber: number): MbsSlave[] {
  const slaves: MbsSlave[] = [];
  const create = (index: number, description: string) => {
    const address = index + slaveNumber;
    if (!slaves.some((x) => x.address === address)) slaves.push({ address, description });
  };
  let num = 0;
  controllers.slice(0, 2).forEach((g50, c) => {
    const enabled = g50.groups.filter((g) => g.enabled);
    if (enabled.length !== 0) create(num++, `General Controller ${c + 1}`);
    for (const group of enabled) create(num++, `C${c + 1}G${group.index + 1}`);
    if (enabled.length !== 0 && g50.addErrorSignals) create(num++, `Error Signals Controller ${c + 1}`);
  });
  return slaves;
}

/**
 * `GetSlaveIndex` (P:1652): position in `slaves` of the slave a group, a
 * controller's general signals or its alarm codes belong to (-1 when the
 * list has no such address).
 */
export function slaveIndexOf(
  controllers: MeControllerInfo[],
  slaveNumber: number,
  slaves: MbsSlave[],
  g50Index: number,
  group: Pick<MeGroupInfo, "index"> | null,
  isErrorCode = false,
): number {
  const enabledOf = (c: number) => controllers[c].groups.filter((g) => g.enabled);
  const first = enabledOf(0).length;
  let slaveAddress: number;
  if (group !== null) {
    const position = enabledOf(g50Index).findIndex((g) => g.index === group.index);
    if (g50Index === 0 || first === 0) {
      slaveAddress = position + 1;
    } else {
      slaveAddress = position + 2 + first;
      if (controllers[0].addErrorSignals) slaveAddress++;
    }
    slaveAddress += slaveNumber;
    return slaves.findIndex((x) => x.address === slaveAddress);
  }
  if (g50Index === 0 && !isErrorCode) return 0;
  if (g50Index === 0) {
    slaveAddress = 1 + slaveNumber + first;
  } else {
    if (first === 0) return 0;
    slaveAddress = 1 + slaveNumber + first;
    if (isErrorCode) slaveAddress += enabledOf(g50Index).length + 1;
    if (controllers[0].addErrorSignals) slaveAddress++;
  }
  return slaves.findIndex((x) => x.address === slaveAddress);
}

/** What `slaveIndexMismatches` needs of one Modbus signal. */
export interface SlaveCheckSignal {
  g50Index: number;
  groupIndex: number;
  /** -1 = general or group signal; otherwise an alarm code. */
  unitId: number;
  slaveIndex: number;
  /** Conversion indices of `IdxOperations`. */
  operations: number[];
}

export interface SlaveMismatches {
  /** The slave list is not the one MAPS derives from the groups. */
  staleList: boolean;
  /** Positions of the signals whose slave does not match the list. */
  signals: number[];
}

/**
 * MULTIPLE mode only: signals whose slave is not the one `GetSlaveIndex`
 * gives with the current list. MAPS leaves such values after some changes
 * (the +1/-1 of `EnableGroup` / `DeleteGroupSignals` also hits the alarm
 * codes, and `ModifyController` does not touch the other controller) and
 * copies them to the XBL as they are, so the gateway would answer those
 * signals on the wrong slave. Alarm codes are right when they keep
 * SlaveIndex -1 and carry their slave index as the operation, the format
 * MAPS saves.
 */
export function slaveIndexMismatches(
  controllers: MeControllerInfo[],
  slaveNumber: number,
  slaves: MbsSlave[],
  signals: SlaveCheckSignal[],
): SlaveMismatches {
  const derived = deriveMbSlaves(controllers, slaveNumber);
  const staleList =
    derived.length !== slaves.length ||
    derived.some((x, i) => x.address !== slaves[i].address || x.description !== slaves[i].description);
  const wrong: number[] = [];
  signals.forEach((s, i) => {
    const g50 = controllers[s.g50Index];
    if (!g50) return;
    if (s.unitId !== -1) {
      const expected = slaveIndexOf(controllers, slaveNumber, slaves, s.g50Index, null, true);
      const ok = s.slaveIndex === -1 && (expected === -1 ? s.operations.length === 0 : s.operations[0] === expected);
      if (!ok) wrong.push(i);
      return;
    }
    const group = s.groupIndex === -1 ? null : g50.groups[s.groupIndex];
    if (s.groupIndex !== -1 && !group) return;
    if (s.slaveIndex !== slaveIndexOf(controllers, slaveNumber, slaves, s.g50Index, group ?? null)) wrong.push(i);
  });
  return { staleList, signals: wrong };
}
