import { NextResponse } from "next/server";
import { listGatewaySerialPorts } from "@/server/intesis-transport/serial";
import { errorResponse } from "@/server/projects/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await listGatewaySerialPorts());
  } catch (error) {
    return errorResponse(error);
  }
}
