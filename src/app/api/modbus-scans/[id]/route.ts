import { NextResponse } from "next/server";
import { getModbusScanService } from "@/server/modbus-scan/service";
import { errorResponse } from "@/server/projects/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json({ job: await getModbusScanService().get((await params).id) }); } catch (error) { return errorResponse(error); }
}
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json({ job: await getModbusScanService().cancel((await params).id) }); } catch (error) { return errorResponse(error); }
}
