import { NextResponse } from "next/server";
import { errorResponse } from "@/server/projects/http";
import { restoreProjectHistory } from "@/server/projects/service";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  try {
    const { id, entryId } = await params;
    return NextResponse.json(await restoreProjectHistory(id, entryId));
  } catch (error) {
    return errorResponse(error);
  }
}
