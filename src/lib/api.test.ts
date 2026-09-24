import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, patchProject } from "./api";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("patchProject", () => {
  it("sends the revision as If-Match, including revision 0", async () => {
    const fetch = stubFetch(200, {});
    await patchProject("demo", [{ type: "setGeneralInfo", name: "x" }], 0);
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["If-Match"]).toBe('"0"');
  });

  it("omits If-Match when no revision is known", async () => {
    const fetch = stubFetch(200, {});
    await patchProject("demo", [{ type: "setGeneralInfo", name: "x" }]);
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("If-Match");
  });

  it("exposes the server's machine-readable error code", async () => {
    stubFetch(409, { error: "Changed elsewhere", code: "revision-conflict" });
    const error = await patchProject("demo", [{ type: "setGeneralInfo", name: "x" }], 3).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "revision-conflict" });
  });
});
