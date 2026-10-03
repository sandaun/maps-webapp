import { expect, it } from "vitest";
import { normalizeCorrection } from "./corrections";
import { temperature } from "./test-fixtures";
it("normalizes byte order aliases from a provider and rejects invalid proposals", () => {
  const proposal = { signalId: "temperature", field: "byteOrder" as const, value: "big endian", reason: "Source" };
  expect(normalizeCorrection(temperature(), proposal)?.value).toBe("ABCD");
  expect(normalizeCorrection(temperature(), { ...proposal, value: "maybe native" })).toBeNull();
  expect(normalizeCorrection(temperature(), { ...proposal, field: "address", value: "" })).toBeNull();
  expect(normalizeCorrection(temperature(), { ...proposal, field: "function", value: "6" })).toBeNull();
  expect(normalizeCorrection(temperature(), { ...proposal, field: "function", value: "1" })).toBeNull();
});
