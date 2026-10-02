import { NextResponse } from "next/server";
import { getModbusScanService } from "@/server/modbus-scan/service";
import { errorResponse } from "@/server/projects/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return NextResponse.json({ jobs: await getModbusScanService().list(new URL(request.url).searchParams.get("projectId") ?? undefined) }); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try { return NextResponse.json({ job: await getModbusScanService().start(await request.json()) }, { status: 202 }); }
  catch (error) { return errorResponse(error); }
}
