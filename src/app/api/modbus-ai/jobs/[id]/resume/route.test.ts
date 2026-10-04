// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { ProjectServiceError } from "@/server/projects/errors";
const { resume } = vi.hoisted(() => ({ resume: vi.fn() }));
vi.mock("@/server/modbus-ai/service", () => ({
  getModbusAIService: () => ({ resume }),
}));
import { POST } from "./route";

afterEach(() => resume.mockReset());
function request(body: unknown) {
  return new Request("http://localhost/api/modbus-ai/jobs/document/resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const context = () => ({ params: Promise.resolve({ id: "document" }) });

it.each([false, true])(
  "forwards explicit profile selection %s to resume",
  async (useCurrentSettings) => {
    resume.mockResolvedValue({ id: "document", state: "extracting" });
    const response = await POST(
      request({ revision: 7, useCurrentSettings }),
      context(),
    );
    expect(response.status).toBe(202);
    expect(resume).toHaveBeenCalledWith("document", 7, useCurrentSettings);
  },
);
it("defaults to the current Settings profile", async () => {
  resume.mockResolvedValue({ id: "document" });
  await POST(request({ revision: 7 }), context());
  expect(resume).toHaveBeenCalledWith("document", 7, true);
});
it.each([{ revision: -1 }, { revision: 1, useCurrentSettings: "yes" }, {}])(
  "rejects invalid input without starting work",
  async (body) => {
    expect((await POST(request(body), context())).status).toBe(422);
    expect(resume).not.toHaveBeenCalled();
  },
);
it.each([404, 409])("preserves service HTTP errors (%i)", async (status) => {
  resume.mockRejectedValue(new ProjectServiceError(status, "Resume refused"));
  expect((await POST(request({ revision: 7 }), context())).status).toBe(status);
});
