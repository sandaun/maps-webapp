/**
 * KNX communication flags. Interlocks from IntesisKnx.UpdateFlagsValue:
 * - clearing U also clears Ri
 * - setting Ri forces U on and clears R (Ri and R are mutually exclusive)
 * - setting R clears Ri
 */
export interface KnxFlags {
  /** Update on start-up / bus reset. */
  u: boolean;
  /** Transmit: update on transmit telegrams from KNX. */
  t: boolean;
  /** Read on init. Incompatible with R. */
  ri: boolean;
  /** Writable from the KNX bus. */
  w: boolean;
  /** Readable from the KNX bus. Incompatible with Ri. */
  r: boolean;
}

export const DEFAULT_FLAGS: KnxFlags = { u: true, t: false, ri: false, w: true, r: false };

/** Apply the interlock rules after changing one flag. */
export function applyFlagChange(flags: KnxFlags, changed: keyof KnxFlags): KnxFlags {
  const next = { ...flags };
  if (changed === "ri" && next.ri) {
    next.u = true;
    next.r = false;
  }
  if (changed === "r" && next.r) {
    next.ri = false;
  }
  if (changed === "u" && !next.u) {
    next.ri = false;
  }
  return next;
}

export function hasAnyFlag(flags: KnxFlags): boolean {
  return flags.u || flags.t || flags.ri || flags.w || flags.r;
}

/**
 * Port of `IntesisKnx.UpdateFlagsValueFromRWObject` (IntesisKnx.cs): the
 * flags a KNX object keeps given the read/write mode of the other side's
 * object. A "write" object drops R and T, a "read" one drops W, U and Ri.
 * With `forceOverride` (MAPS: the read/write column itself changed) the
 * mode's own flags are also turned on: W+U for "write", R+T for "read" and
 * all four for "readwrite".
 */
export function flagsForRwMode(
  flags: KnxFlags,
  rwMode: "read" | "write" | "readwrite",
  forceOverride: boolean,
): KnxFlags {
  const next = { ...flags };
  switch (rwMode) {
    case "write":
      next.r = false;
      next.t = false;
      if (forceOverride) {
        next.w = true;
        next.u = true;
      }
      break;
    case "read":
      next.w = false;
      next.u = false;
      next.ri = false;
      if (forceOverride) {
        next.r = true;
        next.t = true;
      }
      break;
    case "readwrite":
      if (forceOverride) {
        next.w = true;
        next.u = true;
        next.r = true;
        next.t = true;
      }
      break;
  }
  return next;
}

/**
 * Port of `IntesisKnx.UpdateFlagsValue` (IntesisKnx.cs) for an edit that
 * turned `before` into `after`: clearing U clears Ri; changing Ri (either
 * way) clears R and sets U, unless the other side's mode is "read"; setting
 * R clears Ri. MAPS edits one flag cell at a time; when several changed,
 * each is applied as its own cell edit on the result of the previous one, in
 * the order T, W, U, Ri, R (T and W have no interlocks).
 */
export function applyFlagEdit(
  before: KnxFlags,
  after: KnxFlags,
  rwMode?: "read" | "write" | "readwrite",
): KnxFlags {
  const next = { ...before };
  for (const flag of ["t", "w", "u", "ri", "r"] as const) {
    if (after[flag] === before[flag]) continue;
    next[flag] = after[flag];
    if (flag === "u" && !next.u) next.ri = false;
    if (flag === "ri" && rwMode !== "read") {
      next.r = false;
      next.u = true;
    }
    if (flag === "r" && next.r) next.ri = false;
  }
  return next;
}
