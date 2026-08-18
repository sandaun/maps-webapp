import { NextResponse } from "next/server";
import { z } from "zod";
import { discoverGateways } from "@/server/intesis-transport";
import { errorResponse } from "@/server/projects/http";

export const runtime = "nodejs";

const bodySchema = z
  .object({ timeoutMs: z.number().int().min(200).max(10_000).optional() })
  .optional();

/**
 * UDP/23 discovery scan: broadcasts `INFO?` per interface + 255.255.255.255
 * and collects gateway responses (read-only, PROTOCOL.md §2.1).
 */
export async function POST(request: Request) {
  try {
    const text = await request.text();
    const body = bodySchema.parse(text ? JSON.parse(text) : undefined);
    const gateways = await discoverGateways({ timeoutMs: body?.timeoutMs });
    return NextResponse.json({ gateways });
  } catch (error) {
    return errorResponse(error);
  }
}
