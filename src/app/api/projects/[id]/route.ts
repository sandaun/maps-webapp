import { NextResponse } from "next/server";
import { getProjectView } from "@/server/projects/service";
import { errorResponse } from "@/server/projects/http";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await getProjectView(id));
  } catch (error) {
    return errorResponse(error);
  }
}
