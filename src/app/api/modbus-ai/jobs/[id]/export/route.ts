import { NextResponse } from "next/server";
import { getModbusAIService } from "@/server/modbus-ai/service";
import { candidateTemplate } from "@/server/modbus-ai/template";
import { errorResponse } from "@/server/projects/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const service = getModbusAIService();
    const id = (await params).id;
    const job = await service.get(id);
    const format = new URL(request.url).searchParams.get("format") ?? "report";
    if (format === "pdf")
      return new Response(await service.store.pdf(id), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'inline; filename="source.pdf"',
        },
      });
    if (format === "template") {
      const { rows } = await service.assertImport(
        id,
        job.revision,
        job.signals.filter((r) => r.enabled).map((r) => r.id),
      );
      const result = candidateTemplate(
        rows,
        job.model || "PDF device",
        job.manufacturer,
      );
      return new Response(new Uint8Array(result.bytes), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": 'attachment; filename="document-map.knxmbm"',
        },
      });
    }
    return NextResponse.json(await service.report(id), {
      headers: {
        "Content-Disposition": 'attachment; filename="modbus-validation.json"',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
