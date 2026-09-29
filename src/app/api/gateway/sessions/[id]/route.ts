import { NextResponse } from "next/server";
import { getGatewaySessionManager } from "@/server/intesis-transport";
import { errorResponse } from "@/server/projects/http";
import { ProjectServiceError } from "@/server/projects/service";
import { getProjectStore } from "@/server/persistence";
import { withProjectLock } from "@/server/projects/project-lock";
import { z } from "zod";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ session: getGatewaySessionManager().getStatus(id) });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Track the project opened alongside this live gateway session. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parsed = z.object({ projectId: z.string().min(1).max(200).nullable() }).safeParse(await request.json());
    if (!parsed.success) throw new ProjectServiceError(400, "Invalid project selection");
    const { projectId } = parsed.data;
    const manager = getGatewaySessionManager();
    manager.getStatus(id);
    if (projectId === null) return NextResponse.json({ session: manager.setProjectId(id, null) });
    const store = getProjectStore();
    const session = await withProjectLock(store.storageId(projectId), async () => {
      if (!await store.get(projectId)) throw new ProjectServiceError(404, `Project "${projectId}" not found`);
      return manager.setProjectId(id, projectId);
    });
    return NextResponse.json({ session });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    getGatewaySessionManager().disconnect(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
