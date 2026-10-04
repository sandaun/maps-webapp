import { NextResponse } from "next/server";
import { z } from "zod";
import { getModbusAIService } from "@/server/modbus-ai/service";
import { errorResponse } from "@/server/projects/http";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const body = z
      .object({
        revision: z.number().int().min(0),
        analysisId: z.string(),
        index: z.number().int().min(0),
      })
      .parse(await request.json());
    return NextResponse.json({
      job: await getModbusAIService().applyCorrection(
        (await params).id,
        body.revision,
        body.analysisId,
        body.index,
      ),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
