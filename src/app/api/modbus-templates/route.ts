import { NextResponse } from "next/server";
import { getTemplateLibrary } from "@/server/device-templates/library";
import { errorResponse } from "@/server/projects/http";
export const runtime = "nodejs";
export async function GET() {
  try { return NextResponse.json(await getTemplateLibrary("knx")); }
  catch (error) { return errorResponse(error); }
}
