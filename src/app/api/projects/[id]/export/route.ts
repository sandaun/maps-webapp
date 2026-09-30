import { NextResponse } from "next/server";
import { getProjectStore } from "@/server/persistence";
import { errorResponse } from "@/server/projects/http";
import { readProjectXml } from "@/server/projects/service";

export const runtime = "nodejs";

/** Download the current .ibmaps XML of a project. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const store = getProjectStore();
    const meta = await store.get(id);
    if (!meta) return NextResponse.json({ error: `Project "${id}" not found` }, { status: 404 });
    const xml = await readProjectXml(id);
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(meta.name)}.ibmaps"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
