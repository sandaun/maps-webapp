import { NextResponse } from "next/server";
import { z } from "zod";
import { experimentSchema } from "@/core/modbus-ai/model";
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
        experiment: experimentSchema,
      })
      .parse(await request.json());
    return NextResponse.json({
      job: await getModbusAIService().addExperiment(
        (await params).id,
        body.revision,
        body.experiment,
      ),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
