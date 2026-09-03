import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBusScanResult } from "@/gateway-families/me-mbs/bus-scan";
import { GatewayRequestError, getGatewaySessionManager } from "@/server/intesis-transport";
import { errorResponse } from "@/server/projects/http";

export const runtime = "nodejs";

const bodySchema = z
  .object({
    /** Controller `TypeIndex` (0 = direct connection, 1-3 = expansion). */
    typeIndex: z.number().int().min(0),
    ip: z.string().max(45),
    port: z.number().int().min(1).max(65535),
    /**
     * Secure controllers (AE-C400E) need credentials appended to the command;
     * those never leave the gateway, so the scan is not supported for them.
     */
    secure: z.literal(false).optional(),
  })
  .strict();

/**
 * M-NET bus scan of a Mitsubishi Electric centralized controller via the
 * diagnostics console (`1ME:CMD:BUSSCAN`, docs/reference/console-protocol.md).
 * Read-only on the controller; the response streams progress and group lines
 * until `CMD:BUSSCAN:END` / `...:ERR`, hence the long deadline and idle gap.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const raw = (await request.json().catch(() => ({}))) as { secure?: unknown };
    if (raw.secure) {
      throw new GatewayRequestError(
        400,
        "Secure controllers (AE-C400E) require credentials that the web app never handles — bus scan is not supported for them",
      );
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid scan payload", details: parsed.error.issues },
        { status: 400 },
      );
    }
    const { typeIndex, ip, port } = parsed.data;
    const command = `1ME:CMD:BUSSCAN,${typeIndex},${ip}:${port}`;
    const result = await getGatewaySessionManager().runConsoleCommand(id, command, {
      timeoutMs: 120_000,
      idleMs: 10_000,
      doneWhen: (line) =>
        line.includes("CMD:BUSSCAN:END") ||
        line.includes("BUSSCAN:ERR") ||
        line.includes("1ME:CMD:ERR"),
    });
    return NextResponse.json(parseBusScanResult(result.lines));
  } catch (error) {
    return errorResponse(error);
  }
}
