import { NextResponse } from "next/server";
import { z } from "zod";
import { scanInputSchema } from "@/core/modbus-scan/model";
import { getModbusAIService } from "@/server/modbus-ai/service";
import { errorResponse } from "@/server/projects/http";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = z.object({ revision: z.number().int().min(0), input: scanInputSchema.omit({ projectId: true, ranges: true, targets: true }) }).parse(await request.json());
    return NextResponse.json(await getModbusAIService().startValidation((await params).id, body.revision, body.input), { status: 202 });
  } catch (error) { return errorResponse(error); }
}
