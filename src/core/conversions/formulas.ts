/**
 * What a conversion does to a value, for the editor's summaries, plain
 * explanations and "Try it". The arithmetic follows the MAPS simulator
 * (`IntesisMath`, temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/
 * IntesisBoxMAPS/IntesisMath.cs:9-260), the only reference we have of how the
 * gateway applies them; the inverse is the one MAPS sends to the gateway for
 * the grey flow (`IntesisConversion.CreateConversion`, IntesisConversion.cs:136-179).
 */

import {
  COMPARISON,
  CONVERSION_TYPE,
  FILTER_TYPE,
  parseConversionNumber,
  type ConversionValues,
} from "./rules";

export type ConversionOutcome =
  | { kind: "value"; value: number }
  /** A no-limit filter whose condition fails: the value is not forwarded (`isValidResult = false`). */
  | { kind: "discarded" }
  /** The operation cannot run in this direction or with these params. */
  | { kind: "undefined" };

const params = (values: ConversionValues) => values.params.map((p) => parseConversionNumber(p));

/** Display text of a number: at most 6 decimals, "−" for negatives. */
export function formatConversionValue(value: number): string {
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(Object.is(rounded, -0) ? 0 : rounded).replace("-", "−");
}

const show = (value: number | undefined) => (value === undefined ? "?" : formatConversionValue(value));

function conditionHolds(comparison: number, x: number, p3: number, p4: number): boolean {
  switch (comparison) {
    case COMPARISON.EQUAL:
      return x === p3;
    case COMPARISON.DIFFERENT:
      return x !== p3;
    case COMPARISON.LESS:
      return x < p4;
    case COMPARISON.GREATER:
      return x > p3;
    case COMPARISON.IN_RANGE:
      return p3 <= x && x <= p4;
    default:
      return x < p3 || p4 < x;
  }
}

/** Port of `IntesisMath.ApplyFilter` (IntesisMath.cs:127-260). */
export function applyFilter(values: ConversionValues, x: number): ConversionOutcome {
  const [filterType, comparison, p3 = 0, p4 = 0] = params(values);
  if (filterType === undefined || comparison === undefined) return { kind: "undefined" };
  const holds = conditionHolds(comparison, x, p3, p4);
  if (filterType === FILTER_TYPE.COMPARISON) return { kind: "value", value: holds ? 1 : 0 };
  if (filterType === FILTER_TYPE.NO_LIMIT) return holds ? { kind: "value", value: x } : { kind: "discarded" };
  // Limited filter: the value that fails the condition is replaced by a limit.
  switch (comparison) {
    case COMPARISON.EQUAL:
    case COMPARISON.DIFFERENT:
    case COMPARISON.GREATER:
      return { kind: "value", value: holds ? x : p3 };
    case COMPARISON.LESS:
      return { kind: "value", value: holds ? x : p4 };
    case COMPARISON.IN_RANGE:
      return { kind: "value", value: holds ? x : x < p3 ? p3 : p4 };
    default:
      return { kind: "value", value: holds ? x : p3 };
  }
}

/** Port of `IntesisMath.EvaluateScaleFunction` (IntesisMath.cs:23-50): the input is limited to its range first. */
function applyScale(values: ConversionValues, x: number, inverted: boolean): ConversionOutcome {
  const [a, b, c, d] = params(values);
  if ([a, b, c, d].some((p) => p === undefined)) return { kind: "undefined" };
  let [minIn, maxIn, minOut, maxOut] = [a!, b!, c!, d!];
  if (inverted) [minIn, maxIn, minOut, maxOut] = [minOut, maxOut, minIn, maxIn];
  if (minIn === maxIn) return { kind: "undefined" };
  const input = x < minIn ? minIn : x > maxIn ? maxIn : x;
  if (minOut < maxOut) return { kind: "value", value: minOut + ((input - minIn) * (maxOut - minOut)) / (maxIn - minIn) };
  if (minOut > maxOut) return { kind: "value", value: minOut - ((input - minIn) * (minOut - maxOut)) / (maxIn - minIn) };
  return { kind: "value", value: -1 };
}

/** Port of `IntesisMath.EvaluateArithmeticFunction` (IntesisMath.cs:9-21): y = x · 10^A · B + C. */
function applyArithmetic(values: ConversionValues, x: number, inverted: boolean): ConversionOutcome {
  const [a, b, c] = params(values);
  if (a === undefined || b === undefined || c === undefined) return { kind: "undefined" };
  if (!inverted) return { kind: "value", value: x * 10 ** a * b + c };
  // 1 / B: MAPS throws a division by zero, the gateway has no inverse to apply.
  if (b === 0) return { kind: "undefined" };
  return { kind: "value", value: (x - c) / (b * 10 ** a) };
}

/**
 * Value after one editable conversion. `inverted` is the other flow of a read
 * + write signal. Logical and LUT operations are not simulated: their result
 * depends on data (bit widths, remap tables) the editor does not show.
 */
export function applyConversion(values: ConversionValues, x: number, inverted = false): ConversionOutcome {
  switch (values.type) {
    case CONVERSION_TYPE.FILTER:
      return applyFilter(values, x);
    case CONVERSION_TYPE.SCALE:
      return applyScale(values, x, inverted);
    case CONVERSION_TYPE.ARITH:
      return applyArithmetic(values, x, inverted);
    default:
      return { kind: "undefined" };
  }
}

/** The factor B · 10^A of an arithmetic operation. */
function arithmeticFactor(a: number, b: number): number {
  return b * 10 ** a;
}

/** "y = x · 0.1 − 273.15", simplified from y = x · B · 10^A + C. */
function arithmeticFormula(a: number, b: number, c: number, inverted: boolean): string {
  const k = arithmeticFactor(a, b);
  const offset = (value: number) => (value === 0 ? "" : value > 0 ? ` + ${show(value)}` : ` − ${show(-value)}`);
  if (!inverted) {
    if (k === 0) return `y = ${show(c)}`;
    return `y = x${k === 1 ? "" : ` · ${show(k)}`}${offset(c)}`;
  }
  if (k === 0) return "no inverse";
  const shifted = c === 0 ? "x" : `(x${offset(-c)})`;
  if (k === 1) return `y = ${shifted === "x" ? "x" : shifted.slice(1, -1)}`;
  return `y = ${shifted} / ${show(k)}`;
}

function binary(value: number | undefined): string {
  return value === undefined ? "?" : Math.trunc(value).toString(2);
}

/**
 * One-line mono summary of a conversion, in the form `frmSelectConversion`
 * prints it (`GetFilterFormula`, `GetOperationFormula`, frmSelectConversion.cs:622-745).
 */
export function conversionSummary(values: ConversionValues, inverted = false): string {
  const [p1, p2, p3, p4] = params(values);
  switch (values.type) {
    case CONVERSION_TYPE.FILTER:
      switch (p2) {
        case COMPARISON.EQUAL:
          return `= ${show(p3)}`;
        case COMPARISON.DIFFERENT:
          return `≠ ${show(p3)}`;
        case COMPARISON.LESS:
          return `< ${show(p4)}`;
        case COMPARISON.GREATER:
          return `> ${show(p3)}`;
        case COMPARISON.IN_RANGE:
          return `${show(p3)} ≤ x ≤ ${show(p4)}`;
        case COMPARISON.OUT_RANGE:
          return `x < ${show(p3)} or x > ${show(p4)}`;
        default:
          return "—";
      }
    case CONVERSION_TYPE.SCALE:
      return inverted
        ? `${show(p3)}…${show(p4)} → ${show(p1)}…${show(p2)}`
        : `${show(p1)}…${show(p2)} → ${show(p3)}…${show(p4)}`;
    case CONVERSION_TYPE.ARITH:
      if (p1 === undefined || p2 === undefined || p3 === undefined) return "y = ?";
      return arithmeticFormula(p1, p2, p3, inverted);
    case CONVERSION_TYPE.LOGICAL: {
      // `GetLogicalFormula` lists the non-zero masks; the gateway gets the same masks both ways.
      const masks = [
        ["OR", p1],
        ["AND", p2],
        ["XOR", p3],
      ].filter(([, mask]) => mask !== 0) as [string, number | undefined][];
      return masks.length ? masks.map(([name, mask]) => `${name} ${binary(mask)}`).join(" · ") : "no masks";
    }
    case CONVERSION_TYPE.LUT_REMAP:
      return `Remap table ${show(p1)}`;
    default:
      return "—";
  }
}

const FILTER_CONDITION: Record<number, (p3: string, p4: string) => string> = {
  [COMPARISON.EQUAL]: (v) => `the value equals ${v}`,
  [COMPARISON.DIFFERENT]: (v) => `the value is not ${v}`,
  [COMPARISON.LESS]: (_, v) => `the value is less than ${v}`,
  [COMPARISON.GREATER]: (v) => `the value is greater than ${v}`,
  [COMPARISON.IN_RANGE]: (lo, hi) => `the value is from ${lo} to ${hi}`,
  [COMPARISON.OUT_RANGE]: (lo, hi) => `the value is below ${lo} or above ${hi}`,
};

/** One-line hint for each filter type, from what `ApplyFilter` does with it. */
export const FILTER_TYPE_HINTS: Record<number, string> = {
  [FILTER_TYPE.COMPARISON]: "Sends 1 when the condition is true and 0 when it is false.",
  [FILTER_TYPE.NO_LIMIT]: "Forwards the value when the condition is true. Otherwise the value is not forwarded.",
  [FILTER_TYPE.LIMITED]: "Forwards the value when the condition is true. Otherwise it forwards the limit instead.",
};

/** Plain-language explanation of what the conversion does, or undefined for system entries. */
export function conversionExplanation(values: ConversionValues): string | undefined {
  const [p1, p2, p3, p4] = params(values);
  const [s3, s4] = [show(p3), show(p4)];
  switch (values.type) {
    case CONVERSION_TYPE.FILTER: {
      const condition = p2 === undefined ? undefined : FILTER_CONDITION[p2];
      if (!condition || p1 === undefined) return undefined;
      const when = condition(s3, s4);
      if (p1 === FILTER_TYPE.COMPARISON) return `Sends 1 when ${when}, and 0 otherwise.`;
      if (p1 === FILTER_TYPE.NO_LIMIT) return `Forwards the value when ${when}. Any other value is not forwarded.`;
      switch (p2) {
        case COMPARISON.EQUAL:
          return `Always sends ${s3}: any other value is replaced by ${s3}.`;
        case COMPARISON.DIFFERENT:
          return "Forwards every value unchanged: a value equal to the limit is replaced by the same number.";
        case COMPARISON.LESS:
          return `Values of ${s4} or more are replaced by ${s4}. Lower values pass unchanged.`;
        case COMPARISON.GREATER:
          return `Values of ${s3} or less are replaced by ${s3}. Higher values pass unchanged.`;
        case COMPARISON.IN_RANGE:
          return `Values below ${s3} become ${s3} and values above ${s4} become ${s4}.`;
        default:
          return `Values from ${s3} to ${s4} are replaced by ${s3}. Values outside pass unchanged.`;
      }
    }
    case CONVERSION_TYPE.SCALE:
      return `Values from ${show(p1)} to ${show(p2)} become ${show(p3)} to ${show(p4)}, on a straight line. Values outside ${show(p1)}…${show(p2)} are limited to that range first.`;
    case CONVERSION_TYPE.ARITH:
      return `Calculates ${conversionSummary(values)}.`;
    default:
      return undefined;
  }
}

/** What the gateway applies in the other flow of a read + write signal. */
export function conversionInverseExplanation(values: ConversionValues): string {
  switch (values.type) {
    case CONVERSION_TYPE.FILTER:
      return "Filters are not inverted: a filter always checks the value on its own side of the signal.";
    case CONVERSION_TYPE.SCALE:
      return `In the other direction ${conversionSummary(values, true)}.`;
    case CONVERSION_TYPE.ARITH: {
      const inverse = conversionSummary(values, true);
      return inverse === "no inverse"
        ? "The result does not depend on the value (B = 0), so it has no inverse for the other direction."
        : `In the other direction the gateway calculates ${inverse}.`;
    }
    case CONVERSION_TYPE.LOGICAL:
      return "The gateway applies the same masks in both directions.";
    default:
      return "The gateway uses the inverse table in the other direction.";
  }
}

/**
 * Whether the gateway can run this operation on the other flow of a read +
 * write signal: an arithmetic operation with B · 10^A = 0 and a scale with
 * equal output ends divide by zero there.
 */
export function conversionHasInverse(values: ConversionValues): boolean {
  if (values.type !== CONVERSION_TYPE.SCALE && values.type !== CONVERSION_TYPE.ARITH) return true;
  return applyConversion(values, 0, true).kind !== "undefined";
}
