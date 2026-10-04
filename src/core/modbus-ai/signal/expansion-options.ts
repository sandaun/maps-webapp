// Source: Signal ad9d60c6619bfab7a9186e96938bd0b20a4403cc, src/lib/ai/expansion/expansion-options.ts.
// ---------------------------------------------------------------------------
// Unit expansion options — control which units (N values) are produced
// ---------------------------------------------------------------------------
// `expandModbusTemplates` always expanded EVERY unit in the detected
// indexRange. For real deployments where the user only operates K of the M
// possible units, that produces noise. These options let the caller restrict
// the unit dimension. The bit dimension is always fully expanded — bits are
// semantic, not optional.

/**
 * How to handle the unit (addressTemplate.indexRange) dimension during
 * expansion. The bit (bitExpansion) dimension is always fully expanded.
 */
export type UnitExpansionMode =
  | { kind: 'all' }
  | { kind: 'firstN'; count: number }
  | { kind: 'custom'; indices: number[] };

export interface ExpandOptions {
  /** Default `{ kind: 'all' }` — preserves current behaviour. */
  unitMode?: UnitExpansionMode;
  /** Group expanded signals by their resolved unit index (e.g. all Unit 0 together). Defaults to false. */
  groupByUnit?: boolean;
  /** Value to add to the unit index for display purposes in the signal name. Default is 0. */
  unitNameOffset?: number;
}

/**
 * Resolve a UnitExpansionMode against a concrete `[min, max]` indexRange.
 * Returns the indices that should actually be emitted (in ascending order)
 * and any indices the caller asked for but were out of range (skipped).
 *
 * Pure: no side effects, no exceptions on out-of-range custom indices —
 * those are returned via `skipped` so the caller can surface an info.
 */
export function resolveUnitIndices(
  indexRange: [number, number],
  mode: UnitExpansionMode | undefined,
): { indices: number[]; skipped: number[] } {
  const [min, max] = indexRange;
  if (max < min) return { indices: [], skipped: [] };
  const m: UnitExpansionMode = mode ?? { kind: 'all' };

  if (m.kind === 'all') {
    const indices: number[] = [];
    for (let i = min; i <= max; i++) indices.push(i);
    return { indices, skipped: [] };
  }

  if (m.kind === 'firstN') {
    if (m.count <= 0) return { indices: [], skipped: [] };
    const cap = Math.min(max, min + m.count - 1);
    const indices: number[] = [];
    for (let i = min; i <= cap; i++) indices.push(i);
    return { indices, skipped: [] };
  }

  // custom
  const requested = [...new Set(m.indices)].sort((a, b) => a - b);
  const indices: number[] = [];
  const skipped: number[] = [];
  for (const idx of requested) {
    if (idx >= min && idx <= max) indices.push(idx);
    else skipped.push(idx);
  }
  return { indices, skipped };
}
