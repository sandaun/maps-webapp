import { errorResponse } from "@/server/projects/http";
import { exportEsf } from "@/server/projects/service";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const file = await exportEsf(id);
    return new Response(file.body, {
      headers: {
        "Content-Type": "text/tab-separated-values; charset=utf-8",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.filename)}"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
