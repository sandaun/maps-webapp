import { NextResponse } from "next/server";
import { z } from "zod";
import { discoverGateways, listBroadcastTargets } from "@/server/intesis-transport";
import { errorResponse } from "@/server/projects/http";

export const runtime = "nodejs";

const ipv4 = z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/, "expected a dotted-quad IPv4 address");

const bodySchema = z
  .object({
    timeoutMs: z.number().int().min(200).max(10_000).optional(),
    /**
     * Optional unicast targets (directed discovery). Needed when broadcast
     * cannot reach the LAN — e.g. the app runs inside WSL2/NAT, where
     * broadcast datagrams never leave the virtual switch.
     */
    targets: z.array(ipv4).max(64).optional(),
  })
  .optional();

/**
 * UDP/23 discovery scan: broadcasts `INFO?` per interface + 255.255.255.255
 * and collects gateway responses (read-only, PROTOCOL.md §2.1). Optional
 * unicast targets are queried in addition to the broadcasts.
 */
export async function POST(request: Request) {
  try {
    const text = await request.text();
    const body = bodySchema.parse(text ? JSON.parse(text) : undefined);
    const targets = body?.targets?.length
      ? [...listBroadcastTargets(), ...body.targets]
      : undefined;
    const gateways = await discoverGateways({ timeoutMs: body?.timeoutMs, targets });
    return NextResponse.json({ gateways });
  } catch (error) {
    return errorResponse(error);
  }
}
