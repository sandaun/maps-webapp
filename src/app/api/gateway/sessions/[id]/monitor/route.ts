import { NextResponse } from "next/server";
import { getGatewaySessionManager } from "@/server/intesis-transport";
import { errorResponse } from "@/server/projects/http";

export const runtime = "nodejs";

/**
 * Enables/disables the live diagnostics monitor (`SPONS=1`/`COMMS=1` on both
 * ports; `comms: false` drops COMMS, `debug: true` adds DEBUG). Pushed lines
 * stream to subscribers of the session SSE channel as `monitor` events.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      enabled?: unknown;
      comms?: unknown;
      debug?: unknown;
    };
    const enabled = body.enabled !== false;
    const session = await getGatewaySessionManager().setMonitor(id, enabled, {
      comms: body.comms !== false,
      debug: body.debug === true,
    });
    return NextResponse.json({ session });
  } catch (error) {
    return errorResponse(error);
  }
}
