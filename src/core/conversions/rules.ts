/**
 * The project's conversion library as the MAPS Conversions Manager edits it
 * (temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS/
 * frmConversions.cs). Shared by the API (validation of every write) and the
 * Configuration editor (live validation), so both apply the same rules.
 *
 * Params travel as the XML strings; a filter keeps its type in Param1 and its
 * comparison in Param2 (`SaveCurrentFilterSelection`, :582-592).
 */

/** `ConversionType` (IntesisBoxMAPS.Enums/ConversionType.cs:3-10). */
export const CONVERSION_TYPE = { FILTER: 0, SCALE: 1, ARITH: 2, LOGICAL: 3, LUT_REMAP: 4 } as const;

/** Signal refs point at a position in one of these lists (`IntesisConversion.cs:233-247`). */
export type ConversionList = "filters" | "operations";

export const conversionListOf = (type: number): ConversionList =>
  type === CONVERSION_TYPE.FILTER ? "filters" : "operations";

/**
 * Only filters, scales and arithmetic operations reach the Conversions
 * Manager: MAPS takes LUT remaps and logical operations out before opening it
 * (`frmGateway.b_configConversions_Click`, frmGateway.cs:576-599).
 */
export const isEditableConversionType = (type: number): boolean =>
  type === CONVERSION_TYPE.FILTER || type === CONVERSION_TYPE.SCALE || type === CONVERSION_TYPE.ARITH;

/** `cb_filterType` items (frmConversions.resx), stored in Param1. */
export const FILTER_TYPE = { COMPARISON: 0, NO_LIMIT: 1, LIMITED: 2 } as const;

/** `ComparisonType` / `cb_comparisonType` items, stored in Param2. */
export const COMPARISON = { EQUAL: 0, DIFFERENT: 1, LESS: 2, GREATER: 3, IN_RANGE: 4, OUT_RANGE: 5 } as const;

/** `tb_operationDescription.MaxLength` (frmConversions.resx). The filter description has no limit in MAPS. */
export const OPERATION_DESCRIPTION_MAX = 32;
/** Sanity limit of the API for filter descriptions (MAPS sets none). */
export const FILTER_DESCRIPTION_MAX = 255;
/** `nb_filterParam3/4.Minimum/Maximum` (frmConversions.cs:1183-1196). */
export const FILTER_VALUE_LIMIT = 100000;
/**
 * `DecimalPlaces = 2` on every numeric control of the manager. Scale and
 * arithmetic values have no range: `SetMaxAndMin` lifts the designer's
 * ±100000 when the form loads (frmConversions.cs:189-204).
 */
export const CONVERSION_DECIMALS = 2;

/** Filter params that the comparison uses (`SetCompTypeNumericControls`, frmConversions.cs:397-434). */
export function filterValueParams(comparison: number): ("param3" | "param4")[] {
  if (comparison === COMPARISON.LESS) return ["param4"];
  if (comparison === COMPARISON.IN_RANGE || comparison === COMPARISON.OUT_RANGE) return ["param3", "param4"];
  return ["param3"];
}

export interface ConversionValues {
  type: number;
  description: string;
  params: readonly [string, string, string, string];
}

export type ConversionField = "description" | "type" | "param1" | "param2" | "param3" | "param4";
export type ConversionErrors = Partial<Record<ConversionField, string>>;

const PARAM_FIELDS = ["param1", "param2", "param3", "param4"] as const;

/**
 * A number as MAPS accepts it: `GetFloatValue` reads "." and "," as the
 * decimal separator (IntesisXML.cs:258-268). Anything else is not a number.
 */
export function parseConversionNumber(value: string): number | undefined {
  const normalized = value.trim().replace(/−/g, "-").replace(",", ".");
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(normalized)) return undefined;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : undefined;
}

/** Invariant-culture text for a param (MAPS runs with `CultureInfo.InvariantCulture`, Program.cs:47-48). */
export function formatConversionNumber(value: number): string {
  return Object.is(value, -0) ? "0" : String(value);
}

function hasAtMostDecimals(value: number, decimals: number): boolean {
  const scaled = value * 10 ** decimals;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

/**
 * What MAPS lets the user save for this conversion, plus the division by
 * zero MAPS lets through. `touched` limits the check to the fields being
 * written (and the rules that involve them), so an entry imported with a
 * value MAPS could not have produced only fails once that value is edited.
 */
export function conversionErrors(values: ConversionValues, touched?: ReadonlySet<ConversionField>): ConversionErrors {
  const errors: ConversionErrors = {};
  const isTouched = (...fields: ConversionField[]) => !touched || fields.some((field) => touched.has(field));
  const number = (field: (typeof PARAM_FIELDS)[number]) =>
    parseConversionNumber(values.params[PARAM_FIELDS.indexOf(field)]);
  // A new comparison or operation type puts other params to use: they are checked as well.
  const trigger: ConversionField = values.type === CONVERSION_TYPE.FILTER ? "param2" : "type";
  const checkNumber = (field: (typeof PARAM_FIELDS)[number], limit?: number): number | undefined => {
    const value = number(field);
    if (!isTouched(field, trigger)) return value;
    if (value === undefined) errors[field] = "Enter a number.";
    else if (!hasAtMostDecimals(value, CONVERSION_DECIMALS)) errors[field] = "Use at most 2 decimals.";
    else if (limit !== undefined && Math.abs(value) > limit)
      errors[field] = `Enter a value from −${limit} to ${limit}.`;
    else return value;
    return undefined;
  };

  if (!isEditableConversionType(values.type)) {
    if (isTouched("type", "description", ...PARAM_FIELDS)) errors.type = "System conversions cannot be edited.";
    return errors;
  }
  const maxLength = values.type === CONVERSION_TYPE.FILTER ? FILTER_DESCRIPTION_MAX : OPERATION_DESCRIPTION_MAX;
  if (isTouched("description") && values.description.length > maxLength)
    errors.description = `Maximum ${maxLength} characters.`;

  if (values.type === CONVERSION_TYPE.FILTER) {
    const filterType = number("param1");
    const comparison = number("param2");
    if (isTouched("param1") && (filterType === undefined || ![0, 1, 2].includes(filterType)))
      errors.param1 = "Choose a filter type.";
    if (isTouched("param2") && (comparison === undefined || ![0, 1, 2, 3, 4, 5].includes(comparison))) {
      errors.param2 = "Choose a condition.";
      return errors;
    }
    const used = filterValueParams(comparison ?? -1);
    const checked = Object.fromEntries(
      used.map((field) => [field, checkNumber(field, FILTER_VALUE_LIMIT)] as const),
    ) as Partial<Record<"param3" | "param4", number>>;
    // `ValidateFiltersValue` (frmConversions.cs:754-766): Low ≤ High for the two range comparisons.
    if (used.length === 2 && isTouched("param2", "param3", "param4")) {
      const low = checked.param3 ?? number("param3");
      const high = checked.param4 ?? number("param4");
      if (low !== undefined && high !== undefined && !errors.param3 && !errors.param4 && low > high)
        errors[touched?.has("param4") || !touched?.has("param3") ? "param4" : "param3"] =
          "Low must not be greater than High.";
    }
    return errors;
  }

  if (isTouched("type") && values.type !== CONVERSION_TYPE.SCALE && values.type !== CONVERSION_TYPE.ARITH)
    errors.type = "Choose Scale or Arithmetic.";

  if (values.type === CONVERSION_TYPE.ARITH) {
    for (const field of ["param1", "param2", "param3"] as const) checkNumber(field);
    return errors;
  }

  const [minIn, maxIn, minOut, maxOut] = PARAM_FIELDS.map((field) => checkNumber(field));
  // `ValidateInScalingValues` / `ValidateOutScalingValues` (frmConversions.cs:726-752) reject
  // min > max. Equal ends are rejected too: MAPS lets them through, but the scale divides by
  // (max − min) in one of the two directions (`IntesisMath.EvaluateScaleFunction`).
  const range = (min: number | undefined, max: number | undefined, minField: ConversionField, maxField: ConversionField, what: string) => {
    if (min === undefined || max === undefined || errors[minField] || errors[maxField]) return;
    if (!isTouched("type", minField, maxField)) return;
    const target = touched?.has(maxField) || !touched?.has(minField) ? maxField : minField;
    if (min > max) errors[target] = `${what} min must not be greater than ${what.toLowerCase()} max.`;
    else if (min === max) errors[target] = `${what} min and max must be different.`;
  };
  range(minIn, maxIn, "param1", "param2", "Input");
  range(minOut, maxOut, "param3", "param4", "Output");
  return errors;
}

/**
 * A new entry as the manager creates it: `CreateDefaultFilter` /
 * `CreateDefaultOperation` (IntesisConversion.cs:672-696) number it with the
 * size of the list the manager shows (`Id` = that index, description
 * "Filter_<n>" / "Operation_<n>"). Both defaults hold 0, 3, 0, 100: a filter
 * "Comparison · Greater than 0" and an operation "Scale 0…3 → 0…100". MAPS
 * only creates scales; switching the new one to arithmetic keeps the params,
 * so a new arithmetic operation starts as y = x instead of y = x · 3.
 */
export function defaultConversion(
  type: typeof CONVERSION_TYPE.FILTER | typeof CONVERSION_TYPE.SCALE | typeof CONVERSION_TYPE.ARITH,
  listSize: number,
): { id: number; description: string; type: number; params: [string, string, string, string] } {
  if (type === CONVERSION_TYPE.FILTER)
    return { id: listSize, description: `Filter_${listSize}`, type, params: ["0", "3", "0", "100"] };
  return {
    id: listSize,
    description: `Operation_${listSize}`,
    type,
    params: type === CONVERSION_TYPE.SCALE ? ["0", "3", "0", "100"] : ["0", "1", "0", "0"],
  };
}
