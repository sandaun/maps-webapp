import { NextResponse } from "next/server";
import { z } from "zod";
import { getModbusAIService } from "@/server/modbus-ai/service";
import { errorResponse } from "@/server/projects/http";
import { ProjectServiceError } from "@/server/projects/errors";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = z
      .object({
        revision: z.number().int().min(0),
        useCurrentSettings: z.boolean().default(false),
      })
      .safeParse(await request.json());
    if (!parsed.success)
      throw new ProjectServiceError(
        422,
        "Choose a valid map revision and resume options.",
      );
    const body = parsed.data;
    return NextResponse.json(
      {
        job: await getModbusAIService().resume(
          (await params).id,
          body.revision,
          body.useCurrentSettings,
        ),
      },
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
