import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTemplateLibrary, downloadLibraryTemplate } from "./library";

const cache = () => (globalThis as typeof globalThis & { mapsTemplateLibrary?: Map<string, unknown> }).mapsTemplateLibrary!;
const entry = (id: string) => ({ id, manufacturer: { name:"Test maker",slug:"test" }, model:{ name:`Model ${id}`,slug:id,version:"1" }, version:"1.0",
  internalProtocol:{name:"KNX",slug:"knx"},externalProtocol:{name:"Modbus Master",slug:"modbus-mbm"},file:`https://api-tools.intesis.com/v1/templates/${id}/files/file` });

beforeEach(() => { cache().clear(); });
afterEach(() => { cache().clear(); vi.unstubAllGlobals(); });

describe("official template library", () => {
  it("reads every page despite a total equal to the page size, caches it, and downloads original binary", async () => {
    const fetcher = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/files/file")) return new Response(Uint8Array.from([1,2,3]));
      const offset = Number(parsed.searchParams.get("pagination[offset]"));
      return Response.json({items:Array.from({length:offset === 0 ? 100 : 12},(_,i) => entry(String(offset+i))),pagination:{total:offset === 0 ? 100 : 12}});
    });
    vi.stubGlobal("fetch",fetcher);
    const library = await getTemplateLibrary();
    expect(library.entries).toHaveLength(112);
    expect(library.manufacturers).toEqual(["Test maker"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await getTemplateLibrary();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const file = await downloadLibraryTemplate("111");
    expect([...file.bytes]).toEqual([1,2,3]);
    expect(file.fileName).toBe("Test maker - Model 111.knxmbm");
    await expect(downloadLibraryTemplate("missing")).rejects.toMatchObject({status:404});
  });

  it("fails clearly for repeated full pages rather than returning a truncated catalog", async () => {
    vi.stubGlobal("fetch",vi.fn(async () => Response.json({items:Array.from({length:100},(_,i) => entry(String(i)))})));
    await expect(getTemplateLibrary()).rejects.toThrow(/repeated a page/);
  });

  it("blocks foreign file URLs without making a download request", async () => {
    const fetcher = vi.fn(async () => Response.json({items:[{...entry("x"),file:"https://example.com/v1/templates/x/files/file"}]}));
    vi.stubGlobal("fetch",fetcher);
    await expect(downloadLibraryTemplate("x")).rejects.toMatchObject({status:502});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("accepts the API's slash redirect and rejects a redirect to another origin", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null,{status:301,headers:{location:"https://api-tools.intesis.com/v1/templates/"}}))
      .mockResolvedValueOnce(Response.json({items:[entry("x")]}))
      .mockResolvedValueOnce(new Response(null,{status:302,headers:{location:"https://example.com/file"}}));
    vi.stubGlobal("fetch",fetcher);
    expect((await getTemplateLibrary()).entries).toHaveLength(1);
    await expect(downloadLibraryTemplate("x")).rejects.toThrow(/Unexpected template download/);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("returns an actionable error for upstream failures and malformed responses", async () => {
    vi.stubGlobal("fetch",vi.fn(async () => new Response("Unavailable",{status:503})));
    await expect(getTemplateLibrary()).rejects.toThrow(/import a local template/);
    vi.stubGlobal("fetch",vi.fn(async () => Response.json({items:[{id:"broken"}]})));
    await expect(getTemplateLibrary()).rejects.toThrow(/Invalid response/);
  });
});
