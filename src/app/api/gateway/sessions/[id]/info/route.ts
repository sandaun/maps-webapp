import { NextResponse } from "next/server";
import { getGatewaySessionManager } from "@/server/intesis-transport";
import { errorResponse } from "@/server/projects/http";

export const runtime = "nodejs";

/** Fresh `INFO?` query against the gateway (read-only). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const info = await getGatewaySessionManager().queryInfo(id);
    return NextResponse.json({ info });
  } catch (error) {
    return errorResponse(error);
  }
}
