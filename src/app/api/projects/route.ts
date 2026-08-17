import { NextResponse } from "next/server";
import { listProjects } from "@/server/projects/service";
import { errorResponse } from "@/server/projects/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ projects: await listProjects() });
  } catch (error) {
    return errorResponse(error);
  }
}
