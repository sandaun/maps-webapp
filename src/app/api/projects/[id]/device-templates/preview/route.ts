import { NextResponse } from "next/server";
import { getProjectView } from "@/server/projects/service";
import { errorResponse } from "@/server/projects/http";
import { ProjectServiceError } from "@/server/projects/errors";
import { readDeviceTemplate } from "@/server/device-templates/read";
import { rememberTemplate } from "@/server/device-templates/cache";
import { MAX_TEMPLATE_BYTES } from "@/server/device-templates/crypto";
import { downloadLibraryTemplate } from "@/server/device-templates/library";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const view = await getProjectView(id);
    if (view.family !== "knx-mbm") throw new ProjectServiceError(409, "Device template import is available for KNX–Modbus Master projects.");
    const form = await request.formData();
    const file = form.get("file"), libraryId = form.get("libraryId");
    let bytes: Uint8Array, fileName: string, manufacturer = "";
    if (file instanceof File && !libraryId) {
      if (file.size > MAX_TEMPLATE_BYTES) throw new ProjectServiceError(413, "Template must be at most 8 MB.");
      if (!/\.(knxmbm|knxmbr|bacmbm)$/i.test(file.name)) throw new ProjectServiceError(422, "Choose a .knxmbm, .knxmbr or .bacmbm file.");
      bytes = new Uint8Array(await file.arrayBuffer()); fileName = file.name;
    } else if (typeof libraryId === "string" && libraryId && !file) {
      const downloaded = await downloadLibraryTemplate(libraryId);
      bytes = downloaded.bytes; fileName = downloaded.fileName; manufacturer = downloaded.manufacturer;
    } else throw new ProjectServiceError(400, "Choose one template file or library template.");
    const parsed = readDeviceTemplate(bytes, manufacturer);
    const revision = view.meta.revision ?? 0;
    const token = rememberTemplate(id, revision, parsed);
    return NextResponse.json({ ...parsed.preview, revision, token, fileName });
  } catch (error) { return errorResponse(error); }
}
