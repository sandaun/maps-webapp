import { NextResponse } from "next/server";
import { z } from "zod";
import { pointKey, isScanTerminal } from "@/core/modbus-scan/model";
import { getModbusScanService } from "@/server/modbus-scan/service";
import { ScanError } from "@/server/modbus-scan/guard";
import { addScannedSignals } from "@/server/projects/service";
import { errorResponse } from "@/server/projects/http";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = z.object({ selected: z.array(z.string()).min(1).max(3000), revision: z.number().int().min(0) }).parse(await request.json());
    const service = getModbusScanService(); const job = await service.get((await params).id);
    if (job.needsRestore || !isScanTerminal(job.state)) throw new ScanError(409, "Wait for the scan and backup restoration to finish before adding results.");
    const keys = new Set(body.selected); const rows = job.results.filter((row) => keys.has(pointKey(row)));
    if (rows.length !== keys.size) throw new ScanError(422, "Some selected addresses do not belong to this scan.");
    const view = await addScannedSignals(job.input.projectId, job.input, rows, body.revision, job.targetFingerprint!);
    return NextResponse.json(view);
  } catch (error) { return errorResponse(error); }
}
