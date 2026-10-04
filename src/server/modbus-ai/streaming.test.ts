// @vitest-environment node
import { expect, it } from "vitest";
import type { AIProvider } from "@/core/modbus-ai/model";
import { AIOutputTruncatedError, readJSONStream } from "./streaming";

function response(events: unknown[], finalSeparator = true) {
  const bytes = new TextEncoder().encode(
    events
      .map(
        (event, index) =>
          `data: ${JSON.stringify(event)}${index === events.length - 1 && !finalSeparator ? "" : "\r\n\r\n"}`,
      )
      .join(""),
  );
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 3)
          controller.enqueue(bytes.slice(i, i + 3));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

it.each<AIProvider>(["openai", "anthropic", "kimi"])(
  "preserves the final %s completion event without a trailing separator",
  async (provider) => {
    const text = '{"value":25}';
    const events =
      provider === "openai"
        ? [
            { type: "response.output_text.delta", delta: text },
            { type: "response.completed" },
          ]
        : provider === "anthropic"
          ? [
              {
                type: "content_block_delta",
                delta: { type: "text_delta", text },
              },
              { type: "message_delta", delta: { stop_reason: "end_turn" } },
              { type: "message_stop" },
            ]
          : [
              {
                choices: [{ delta: { content: text }, finish_reason: "stop" }],
              },
            ];
    expect(
      await readJSONStream(response(events, false), provider, () => {}),
    ).toBe(text);
  },
);

it("does not treat EOF as provider completion or accept a truncated final event", async () => {
  await expect(
    readJSONStream(
      response(
        [{ type: "response.output_text.delta", delta: '{"value":25}' }],
        false,
      ),
      "openai",
      () => {},
    ),
  ).rejects.toThrow("without completion");
  await expect(
    readJSONStream(
      new Response('data: {"type":"response.completed"'),
      "openai",
      () => {},
    ),
  ).rejects.toThrow("invalid streaming event");
});

it.each<AIProvider>(["openai", "anthropic", "kimi"])(
  "handles %s completion, UTF-8 fragments and excludes reasoning",
  async (provider) => {
    const text = '{"name":"Temperatura °C"}';
    const events =
      provider === "openai"
        ? [
            { type: "response.reasoning_summary_text.delta", delta: "ignored" },
            { type: "response.output_text.delta", delta: text },
            { type: "response.completed", response: { status: "completed" } },
          ]
        : provider === "anthropic"
          ? [
              {
                type: "content_block_delta",
                delta: { type: "thinking_delta", thinking: "ignored" },
              },
              {
                type: "content_block_delta",
                delta: { type: "text_delta", text },
              },
              { type: "message_delta", delta: { stop_reason: "end_turn" } },
              { type: "message_stop" },
            ]
          : [
              { choices: [{ delta: { reasoning_content: "ignored" } }] },
              { choices: [{ delta: { content: text }, finish_reason: null }] },
              { choices: [{ delta: {}, finish_reason: "stop" }] },
            ];
    const deltas: string[] = [];
    expect(
      await readJSONStream(response(events), provider, (delta) => {
        deltas.push(delta);
      }),
    ).toBe(text);
    expect(deltas.join("")).toBe(text);
  },
);

it.each([
  [
    "openai",
    {
      type: "response.incomplete",
      response: { incomplete_details: { reason: "max_output_tokens" } },
    },
  ],
  [
    "anthropic",
    { type: "message_delta", delta: { stop_reason: "max_tokens" } },
  ],
  ["kimi", { choices: [{ delta: {}, finish_reason: "length" }] }],
] as const)(
  "classifies confirmed %s token truncation for page subdivision",
  async (provider, event) => {
    await expect(
      readJSONStream(response([event]), provider, () => {}),
    ).rejects.toBeInstanceOf(AIOutputTruncatedError);
  },
);

it("rejects interrupted, failed and refused streams even when complete JSON was already received", async () => {
  const delta = { type: "response.output_text.delta", delta: '{"value":25}' };
  await expect(
    readJSONStream(response([delta]), "openai", () => {}),
  ).rejects.toThrow("without completion");
  await expect(
    readJSONStream(
      response([delta, { type: "response.failed" }]),
      "openai",
      () => {},
    ),
  ).rejects.toThrow("failed");
  await expect(
    readJSONStream(
      response([{ type: "response.refusal.delta", delta: "no" }]),
      "openai",
      () => {},
    ),
  ).rejects.toThrow("declined");
  await expect(
    readJSONStream(
      response([
        {
          type: "response.incomplete",
          response: { incomplete_details: { reason: "content_filter" } },
        },
      ]),
      "openai",
      () => {},
    ),
  ).rejects.not.toBeInstanceOf(AIOutputTruncatedError);
});
