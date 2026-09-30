import { NextResponse } from "next/server";
export function templateDownload(bytes: Uint8Array, fileName: string) {
  const safe = fileName.replace(/[\\/:*?"<>|\r\n]+/g, " ").trim() || "device.knxmbm";
  return new NextResponse(Buffer.from(bytes), { headers: {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="device.knxmbm"; filename*=UTF-8''${encodeURIComponent(safe)}`,
    "Cache-Control": "no-store",
  } });
}
