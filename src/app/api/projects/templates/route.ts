import { NextResponse } from "next/server";
import { z } from "zod";
import { createTemplateProject } from "@/server/projects/service";
import { errorResponse } from "@/server/projects/http";

export const runtime = "nodejs";

const bodySchema = z.object({
  family: z.enum(["knx-mbm", "me-mbs"]),
  name: z.string().trim().min(1).max(200),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const project = await createTemplateProject(body.family, body.name);
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
