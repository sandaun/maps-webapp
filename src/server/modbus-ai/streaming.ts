import "server-only";
import type { AIProvider } from "@/core/modbus-ai/model";
import { ProjectServiceError } from "@/server/projects/errors";

export class AIOutputTruncatedError extends ProjectServiceError {
  constructor() {
    super(
      422,
      "AI output was truncated. Completed page groups were saved; this group needs subdivision or resume.",
    );
  }
}

export class AIRequestTimeoutError extends ProjectServiceError {
  constructor() {
    super(504, "AI request timed out. Completed page groups were saved.");
  }
}

function eventData(frame: string): string {
  return frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
}

/** Parses SSE framing independently from provider payloads, including UTF-8
 * characters and event delimiters split across network chunks. */
async function* events(response: Response): AsyncGenerator<string> {
  if (!response.body)
    throw new ProjectServiceError(502, "AI stream has no response body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      if (buffer.length > 4_000_000)
        throw new ProjectServiceError(
          422,
          "AI stream event exceeded the supported size.",
        );
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = eventData(frame);
        if (data) yield data;
      }
      if (done) {
        const data = eventData(buffer);
        if (data) yield data;
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function readJSONStream(
  response: Response,
  provider: AIProvider,
  onTextDelta: (text: string) => void | Promise<void>,
): Promise<string> {
  let text = "";
  let completed = false;
  let stopReason: string | undefined;
  const append = async (delta: unknown) => {
    if (typeof delta !== "string") return;
    text += delta;
    if (text.length > 4_000_000)
      throw new ProjectServiceError(
        422,
        "AI output exceeded the supported size.",
      );
    await onTextDelta(delta);
  };
  for await (const data of events(response)) {
    if (data === "[DONE]") continue;
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      throw new ProjectServiceError(
        502,
        "AI returned an invalid streaming event.",
      );
    }
    if (
      event.type === "error" ||
      event.type === "response.failed" ||
      event.error
    )
      throw new ProjectServiceError(
        502,
        "AI streaming request failed. Saved rows are provisional; resume explicitly.",
      );
    if (provider === "openai") {
      if (event.type === "response.output_text.delta")
        await append(event.delta);
      if (event.type?.startsWith("response.refusal"))
        throw new ProjectServiceError(
          422,
          "The provider declined this request.",
        );
      if (event.type === "response.incomplete") {
        if (event.response?.incomplete_details?.reason === "max_output_tokens")
          throw new AIOutputTruncatedError();
        throw new ProjectServiceError(
          422,
          "AI response was incomplete. Resume explicitly.",
        );
      }
      if (event.type === "response.completed") completed = true;
    } else if (provider === "anthropic") {
      if (
        event.type === "content_block_start" &&
        event.content_block?.type === "text"
      )
        await append(event.content_block.text);
      if (
        event.type === "content_block_delta" &&
        event.delta?.type === "text_delta"
      )
        await append(event.delta.text);
      if (event.type === "message_delta") {
        stopReason = event.delta?.stop_reason;
        if (stopReason === "max_tokens") throw new AIOutputTruncatedError();
        if (stopReason === "refusal")
          throw new ProjectServiceError(
            422,
            "The provider declined this request.",
          );
      }
      if (
        event.type === "message_stop" &&
        ["end_turn", "stop_sequence"].includes(stopReason ?? "")
      )
        completed = true;
    } else {
      for (const choice of event.choices ?? []) {
        if (choice.delta?.refusal)
          throw new ProjectServiceError(
            422,
            "The provider declined this request.",
          );
        await append(choice.delta?.content);
        if (choice.finish_reason === "length")
          throw new AIOutputTruncatedError();
        if (choice.finish_reason === "stop") completed = true;
      }
    }
  }
  if (!completed)
    throw new ProjectServiceError(
      502,
      "AI stream ended without completion. Saved rows are provisional; resume explicitly.",
    );
  return text;
}
