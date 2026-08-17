import { NextResponse } from "next/server";
import { getProjectView, loadDemoProject } from "@/server/projects/service";
import { errorResponse } from "@/server/projects/http";

export const runtime = "nodejs";

/** Load the explicit, labelled demo project (synthetic data, no gateway). */
export async function POST() {
  try {
    const meta = await loadDemoProject();
    return NextResponse.json({ project: meta }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * The static `demo` segment shadows the dynamic `[id]` route at this exact
 * path, so GET for the demo project is served here explicitly.
 */
export async function GET() {
  try {
    return NextResponse.json(await getProjectView("demo"));
  } catch (error) {
    return errorResponse(error);
  }
}
