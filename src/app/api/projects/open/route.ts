import { NextResponse } from "next/server";
import { openCompleteBlob, openIbmaps } from "@/server/projects/service";
import { errorResponse } from "@/server/projects/http";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

/**
 * Open a local file without a gateway: a `.ibmaps` XML or a "complete" blob
 * received earlier from a gateway. Multipart form field: `file`.
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing 'file' form field" }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "File too large" }, { status: 413 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const looksLikeXml = bytes[0] === 0xef || bytes[0] === 0x3c; // BOM or '<'

    const baseName = file.name.replace(/\.(ibmaps|bin)$/i, "");
    const id = `file-${Date.now().toString(36)}`;
    const meta = looksLikeXml
      ? await openIbmaps(new TextDecoder().decode(bytes), { id, name: baseName })
      : await openCompleteBlob(bytes, { id, name: baseName });
    return NextResponse.json({ project: meta }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
