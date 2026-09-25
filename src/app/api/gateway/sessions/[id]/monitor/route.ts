import { NextResponse } from "next/server";
import { getGatewaySessionManager } from "@/server/intesis-transport";
import { errorResponse } from "@/server/projects/http";

export const runtime = "nodejs";

/**
 * Enables/disables the live diagnostics monitor (`SPONS=1`/`COMMS=1` on both
 * ports, `DEBUG=1` too with `debug: true`). Pushed lines stream to
 * subscribers of the session SSE channel as `monitor` events.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { enabled?: unknown; debug?: unknown };
    const enabled = body.enabled !== false;
    const session = await getGatewaySessionManager().setMonitor(id, enabled, {
      debug: body.debug === true,
    });
    return NextResponse.json({ session });
  } catch (error) {
    return errorResponse(error);
  }
}
