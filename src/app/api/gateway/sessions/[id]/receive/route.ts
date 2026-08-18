import { NextResponse } from "next/server";
import { z } from "zod";
import { getGatewaySessionManager } from "@/server/intesis-transport";
import { openCompleteBlob } from "@/server/projects/service";
import { errorResponse } from "@/server/projects/http";

export const runtime = "nodejs";

const bodySchema = z
  .object({ name: z.string().min(1).max(200).optional() })
  .optional();

/**
 * RECVCMPLT: downloads the "complete" project blob from the gateway
 * (read-only), validates it (length/CRC32/ZIP) and opens it as a project with
 * source "gateway".
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const manager = getGatewaySessionManager();
    const text = await request.text();
    const body = bodySchema.parse(text ? JSON.parse(text) : undefined);

    const data = await manager.receiveProject(id);
    const gatewayName = manager.getStatus(id).gateway?.name;
    const projectId = `gw-${Date.now().toString(36)}`;
    const meta = await openCompleteBlob(data, {
      id: projectId,
      name: body?.name ?? gatewayName ?? projectId,
      source: "gateway",
    });
    return NextResponse.json({ project: meta }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
