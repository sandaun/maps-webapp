// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { generateJSON, providerAvailability } from "./providers";
import { rawExtractionSchema } from "@/core/modbus-ai/extraction";
afterEach(() => vi.unstubAllEnvs());
const schema = z.object({ value: z.number() });
it("uses Responses for Luna, separates reasoning from evidence and does not store prompts", async () => {
  vi.stubEnv("OPENAI_API_KEY", "unit-test-placeholder");
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: "completed", output: [{ type: "reasoning", content: [{ type: "summary_text", text: "not JSON" }] }, { type: "message", content: [{ type: "output_text", text: '{"value":25}' }] }] })));
  expect(await generateJSON({ profile: { provider: "openai", model: "gpt-6-luna", effort: "none" }, schema, system: "evidence", text: "230→250" }, fetcher)).toEqual({ value: 25 });
  const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
  expect(body.store).toBe(false); expect(body.reasoning.effort).toBe("none"); expect(body.text.format.type).toBe("json_schema"); expect(body.tools).toBeUndefined();
});
it("adapts K3 reasoning without copying K2.6's thinking-disabled parameter", async () => {
  vi.stubEnv("MOONSHOT_API_KEY", "unit-test-placeholder");
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"value":25}', reasoning_content: "ignored" }, finish_reason: "stop" }] })));
  await generateJSON({ profile: { provider: "kimi", model: "kimi-k3", effort: "low" }, schema, system: "evidence", text: "test" }, fetcher);
  const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string); expect(body.reasoning_effort).toBe("low"); expect(body.thinking).toBeUndefined(); expect(fetcher.mock.calls[0][0]).toContain("moonshot.ai");
});
it("does not send a Claude strict extraction schema beyond its union limit", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "unit-test-placeholder");
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ manufacturer: null, model: null, globalNotes: [], tables: [] }) }], stop_reason: "end_turn" })));
  await generateJSON({ profile: { provider: "anthropic", model: "claude-sonnet-5-5", effort: "low" }, schema: rawExtractionSchema, system: "evidence", text: "test", pdf: new Uint8Array([1]) }, fetcher);
  const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string); expect(body.output_config.format).toBeUndefined(); expect(body.messages[0].content[0].source.media_type).toBe("application/pdf"); expect(body.system).toContain("Return only JSON");
});
it("rejects truncation, invalid JSON and absent credentials without returning partial results", async () => {
  vi.stubEnv("OPENAI_API_KEY", ""); expect(providerAvailability().openai).toBe(false);
  const fetcher = vi.fn<typeof fetch>();
  await expect(generateJSON({ profile: { provider: "openai", model: "gpt-6-luna", effort: "none" }, schema, system: "", text: "" }, fetcher)).rejects.toThrow("OPENAI_API_KEY"); expect(fetcher).not.toHaveBeenCalled();
  vi.stubEnv("OPENAI_API_KEY", "unit-test-placeholder"); fetcher.mockResolvedValue(new Response(JSON.stringify({ status: "incomplete" })));
  await expect(generateJSON({ profile: { provider: "openai", model: "gpt-6-luna", effort: "none" }, schema, system: "", text: "" }, fetcher)).rejects.toThrow("truncated");
});
it("does not retry paid requests after ambiguous provider failures", async () => {
  vi.stubEnv("OPENAI_API_KEY", "unit-test-placeholder");
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("Unavailable", { status: 503 }));
  await expect(generateJSON({ profile: { provider: "openai", model: "gpt-6-luna", effort: "none" }, schema, system: "", text: "" }, fetcher)).rejects.toThrow("HTTP 503");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
