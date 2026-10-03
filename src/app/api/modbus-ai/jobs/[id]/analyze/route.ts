import { NextResponse } from "next/server";
import { z } from "zod";
import { getModbusAIService } from "@/server/modbus-ai/service";
import { errorResponse } from "@/server/projects/http";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const body = z.object({ revision: z.number().int().min(0), task: z.enum(["diagnosis", "review"]), automatic: z.boolean().default(false) }).parse(await request.json()); return NextResponse.json({ job: await getModbusAIService().analyze((await params).id, body.revision, body.task, body.automatic) }, { status: 202 }); }
  catch (error) { return errorResponse(error); }
}
