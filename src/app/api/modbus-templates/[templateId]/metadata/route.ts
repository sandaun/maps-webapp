import { NextResponse } from "next/server";
import { downloadLibraryTemplate } from "@/server/device-templates/library";
import { readDeviceTemplateMetadata } from "@/server/device-templates/read";
import { errorResponse } from "@/server/projects/http";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const { templateId } = await params;
    const { bytes } = await downloadLibraryTemplate(templateId);
    return NextResponse.json(readDeviceTemplateMetadata(bytes));
  } catch (error) { return errorResponse(error); }
}
