import "server-only";
import { z } from "zod";
import { MODELS, type AIProfile, type AIProvider } from "@/core/modbus-ai/model";
import { ProjectServiceError } from "@/server/projects/errors";

const keyFor = (provider: AIProvider) => provider === "openai" ? process.env.OPENAI_API_KEY : provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.MOONSHOT_API_KEY ?? process.env.KIMI_API_KEY;
export function providerAvailability() { return { openai: Boolean(keyFor("openai")), anthropic: Boolean(keyFor("anthropic")), kimi: Boolean(keyFor("kimi")) }; }
export function checkProfile(profile: AIProfile) {
  if (!(MODELS[profile.provider] as readonly string[]).includes(profile.model)) throw new ProjectServiceError(422, "Choose a supported model for this provider.");
  if (profile.provider === "openai" && profile.model !== "gpt-6-luna" && profile.effort === "none") throw new ProjectServiceError(422, "This OpenAI model requires reasoning. Select low or higher.");
  if (profile.model === "kimi-k3" && !["low", "high", "max"].includes(profile.effort)) throw new ProjectServiceError(422, "Kimi K3 requires low, high or max reasoning.");
}
export function requireCredential(profile: AIProfile) {
  checkProfile(profile);
  if (!keyFor(profile.provider)) throw new ProjectServiceError(503, `Configure ${profile.provider === "openai" ? "OPENAI_API_KEY" : profile.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "MOONSHOT_API_KEY"} on the server before making AI requests.`);
}
type JSONPayload = { status?: string; stop_reason?: string; incomplete_details?: unknown; output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>; content?: Array<{ type: string; text?: string }>; choices?: Array<{ finish_reason?: string; message?: { content?: string; refusal?: string } }> };
export interface AIRequest<T> { profile: AIProfile; schema: z.ZodType<T>; system: string; text: string; pdf?: Uint8Array; signal?: AbortSignal; maxTokens?: number }

/** Small server-only adapters. No provider SDK, filesystem tool or write tool is exposed to models. */
export async function generateJSON<T>(input: AIRequest<T>, fetcher: typeof fetch = fetch): Promise<T> {
  requireCredential(input.profile);
  const { profile } = input;
  const jsonSchema = z.toJSONSchema(input.schema, { target: "draft-7" }); delete jsonSchema.$schema;
  const simplify = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(simplify);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !["minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems"].includes(key)).map(([key, child]) => [key, simplify(child)]));
    return value;
  };
  const providerSchema = simplify(jsonSchema);
  const countUnions = (value: unknown): number => Array.isArray(value) ? value.reduce((count, item) => count + countUnions(item), 0) : value && typeof value === "object" ? Object.entries(value).reduce((count, [key, child]) => count + (key === "anyOf" ? 1 : 0) + countUnions(child), 0) : 0;
  const key = keyFor(profile.provider)!;
  const maxTokens = input.maxTokens ?? 12000;
  let url: string; let headers: Record<string, string>; let body: Record<string, unknown>;
  if (profile.provider === "openai") {
    url = "https://api.openai.com/v1/responses"; headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    body = { model: profile.model, store: false, instructions: input.system,
      input: [{ role: "user", content: [...(input.pdf ? [{ type: "input_file", filename: "manual.pdf", file_data: `data:application/pdf;base64,${Buffer.from(input.pdf).toString("base64")}` }] : []), { type: "input_text", text: input.text }] }],
      reasoning: { effort: profile.effort }, max_output_tokens: maxTokens,
      text: { format: { type: "json_schema", name: "modbus_evidence", strict: true, schema: jsonSchema } } };
  } else if (profile.provider === "anthropic") {
    url = "https://api.anthropic.com/v1/messages"; headers = { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" };
    // Claude limits strict schemas to 16 union fields. Rich raw rows exceed
    // that limit; Signal's JSON-only prompt + server validation handles these.
    const strict = countUnions(providerSchema) <= 16;
    body = { model: profile.model, max_tokens: maxTokens, system: strict ? input.system : `${input.system}\nReturn only JSON matching this schema: ${JSON.stringify(providerSchema)}`,
      messages: [{ role: "user", content: [...(input.pdf ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(input.pdf).toString("base64") } }] : []), { type: "text", text: input.text }] }],
      output_config: { ...(strict ? { format: { type: "json_schema", schema: providerSchema } } : {}), ...(profile.model.includes("haiku") ? {} : { effort: profile.effort === "none" ? "low" : profile.effort }) },
      ...(profile.model.includes("haiku") ? {} : { thinking: { type: "adaptive" } }) };
  } else {
    // Signal's international endpoint is retained; K3 account availability is
    // checked by the provider response, never assumed from the model catalogue.
    const base = process.env.MOONSHOT_BASE_URL ?? "https://api.moonshot.ai/v1";
    url = `${base.replace(/\/$/, "")}/chat/completions`; headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    body = { model: profile.model, messages: [{ role: "system", content: `${input.system}\nRequired JSON schema: ${JSON.stringify(jsonSchema)}` }, { role: "user", content: input.text }], max_tokens: maxTokens,
      ...(profile.model === "kimi-k3" ? { reasoning_effort: profile.effort, response_format: { type: "json_schema", json_schema: { name: "modbus_evidence", strict: true, schema: jsonSchema } } } : { thinking: { type: "disabled" }, response_format: { type: "json_object" } }) };
  }
  const timeout = AbortSignal.timeout(input.pdf ? 300000 : 120000);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  // An ambiguous failure may already have consumed tokens. Retrying requires
  // an explicit user action rather than spending again in the background.
  const response = await fetcher(url, { method: "POST", headers, body: JSON.stringify(body), signal });
  if (!response?.ok) {
    await response?.body?.cancel();
    throw new ProjectServiceError(response?.status === 429 ? 429 : 502, `${profile.provider} request failed (HTTP ${response?.status ?? "unknown"}). Check credentials, model access, quota or provider availability. No partial result was accepted.`);
  }
  const payload = await response.json() as JSONPayload;
  if (payload.status === "incomplete" || payload.stop_reason === "max_tokens" || payload.choices?.some((c) => c.finish_reason === "length")) throw new ProjectServiceError(422, "AI output was truncated. Use fewer PDF pages or a smaller map; no partial result was accepted.");
  if (payload.output?.some((o) => o.content?.some((c) => c.type === "refusal")) || payload.choices?.some((c) => c.message?.refusal) || payload.stop_reason === "refusal") throw new ProjectServiceError(422, "The provider declined this request.");
  const text = profile.provider === "openai" ? payload.output?.filter((o) => o.type === "message").flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text ?? "").join("") : profile.provider === "anthropic" ? payload.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("") : payload.choices?.[0]?.message?.content;
  try { return input.schema.parse(JSON.parse((text ?? "").trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""))); }
  catch { throw new ProjectServiceError(422, "AI returned invalid structured evidence. Review or retry; no partial result was accepted."); }
}
