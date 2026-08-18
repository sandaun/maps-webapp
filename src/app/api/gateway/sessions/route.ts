import { NextResponse } from "next/server";
import { z } from "zod";
import { getGatewaySessionManager } from "@/server/intesis-transport";
import { errorResponse } from "@/server/projects/http";

export const runtime = "nodejs";

const connectSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).optional(),
  /** Held in memory only — never persisted, logged, or echoed back. */
  password: z.string().default(""),
});

/** Open a control session (LOGIN0/1/2 handshake) against a gateway. */
export async function POST(request: Request) {
  try {
    const body = connectSchema.parse(await request.json());
    const session = await getGatewaySessionManager().connect(body);
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

/** List live sessions (single-process, in-memory). */
export async function GET() {
  try {
    return NextResponse.json({ sessions: getGatewaySessionManager().list() });
  } catch (error) {
    return errorResponse(error);
  }
}
