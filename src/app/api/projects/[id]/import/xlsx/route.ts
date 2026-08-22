import { NextResponse } from "next/server";
import { errorResponse } from "@/server/projects/http";
import { importSignalsXlsx } from "@/server/projects/service";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing 'file' form field" }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "File too large" }, { status: 413 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = await importSignalsXlsx(id, bytes, file.name);
    return NextResponse.json(view);
  } catch (error) {
    return errorResponse(error);
  }
}
