import { expect, it } from "vitest";
import { rawRowSchema } from "./extraction";
import { createIncrementalRawModbusRowParser } from "./incremental-raw-parser";

function row(name = "Temperature") {
  return rawRowSchema.parse({
    sourceAddress: "104",
    normalizedAddress: null,
    name,
    groupText: null,
    registerTypeHint: "HoldingRegister",
    dataText: "int16",
    sourceBit: null,
    descriptionText: 'Contains ] and } and an escaped "quote"',
    modeText: "R",
    applicableModels: null,
    isReserved: false,
    addressBasis: "zero",
    dataType: "int16",
    byteOrder: null,
    scale: 0.1,
    offset: 0,
    unit: "°C",
    min: null,
    max: null,
    enumValues: [],
    sentinels: [],
    sourcePages: [1],
    sourceQuote: "104 Temperature",
  });
}

it("emits only complete schema-valid rows across fragmented JSON, without duplicates", () => {
  const parser = createIncrementalRawModbusRowParser();
  const first = JSON.stringify(row());
  expect(parser.feed('{"tables":[{"rows":[' + first.slice(0, -1))).toEqual([]);
  expect(parser.feed(first.slice(-1))).toEqual([row()]);
  expect(
    parser.feed(',{"name":"incomplete"},' + JSON.stringify(row("Second"))),
  ).toEqual([row("Second")]);
  expect(parser.feed(']}],"globalNotes":[]}')).toEqual([]);
  expect(parser.getBuffer()).toContain('"Second"');
});

it("keeps source addresses provisional, even if normalization would be ambiguous", () => {
  const parser = createIncrementalRawModbusRowParser();
  const raw = { ...row(), sourceAddress: "40001", addressBasis: "unknown" };
  expect(
    parser.feed(
      '```json\n{"tables":[{"rows":[' + JSON.stringify(raw) + "]}]}\n```",
    ),
  ).toEqual([raw]);
});
