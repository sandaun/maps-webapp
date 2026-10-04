import { expect, it } from "vitest";
import { documentContext, extractionPageLimit } from "./document-context";
import type { EvidencePage } from "@/core/modbus-ai/model";
const page = (n: number, text: string): EvidencePage => ({
  page: n,
  text,
  lines: text.split("\n"),
});
it("uses 40 pages for OpenAI and a complete supported Claude document", () => {
  expect(extractionPageLimit("openai")).toBe(40);
  expect(extractionPageLimit("anthropic")).toBe(100);
});
it("carries a page-3 address note to a page-41 group and neighbouring table context", () => {
  const pages = [
    page(3, "All register addresses are 1-based."),
    page(40, "Holding registers — read only\nAddress | Temperature ×0.1 °C"),
    page(41, "61 | Tank temperature"),
    page(42, "62 | Water temperature"),
  ];
  const context = documentContext(pages, 41, 42);
  expect(context).toContain("PAGE 3: All register addresses are 1-based.");
  expect(context).toContain("CONTEXT PAGE 40");
  expect(context).toContain("Holding registers — read only");
  expect(context).not.toContain("61 | Tank temperature");
});
