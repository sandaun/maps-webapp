import { NextResponse } from "next/server";
import { z } from "zod";
import { getGatewaySessionManager } from "@/server/intesis-transport";
import { errorResponse } from "@/server/projects/http";
import { getModbusScanService } from "@/server/modbus-scan/service";

export const runtime = "nodejs";

const connectSchema = z.union([z.object({
  transport: z.literal("tcp").optional(),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).optional(),
  /** Held in memory only — never persisted, logged, or echoed back. */
  password: z.string().default(""),
}), z.object({
  transport: z.literal("usb"),
  path: z.string().trim().min(1).max(256),
})]);

/** Open a control session (LOGIN0/1/2 handshake) against a gateway. */
export async function POST(request: Request) {
  try {
    const body = connectSchema.parse(await request.json());
    const options = body.transport === "usb"
      ? { transport: "usb" as const, host: body.path, password: "" }
      : body;
    await getModbusScanService().checkReconnect(options.host);
    const session = await getGatewaySessionManager().connect(options);
    await getModbusScanService().reconnect(session.id);
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
