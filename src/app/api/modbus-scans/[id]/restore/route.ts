import { NextResponse } from "next/server";
import { z } from "zod";
import { getModbusScanService } from "@/server/modbus-scan/service";
import { errorResponse } from "@/server/projects/http";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const body = z.object({ sessionId: z.string().optional(), password: z.string().optional() }).parse(await request.json()); return NextResponse.json({ job: await getModbusScanService().restore((await params).id, body) }, { status: 202 }); }
  catch (error) { return errorResponse(error); }
}
