import { NextResponse } from "next/server";
import { getModbusAIService } from "@/server/modbus-ai/service";
import { errorResponse } from "@/server/projects/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json(await getModbusAIService().settings());
  } catch (error) {
    return errorResponse(error);
  }
}
export async function PUT(request: Request) {
  try {
    return NextResponse.json(
      await getModbusAIService().setSettings(await request.json()),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
