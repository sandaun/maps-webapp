import { errorResponse } from "@/server/projects/http";
import { exportSignalsXlsx } from "@/server/projects/service";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // The MAPS version that will import the file (B3); the project's when absent.
    const mapsVersion = new URL(request.url).searchParams.get("mapsVersion") ?? undefined;
    const file = await exportSignalsXlsx(id, { mapsVersion });
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
