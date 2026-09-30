import { XmlDocument } from "@/core/project-format";
import { getProjectStore } from "@/server/persistence";
import { withProjectLock } from "@/server/projects/project-lock";
import { readProjectXml } from "@/server/projects/service";
import { errorResponse } from "@/server/projects/http";
import { ProjectServiceError } from "@/server/projects/errors";
import { isKnxMbmProject } from "@/gateway-families/knx-mbm";
import { exportDeviceTemplate } from "@/server/device-templates/export";
import { templateDownload } from "@/server/device-templates/download";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params, url = new URL(request.url);
    const kind = url.searchParams.get("kind"), nodeIndex = Number(url.searchParams.get("nodeIndex")), deviceIndex = Number(url.searchParams.get("deviceIndex"));
    if ((kind !== "rtu" && kind !== "tcp") || !url.searchParams.has("nodeIndex") || !url.searchParams.has("deviceIndex") ||
        !Number.isInteger(nodeIndex) || nodeIndex < 0 || !Number.isInteger(deviceIndex) || deviceIndex < 0)
      throw new ProjectServiceError(400,"Invalid device locator.");
    const store = getProjectStore();
    return await withProjectLock(store.storageId(id), async () => {
      if (!(await store.get(id))) throw new ProjectServiceError(404,"Project not found.");
      // The project as MAPS loads it (`readProjectXml`).
      const doc = XmlDocument.parse(await readProjectXml(id));
      if (!isKnxMbmProject(doc)) throw new ProjectServiceError(409,"Device template export is available for KNX–Modbus Master projects.");
      const { bytes, fileName } = exportDeviceTemplate(doc, { kind, nodeIndex, deviceIndex });
      return templateDownload(bytes, fileName);
    });
  } catch (error) { return errorResponse(error); }
}
