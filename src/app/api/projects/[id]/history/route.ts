import { NextResponse } from "next/server";
import { errorResponse } from "@/server/projects/http";
import { listProjectHistory } from "@/server/projects/service";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const history = await listProjectHistory(id);
    return NextResponse.json({ history });
  } catch (error) {
    return errorResponse(error);
  }
}
