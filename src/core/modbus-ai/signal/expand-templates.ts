// Source: Signal ad9d60c6619bfab7a9186e96938bd0b20a4403cc, src/lib/ai/expansion/expand-templates.ts.
// ---------------------------------------------------------------------------
// Modbus signal expansion — turn LLM-emitted templates into flat signals
// ---------------------------------------------------------------------------
// The LLM emits one signal per logical row in the source document. Some of
// those rows cover many addresses (per-unit formulas, textual ranges) or
// many bits (BIT MASK registers, coded series like E0..EF). Instead of
// asking the LLM to expand them — which inflates the response, costs
// tokens, and routinely hits provider output caps — the LLM emits a
// compact `addressTemplate` and/or `bitExpansion` and this module
// deterministically produces the flat list ready for validation.
//
// The two axes are orthogonal: a single template can have an
// addressTemplate, a bitExpansion, both (cartesian product), or neither
// (passthrough).

import type {
  AIModbusSignal,
  BitDescriptor,
  BitExpansion,
} from './signal-types';
import {
  resolveUnitIndices,
  type ExpandOptions,
  type UnitExpansionMode,
} from './expansion-options';

export type { ExpandOptions, UnitExpansionMode };

const DEFAULT_UNIT_NAME_TEMPLATE = '{name} (Unit {N})';
const DEFAULT_BIT_NAME_TEMPLATE = '{name} {bit_name}';

/**
 * Pre-expansion typeguard. Accepts both plain signals (address as number)
 * and templates (address null + addressTemplate populated). Used by the
 * route layer to filter LLM output that survived schema validation but
 * may still contain partials from fallback paths. The flat-only
 * `isAIModbusSignal` from `validation/modbus-addresses.ts` is the
 * post-expansion sibling.
 */
export function isAIModbusTemplate(s: {
  confidence: number;
  [key: string]: unknown;
}): s is AIModbusSignal {
  return (
    typeof s.deviceId === 'string' &&
    typeof s.signalName === 'string' &&
    typeof s.registerType === 'string' &&
    (typeof s.address === 'number' || s.address === null) &&
    typeof s.dataType === 'string'
  );
}

export interface ExpansionResult {
  /** Flat signals with non-null address; ready for validateModbusAddresses. */
  signals: AIModbusSignal[];
  /** Number of input templates that triggered any expansion. */
  templatesExpanded: number;
  /**
   * Signals produced from addressTemplate expansion. DERIVED:
   * `perUnitOnlySignals + perUnitBitMaskSignals`. Kept for backward
   * compatibility with downstream consumers that already read it.
   * Note this overlaps with `bitExpansions` for combined templates.
   */
  unitExpansions: number;
  /**
   * Signals produced from bitExpansion expansion. DERIVED:
   * `bitMaskOnlySignals + perUnitBitMaskSignals`. Kept for backward
   * compatibility. Note this overlaps with `unitExpansions` for combined
   * templates.
   */
  bitExpansions: number;
  /**
   * Signals produced from addressTemplate-only templates (no bitExpansion).
   * Disjoint from the other two `*Signals` counters.
   */
  perUnitOnlySignals: number;
  /**
   * Signals produced from bitExpansion-only templates (no addressTemplate).
   * Disjoint from the other two `*Signals` counters.
   */
  bitMaskOnlySignals: number;
  /**
   * Signals produced from templates that have BOTH addressTemplate and
   * bitExpansion (cartesian product). Disjoint from the other two
   * `*Signals` counters.
   */
  perUnitBitMaskSignals: number;
  /** Total signals produced by any kind of template expansion (no overlap). */
  totalExpandedSignals: number;
  /** Number of input templates with addressTemplate only. */
  perUnitRows: number;
  /** Number of input templates with bitExpansion only. */
  bitMaskRows: number;
  /** Number of input templates with both addressTemplate and bitExpansion. */
  perUnitBitMaskRows: number;
  /**
   * Number of distinct unit indices detected across all per-unit templates
   * (max - min + 1 of the union of indexRanges). Useful for the UI to
   * show "16 units detected".
   */
  unitsDetected: number;
  /**
   * Custom indices the caller asked for that fell outside the source
   * indexRange and were skipped. Empty for `'all'` and `'firstN'` modes.
   * Caller can surface these as an info to clarify what was ignored.
   */
  unitsSkipped: number[];
  /**
   * For each input template that has an addressTemplate, the original
   * detected indexRange and the indices actually produced. Useful for the
   * UI to show "Showing N of M units" affordances.
   */
  detectedUnitRanges: Array<{
    /** signalName seed of the template (pre-expansion) for tooltip / labelling. */
    signalName: string;
    /** Inclusive [min, max] from the source addressTemplate.indexRange. */
    range: [number, number];
    /** Indices actually produced for this template after applying unitMode. */
    producedIndices: number[];
  }>;
}

/**
 * Expand a list of LLM-emitted Modbus signals (which may contain
 * `addressTemplate` / `bitExpansion`) into a flat list with concrete
 * addresses and per-bit positions.
 *
 * Semantics:
 *   - No template fields → passthrough (signal kept as-is, with
 *     `address` asserted non-null).
 *   - addressTemplate only → one signal per index in `[min..max]`.
 *   - bitExpansion only → one signal per bit, all sharing the parent
 *     address (which must therefore be a number).
 *   - Both → cartesian product (indices × bits).
 *
 * Throws on programmer/data errors that should never have passed
 * schema validation (e.g. inverted index range, missing address when
 * neither template is present).
 */
export function expandModbusTemplates(
  templates: AIModbusSignal[],
  options: ExpandOptions = {},
): ExpansionResult {
  const out: AIModbusSignal[] = [];
  const groupByUnit = options.groupByUnit ?? false;
  const unitNameOffset = options.unitNameOffset ?? 0;

  const currentUnitBlock = new Map<number, AIModbusSignal[]>();
  
  const flushUnitBlock = () => {
    if (currentUnitBlock.size === 0) return;
    const unitIndices = Array.from(currentUnitBlock.keys()).sort((a, b) => a - b);
    for (const idx of unitIndices) {
      out.push(...currentUnitBlock.get(idx)!);
    }
    currentUnitBlock.clear();
  };

  let templatesExpanded = 0;
  // Disjoint per-signal counters: every expanded signal is counted in
  // exactly ONE of these three. The legacy `unitExpansions` /
  // `bitExpansions` are derived from these (with deliberate overlap on
  // combined templates) at the end of the function.
  let perUnitOnlySignals = 0;
  let bitMaskOnlySignals = 0;
  let perUnitBitMaskSignals = 0;
  // Per-row template counters (one per source row).
  let perUnitRows = 0;
  let bitMaskRows = 0;
  let perUnitBitMaskRows = 0;
  const unitsSkipped: number[] = [];
  const detectedUnitRanges: ExpansionResult['detectedUnitRanges'] = [];
  const unitMode = options.unitMode;

  for (const sig of templates) {
    // Use `!= null` (loose) so that signals arriving via the route's
    // fallback paths — where the new fields may be undefined rather than
    // explicit null — pass through cleanly without spurious expansion.
    const hasAddrTpl = sig.addressTemplate != null;
    const hasBitExp = sig.bitExpansion != null;

    if (!hasAddrTpl && !hasBitExp) {
      // Passthrough. Schema guarantees address is a number here because
      // the .superRefine on ModbusSignalSchema rejects (address=null,
      // addressTemplate=null) outright.
      if (sig.address === null) {
        throw new Error(
          `Signal "${sig.signalName}" has no address and no addressTemplate; should have failed schema validation.`,
        );
      }
      
      if (groupByUnit) flushUnitBlock();
      
      out.push({
        ...sig,
        addressTemplate: null,
        bitExpansion: null,
      });
      continue;
    }

    templatesExpanded++;
    if (hasAddrTpl && hasBitExp) perUnitBitMaskRows++;
    else if (hasAddrTpl) perUnitRows++;
    else if (hasBitExp) bitMaskRows++;

    let indices: IndexEntry[];
    if (hasAddrTpl) {
      const tpl = sig.addressTemplate!;
      const [min, max] = tpl.indexRange;
      if (max < min) {
        throw new Error(
          `addressTemplate.indexRange is inverted: [${min}, ${max}]. Expected min <= max.`,
        );
      }
      if (!Number.isInteger(min) || !Number.isInteger(max)) {
        throw new Error(
          `addressTemplate.indexRange must be integers, got [${min}, ${max}].`,
        );
      }
      const resolved = resolveUnitIndices(tpl.indexRange, unitMode);
      for (const skip of resolved.skipped) {
        if (!unitsSkipped.includes(skip)) unitsSkipped.push(skip);
      }
      indices = resolved.indices.map((i) => ({
        index: i,
        address: tpl.base + i * tpl.stride,
      }));
      detectedUnitRanges.push({
        signalName: sig.signalName,
        range: tpl.indexRange,
        producedIndices: resolved.indices,
      });
    } else {
      if (groupByUnit) flushUnitBlock();
      indices = [{ index: null, address: requireAddress(sig) }];
    }

    const bits = hasBitExp
      ? expandBitDimension(sig.bitExpansion!)
      : [{ descriptor: null }];

    for (const idx of indices) {
      for (const b of bits) {
        const expanded = composeFlatSignal(
          sig,
          idx,
          b,
          unitNameOffset,
        );
        
        if (groupByUnit && idx.index !== null) {
          let bucket = currentUnitBlock.get(idx.index);
          if (!bucket) {
            bucket = [];
            currentUnitBlock.set(idx.index, bucket);
          }
          bucket.push(expanded);
        } else {
          out.push(expanded);
        }
        
        const isPerUnit = idx.index !== null;
        const isBitMask = b.descriptor !== null;
        if (isPerUnit && isBitMask) perUnitBitMaskSignals++;
        else if (isPerUnit) perUnitOnlySignals++;
        else if (isBitMask) bitMaskOnlySignals++;
      }
    }
  }

  // Compute distinct unit count across the union of detected indexRanges.
  // We use the union size (max - min + 1 over the bounding box) rather than
  // the literal set of produced indices because the UI labels it
  // "N units detected" — which reflects the source document's declared
  // range, independent of any restrictive `unitMode` the caller applied.
  let unitsDetected = 0;
  if (detectedUnitRanges.length > 0) {
    let unionMin = Infinity;
    let unionMax = -Infinity;
    for (const r of detectedUnitRanges) {
      if (r.range[0] < unionMin) unionMin = r.range[0];
      if (r.range[1] > unionMax) unionMax = r.range[1];
    }
    unitsDetected = unionMax - unionMin + 1;
  }

  // Derive legacy fields. `unitExpansions` and `bitExpansions` deliberately
  // overlap on combined templates — kept for backward compat with any
  // downstream that already reads them; new code should prefer the
  // disjoint *Signals fields and `totalExpandedSignals`.
  const unitExpansions = perUnitOnlySignals + perUnitBitMaskSignals;
  const bitExpansions = bitMaskOnlySignals + perUnitBitMaskSignals;
  const totalExpandedSignals =
    perUnitOnlySignals + bitMaskOnlySignals + perUnitBitMaskSignals;

  if (groupByUnit) flushUnitBlock();

  return {
    signals: out,
    templatesExpanded,
    unitExpansions,
    bitExpansions,
    perUnitOnlySignals,
    bitMaskOnlySignals,
    perUnitBitMaskSignals,
    totalExpandedSignals,
    perUnitRows,
    bitMaskRows,
    perUnitBitMaskRows,
    unitsDetected,
    unitsSkipped,
    detectedUnitRanges,
  };
}

// ── Index (address) dimension ──────────────────────────────────────────────

interface IndexEntry {
  index: number | null; // null = no addressTemplate; pass through original address
  address: number;
}

function requireAddress(sig: AIModbusSignal): number {
  if (sig.address === null) {
    throw new Error(
      `Signal "${sig.signalName}" has bitExpansion but no address. Either set address (a number) or also provide addressTemplate.`,
    );
  }
  return sig.address;
}

// ── Bit dimension ───────────────────────────────────────────────────────────

interface BitEntry {
  descriptor: BitDescriptor | null;
}

function expandBitDimension(exp: BitExpansion): BitEntry[] {
  return exp.bits.map((d) => ({ descriptor: d }));
}

// ── Compose one flat signal from an (index, bit) pair ───────────────────────

function composeFlatSignal(
  sig: AIModbusSignal,
  idx: IndexEntry,
  bit: BitEntry,
  unitNameOffset: number = 0,
): AIModbusSignal {
  const composedName = composeName(sig, idx, bit, unitNameOffset);

  // Bit fields override the parent's bit/bitCount; otherwise keep parent.
  let outBit: number | null = sig.bit;
  let outBitCount: number | null = sig.bitCount;
  let outDescription: string | null = sig.description;

  if (bit.descriptor !== null) {
    outBit = bit.descriptor.bit;
    outBitCount = 1;
    if (bit.descriptor.description !== null) {
      outDescription = bit.descriptor.description;
    }
  }

  return {
    ...sig,
    signalName: composedName,
    address: idx.address,
    bit: outBit,
    bitCount: outBitCount,
    description: outDescription,
    addressTemplate: null,
    bitExpansion: null,
  };
}

// ── Name composition ────────────────────────────────────────────────────────

function composeName(
  sig: AIModbusSignal,
  idx: IndexEntry,
  bit: BitEntry,
  unitNameOffset: number,
): string {
  const baseName = stripTrailingIndexPlaceholder(
    sig.signalName,
    sig.addressTemplate?.indexVar ?? null,
  );

  const hasIdx = idx.index !== null;
  const hasBit = bit.descriptor !== null;

  if (!hasIdx && !hasBit) return baseName;

  if (hasBit && !hasIdx) {
    const tpl = sig.bitExpansion?.nameTemplate ?? DEFAULT_BIT_NAME_TEMPLATE;
    return substituteBit(tpl, baseName, bit.descriptor!);
  }

  if (hasIdx && !hasBit) {
    const tpl = sig.addressTemplate?.nameTemplate ?? DEFAULT_UNIT_NAME_TEMPLATE;
    return substituteIndex(
      tpl,
      baseName,
      idx.index! + unitNameOffset,
      sig.addressTemplate!.indexVar,
    );
  }

  // Combined: bit template first, then unit suffix wrapper.
  // The bit template is documented to NOT include "(Unit {N})"; the
  // pipeline appends it deterministically so the user gets one
  // canonical naming convention even when the LLM forgets.
  const bitTpl = sig.bitExpansion?.nameTemplate ?? DEFAULT_BIT_NAME_TEMPLATE;
  const bitName = substituteBit(bitTpl, baseName, bit.descriptor!);
  const unitTpl =
    sig.addressTemplate?.nameTemplate ?? DEFAULT_UNIT_NAME_TEMPLATE;
  return substituteIndex(
    unitTpl,
    bitName,
    idx.index! + unitNameOffset,
    sig.addressTemplate!.indexVar,
  );
}

/**
 * The LLM is told to emit names without trailing index placeholders, but
 * older prompts and Kimi habit can leave a literal "N" at the end (e.g.
 * "Unit operation mode N"). Strip it so the substituted output reads
 * cleanly: "Unit operation mode (Unit 0)" instead of "Unit operation
 * mode N (Unit 0)".
 */
function stripTrailingIndexPlaceholder(
  name: string,
  indexVar: string | null,
): string {
  if (!indexVar) return name;
  const re = new RegExp(`\\s+${escapeRegExp(indexVar)}\\s*$`);
  return name.replace(re, '');
}

function substituteIndex(
  template: string,
  parentName: string,
  index: number,
  indexVar: string,
): string {
  const indexToken = `{${indexVar}}`;
  return template
    .split('{name}')
    .join(parentName)
    .split(indexToken)
    .join(String(index));
}

function substituteBit(
  template: string,
  parentName: string,
  descriptor: BitDescriptor,
): string {
  return template
    .split('{name}')
    .join(parentName)
    .split('{bit}')
    .join(String(descriptor.bit))
    .split('{bit_name}')
    .join(descriptor.name);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Expansion summary (UI/serialization) ────────────────────────────────────

/**
 * Lightweight, JSON-safe subset of {@link ExpansionResult} suitable for
 * sending to the client (streaming `complete` event and non-stream
 * response). The UI uses these fields to render the "compact rows
 * expanded" chip and its tooltip without re-parsing the info string.
 *
 * Counters are disjoint: every expanded signal is counted in exactly one
 * of `perUnitOnlySignals`, `bitMaskOnlySignals`, `perUnitBitMaskSignals`.
 */
export interface ExpansionSummary {
  templatesExpanded: number;
  perUnitOnlySignals: number;
  bitMaskOnlySignals: number;
  perUnitBitMaskSignals: number;
  totalExpandedSignals: number;
  perUnitRows: number;
  bitMaskRows: number;
  perUnitBitMaskRows: number;
  unitsDetected: number;
}

export function summarizeExpansion(result: ExpansionResult): ExpansionSummary {
  return {
    templatesExpanded: result.templatesExpanded,
    perUnitOnlySignals: result.perUnitOnlySignals,
    bitMaskOnlySignals: result.bitMaskOnlySignals,
    perUnitBitMaskSignals: result.perUnitBitMaskSignals,
    totalExpandedSignals: result.totalExpandedSignals,
    perUnitRows: result.perUnitRows,
    bitMaskRows: result.bitMaskRows,
    perUnitBitMaskRows: result.perUnitBitMaskRows,
    unitsDetected: result.unitsDetected,
  };
}

/**
 * Build the human-readable info string shown in the panel. Categories
 * with zero signals are omitted so the message stays clean for PDFs
 * with only one expansion pattern. Returns null when nothing was
 * expanded (caller should not render any banner).
 */
export function formatExpansionMessage(
  result: Pick<
    ExpansionResult,
    | 'templatesExpanded'
    | 'perUnitOnlySignals'
    | 'bitMaskOnlySignals'
    | 'perUnitBitMaskSignals'
    | 'totalExpandedSignals'
    | 'unitsDetected'
  >,
): string | null {
  if (result.templatesExpanded === 0) return null;
  const parts: string[] = [];
  if (result.perUnitOnlySignals > 0) {
    parts.push(
      `${result.perUnitOnlySignals} across ${result.unitsDetected} unit(s)`,
    );
  }
  if (result.bitMaskOnlySignals > 0) {
    parts.push(`${result.bitMaskOnlySignals} bit-mask flag(s)`);
  }
  if (result.perUnitBitMaskSignals > 0) {
    parts.push(
      `${result.perUnitBitMaskSignals} combined (units × bit-mask flags)`,
    );
  }
  const breakdown = parts.length > 0 ? `: ${parts.join(', ')}` : '';
  const rowWord = result.templatesExpanded === 1 ? 'row' : 'rows';
  const sigWord = result.totalExpandedSignals === 1 ? 'signal' : 'signals';
  return `Expanded ${result.templatesExpanded} compact ${rowWord} into ${result.totalExpandedSignals} ${sigWord}${breakdown}.`;
}
