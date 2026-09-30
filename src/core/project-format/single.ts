/**
 * `float` (System.Single) values as MAPS reads and writes them in the project
 * XML: `IntesisXML.GetInnerTextWithDefault(…, double)` cast to float, and
 * `float.ToString(CultureInfo.InvariantCulture)` on .NET 10 (MAPS 1.2.34
 * runtimeconfig), the shortest text that reads back as the same float.
 */

/**
 * `double.TryParse(text.Replace(',', '.'), NumberStyles.Float, InvariantCulture)`
 * then `(float)`: white space, a sign, a decimal point and an exponent are
 * accepted; anything else gives `fallback`.
 */
export function parseMapsSingle(text: string | undefined, fallback = 0): number {
  if (text === undefined) return fallback;
  const value = text.replace(/,/g, ".").trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(value)) return fallback;
  return Math.fround(Number(value));
}

/** `float.ToString(CultureInfo.InvariantCulture)`: "2.5", "0.1", "1E-05". */
export function formatSingle(value: number): string {
  const single = Math.fround(value);
  if (single === 0 || !Number.isFinite(single)) return single === 0 ? "0" : String(single);
  let digits = "";
  for (let precision = 1; precision <= 9; precision++) {
    digits = single.toPrecision(precision);
    if (Math.fround(Number(digits)) === single) break;
  }
  const shortest = Number(digits);
  const [mantissa, exponentText] = shortest.toExponential().split("e");
  const exponent = Number(exponentText);
  // Scientific notation below 1E-04 (deadbands stay within 0–100, far below the upper switch).
  if (exponent >= -4 && exponent < 15) return String(shortest);
  const sign = exponent < 0 ? "-" : "+";
  return `${mantissa}E${sign}${String(Math.abs(exponent)).padStart(2, "0")}`;
}
