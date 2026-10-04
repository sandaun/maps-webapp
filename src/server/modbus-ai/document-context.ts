import type { AIProvider, EvidencePage } from "@/core/modbus-ai/model";

// 100 is the documented conservative Claude limit for context windows under 1M.
// MAPS does not currently request a 1M context window for every Claude model.
export function extractionPageLimit(provider: AIProvider): number {
  return provider === "anthropic" ? 100 : provider === "openai" ? 40 : 40;
}

/** Carry document-wide addressing notes and neighbouring table context without another AI call. */
export function documentContext(
  pages: EvidencePage[],
  startPage: number,
  endPage: number,
) {
  const global = pages.flatMap((page) =>
    page.lines
      .filter((line) =>
        /(?:addresses?|registers?|offsets?).{0,100}(?:[01]\s*[- ]\s*based|zero[- ]based|one[- ]based|start(?:s|ing)?\s+(?:at|from)|base\s*[01])|(?:[01]\s*[- ]\s*based|zero[- ]based|one[- ]based).{0,100}(?:addresses?|registers?|offsets?)|(?:max(?:imum)?\s*)?\d+\s+(?:units|devices|slaves)|(?:plus|add).{0,30}\d+\s*\*\s*[A-Z]/i.test(
          line,
        ),
      )
      .map((line) => `PAGE ${page.page}: ${line}`),
  );
  const neighbours = pages.filter(
    (page) => page.page === startPage - 1 || page.page === endPage + 1,
  );
  return [
    "DOCUMENT CONTEXT ONLY — preserve source notes; extract rows only from target pages.",
    ...global,
    ...neighbours.map((page) => `CONTEXT PAGE ${page.page}\n${page.text}`),
  ].join("\n\n");
}
