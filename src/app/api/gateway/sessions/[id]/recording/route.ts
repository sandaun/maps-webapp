import { NextResponse } from "next/server";
import { getGatewaySessionManager } from "@/server/intesis-transport";
import { errorResponse } from "@/server/projects/http";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    const session = await getGatewaySessionManager().setRecording(id, body.enabled);
    return NextResponse.json({ session });
  } catch (error) { return errorResponse(error); }
}
