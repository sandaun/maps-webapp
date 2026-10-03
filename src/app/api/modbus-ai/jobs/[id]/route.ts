import { NextResponse } from "next/server";
import { z } from "zod";
import { getModbusAIService } from "@/server/modbus-ai/service";
import { errorResponse } from "@/server/projects/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) { try { return NextResponse.json(await getModbusAIService().report((await context.params).id)); } catch (error) { return errorResponse(error); } }
export async function PATCH(request: Request, context: Context) {
  try { const body = z.object({ revision: z.number().int().min(0), signals: z.array(z.unknown()).max(4096) }).parse(await request.json()); return NextResponse.json({ job: await getModbusAIService().update((await context.params).id, body.revision, body.signals) }); }
  catch (error) { return errorResponse(error); }
}
