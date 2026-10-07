import { NextResponse } from "next/server";
import { listDiagnosticArchives } from "@/server/intesis-transport/diagnostics-archive";

export const runtime = "nodejs";
export async function GET() {
  return NextResponse.json({ archives: await listDiagnosticArchives() }, { headers: { "Cache-Control": "no-store" } });
}
