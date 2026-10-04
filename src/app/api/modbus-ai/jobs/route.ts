import { NextResponse } from "next/server";
import { getModbusAIService } from "@/server/modbus-ai/service";
import { errorResponse } from "@/server/projects/http";
import { ProjectServiceError } from "@/server/projects/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) throw new ProjectServiceError(400, "Choose a project.");
    return NextResponse.json({
      jobs: await getModbusAIService().list(projectId),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const projectId = form.get("projectId");
    if (!(file instanceof File) || typeof projectId !== "string")
      throw new ProjectServiceError(400, "Choose a project and PDF.");
    return NextResponse.json(
      { job: await getModbusAIService().start(projectId, file) },
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
