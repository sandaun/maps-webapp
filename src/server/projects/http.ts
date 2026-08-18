import { NextResponse } from "next/server";
import { ProjectServiceError } from "./service";

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ProjectServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  // Any service error carrying an HTTP status (e.g. GatewayRequestError).
  const status = (error as { status?: unknown } | null)?.status;
  if (error instanceof Error && typeof status === "number") {
    return NextResponse.json({ error: error.message }, { status });
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  return NextResponse.json({ error: message }, { status: 500 });
}
