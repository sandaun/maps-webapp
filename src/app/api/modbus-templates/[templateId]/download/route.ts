import { downloadLibraryTemplate } from "@/server/device-templates/library";
import { templateDownload } from "@/server/device-templates/download";
import { errorResponse } from "@/server/projects/http";
export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const { templateId } = await params;
    const { bytes, fileName } = await downloadLibraryTemplate(templateId);
    return templateDownload(bytes, fileName);
  } catch (error) { return errorResponse(error); }
}
