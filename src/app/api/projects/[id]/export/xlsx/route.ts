import { errorResponse } from "@/server/projects/http";
import { exportSignalsXlsx } from "@/server/projects/service";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const file = await exportSignalsXlsx(id);
    return new Response(new Uint8Array(file.body), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.filename)}"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
