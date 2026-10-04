// Adapted from Signal ad9d60c: src/lib/ai/structured-modbus/incremental-raw-parser.ts.
import { rawRowSchema, type RawModbusRow } from "./extraction";

export function createIncrementalRawModbusRowParser() {
  let buffer = "";
  const emitted = new Set<string>();

  return {
    feed(chunk: string): RawModbusRow[] {
      buffer += chunk;
      buffer = buffer.replace(/^```(?:json)?\s*\n(?:json\s*\n)?/, "");

      const rows: RawModbusRow[] = [];
      for (const objectText of extractRowObjects(buffer)) {
        if (emitted.has(objectText)) continue;

        try {
          const parsed = rawRowSchema.parse(JSON.parse(objectText));
          emitted.add(objectText);
          rows.push(parsed);
        } catch {
          // The model may still be completing this row; retry on the next chunk.
        }
      }
      return rows;
    },

    getBuffer(): string {
      return buffer;
    },
  };
}

function extractRowObjects(jsonText: string): string[] {
  const out: string[] = [];
  const rowsPattern = /"rows"\s*:\s*\[/g;
  let match: RegExpExecArray | null;

  while ((match = rowsPattern.exec(jsonText)) !== null) {
    out.push(
      ...extractObjectsFromArray(jsonText, match.index + match[0].length),
    );
  }

  return out;
}

function extractObjectsFromArray(text: string, startIndex: number): string[] {
  const objects: string[] = [];
  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") {
      if (depth === 0) objectStart = i;
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0 && objectStart !== -1) {
        objects.push(text.slice(objectStart, i + 1));
        objectStart = -1;
      }
    } else if (char === "]" && depth === 0) {
      break;
    }
  }

  return objects;
}
