import { NextResponse } from "next/server";
import { GatewayRequestError, getGatewaySessionManager } from "@/server/intesis-transport";
import { errorResponse } from "@/server/projects/http";

export const runtime = "nodejs";

const MAX_COMMAND_LENGTH = 200;

/**
 * Diagnostics console: sends one free-text command line to the gateway and
 * returns the response lines (docs/reference/console-protocol.md). Unknown
 * commands are answered with silence by the firmware — the response closes on
 * an idle gap, so an empty `lines` array is a normal outcome, not an error.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { command?: unknown };
    const command = typeof body.command === "string" ? body.command.trim() : "";
    if (!command) throw new GatewayRequestError(400, "Missing console command");
    if (command.length > MAX_COMMAND_LENGTH) {
      throw new GatewayRequestError(400, `Console commands are limited to ${MAX_COMMAND_LENGTH} chars`);
    }
    if (/[\r\n]/.test(command)) {
      throw new GatewayRequestError(400, "Console commands must be a single line");
    }
    const result = await getGatewaySessionManager().runConsoleCommand(id, command);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
