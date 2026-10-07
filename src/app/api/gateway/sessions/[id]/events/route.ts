import { getGatewaySessionManager } from "@/server/intesis-transport";
import { errorResponse } from "@/server/projects/http";
import { sessionEventStream } from "@/server/intesis-transport/event-stream";

export const runtime = "nodejs";

/**
 * SSE stream of session events (transfer log, XMODEM progress). Replays the
 * recent event history on subscribe so late clients see the full operation.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const manager = getGatewaySessionManager();
    manager.getStatus(id); // 404 for unknown sessions

    const cursor = Number(request.headers.get("Last-Event-ID"));
    const stream = sessionEventStream((listener) => manager.subscribe(id, listener), request.signal,
      Number.isSafeInteger(cursor) && cursor > 0 ? cursor : 0);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
