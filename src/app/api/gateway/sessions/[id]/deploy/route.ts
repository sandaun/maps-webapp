import { NextResponse } from "next/server";
import { z } from "zod";
import { deployProject, getDeployStatus } from "@/server/deploy/service";
import { errorResponse } from "@/server/projects/http";

export const runtime = "nodejs";

const bodySchema = z.object({ projectId: z.string().min(1).max(200) });

/**
 * Deploy (SENDCMPLT — WRITES configuration to the gateway). All gates run
 * server-side: the project family must have a verified deploy descriptor
 * (knx-mbm / me-mbs / mbs-knx), a genuine per-family capability artefact,
 * and a session whose 700 Series gateway runs one of the project class's
 * AppIds, as MAPS checks it (`deploy/gateway-compat.ts`). Progress is
 * streamed over the session SSE events endpoint.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { projectId } = bodySchema.parse(await request.json());
    const result = await deployProject(projectId, id);
    return NextResponse.json({ result });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Gate evaluation for the deploy UI (`?projectId=...`), no side effects. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
    const { projectId: parsed } = bodySchema.parse({ projectId });
    const status = await getDeployStatus(parsed, id);
    return NextResponse.json({ status });
  } catch (error) {
    return errorResponse(error);
  }
}
