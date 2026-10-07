import { NextResponse } from "next/server";
import { getGatewaySessionManager } from "@/server/intesis-transport";
import { archiveDirectory, downloadDiagnosticLog, readDiagnosticHistory } from "@/server/intesis-transport/diagnostics-archive";
import { errorResponse } from "@/server/projects/http";
import { GatewayRequestError } from "@/server/intesis-transport/manager";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    try { archiveDirectory(id); } catch { throw new GatewayRequestError(400, "Invalid capture ID"); }
    await getGatewaySessionManager().flushArchive(id);
    const url = new URL(request.url);
    const before = url.searchParams.has("before") ? Number(url.searchParams.get("before")) : Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(before) || before < 1) throw new GatewayRequestError(400, "Invalid history cursor");
    const page = await readDiagnosticHistory(id, before);
    if (url.searchParams.get("download") === "1") {
      const iterator = downloadDiagnosticLog(id);
      return new Response(new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await iterator.next();
            if (next.done) controller.close(); else controller.enqueue(next.value);
          } catch (error) { controller.error(error); }
        },
        async cancel() { await iterator.return(undefined); },
      }), { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="maps-diagnostics-${id}.log"`, "Cache-Control": "no-store" } });
    }
    return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return NextResponse.json({ error: "Capture not found" }, { status: 404 });
    return errorResponse(error);
  }
}
