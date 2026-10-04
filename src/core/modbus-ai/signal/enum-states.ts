// Source: Signal ad9d60c6619bfab7a9186e96938bd0b20a4403cc, src/lib/signals/enum-states.ts.
export type EnumState = {
  value: number;
  text: string;
};

const ENUM_VALUE_PATTERN =
  /(?:^|[\s,;\n/])\(?((?:0x[\da-f]+)|\d{1,5})\)?\s*(?:[:=)]|-(?!\s*bit\b))\s*([\s\S]*?)(?=(?:[\s,;\n/]+\(?((?:0x[\da-f]+)|\d{1,5})\)?\s*(?:[:=)]|-(?!\s*bit\b)))|[.;\n]|$)/gi;

export function parseEnumStates(text: string | null | undefined): EnumState[] {
  if (!text) return [];

  const states: EnumState[] = [];
  const seenValues = new Set<number>();
  for (const match of text.matchAll(ENUM_VALUE_PATTERN)) {
    const value = Number(match[1]);
    const label = cleanEnumLabel(match[2]);
    if (!Number.isInteger(value) || !label || seenValues.has(value)) continue;
    seenValues.add(value);
    states.push({ value, text: label });
  }

  if (states.length >= 2) return states;

  const enumValues = text.match(/enum values\s*:\s*([^.\n]+)/i);
  if (!enumValues) return [];

  return enumValues[1]
    .split(/[;,]/)
    .map((value) => cleanEnumLabel(value))
    .filter(Boolean)
    .map((label, index) => ({ value: index, text: label }));
}

export function countEnumStates(text: string | null | undefined): number | null {
  const states = parseEnumStates(text);
  return states.length >= 2 ? states.length : null;
}

function cleanEnumLabel(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s*[/|]\s*$/g, '')
    .replace(/\s+$/g, '')
    .trim();
}
