import { NextResponse } from "next/server";
import { ProjectServiceError } from "./service";

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ProjectServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  return NextResponse.json({ error: message }, { status: 500 });
}
