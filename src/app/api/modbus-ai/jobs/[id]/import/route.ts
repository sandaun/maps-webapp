import { NextResponse } from "next/server";
import { z } from "zod";
import { getModbusAIService } from "@/server/modbus-ai/service";
import { addDocumentSignals, getProjectView } from "@/server/projects/service";
import { nodeFingerprint } from "@/server/modbus-scan/service";
import { scanInputSchema } from "@/core/modbus-scan/model";
import { errorResponse } from "@/server/projects/http";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = z.object({ revision: z.number().int().min(0), projectRevision: z.number().int().min(0), selected: z.array(z.string()).min(1).max(4096), target: z.object({ kind: z.enum(["rtu", "tcp"]), nodeIndex: z.number().int().min(0), slave: z.number().int().min(1).max(247) }) }).parse(await request.json());
    const service = getModbusAIService(); const id = (await params).id;
    return await service.exclusive(id, async () => {
    const { job, rows } = await service.assertImport(id, body.revision, body.selected);
    const input = scanInputSchema.parse({ projectId: job.projectId, locator: body.target, slave: body.target.slave, ranges: [] });
    await service.verifyTarget(job, input);
    const view = await getProjectView(job.projectId);
    return NextResponse.json(await addDocumentSignals(job.projectId, rows, { ...body.target, name: job.model || "PDF device", manufacturer: job.manufacturer }, body.projectRevision, nodeFingerprint(view, input)));
    });
  } catch (error) { return errorResponse(error); }
}
