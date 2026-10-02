import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { projectFromXml } from "@/gateway-families/knx-mbm/from-xml";
import { XmlDocument } from "@/core/project-format";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { emptyScanResult, scanInputSchema, type ScanJob } from "@/core/modbus-scan/model";
import { chooseOption } from "@/components/ui/select-testing";
import { ModbusScanModal } from "./modbus-scan-modal";
const mocked = vi.hoisted(() => ({ request: vi.fn(), acceptView: vi.fn(), job: null as ScanJob | null }));
const view = { family: "knx-mbm", meta: { id: "p", revision: 5 }, project: projectFromXml(XmlDocument.parse(SYNTHETIC_KNX_MBM_XML)) };
vi.mock("@/lib/api", () => ({ request: (...args: unknown[]) => mocked.request(...args) }));
vi.mock("@/lib/current-project", () => ({ useCurrentProject: () => ({ view, projectId: "p", acceptView: mocked.acceptView, setProjectId: vi.fn() }) }));
vi.mock("@/lib/gateway-session", () => ({ useGatewaySession: () => ({ session: { id: "live", host: "192.0.2.10", connected: true, gateway: { appId: 4 } } }) }));
vi.mock("@/lib/property-drafts", () => ({ usePropertyDrafts: () => ({ snapshot: { projects: {} } }) }));
function job(state: ScanJob["state"] = "completed"): ScanJob {
  return { id: "job", input: scanInputSchema.parse({ projectId: "p", locator: { kind: "rtu", nodeIndex: 0 }, slave: 1, ranges: [{ function: 3, start: 109, end: 110 }] }), host: "192.0.2.10", state, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), cancelRequested: false, needsRestore: state === "restore-pending", backupHash: "a".repeat(64), restoredHash: state === "completed" ? "a".repeat(64) : undefined, batch: 1, batches: 1, points: 2, processed: 2, results: [109,110].map((address) => ({ ...emptyScanResult({ function: 3, address }), samples: 2, attempts: 2, status: "readable", lastValue: address === 109 ? 1 : 65535, values: [address === 109 ? 1 : 65535] })) };
}
beforeEach(() => { mocked.job = null; mocked.request.mockReset(); mocked.acceptView.mockReset(); mocked.request.mockImplementation(async (_url, options) => options?.method === "POST" ? { job: job() } : { jobs: mocked.job ? [mocked.job] : [] }); });
afterEach(cleanup);
it("starts with all four functions and keeps displayed base 1 out of wire addresses", async () => {
  render(<ModbusScanModal initialLocator={{ kind: "rtu", nodeIndex: 0 }} onClose={() => {}} />);
  chooseOption(screen.getByLabelText("Address display base"), "Base 1");
  expect(screen.getByLabelText("FC03 start address")).toHaveValue("1");
  fireEvent.click(screen.getByRole("button", { name: "Start scan" }));
  await waitFor(() => expect(mocked.request).toHaveBeenCalledWith("/api/modbus-scans", expect.objectContaining({ method: "POST" })));
  const body = JSON.parse(mocked.request.mock.calls.find((call) => call[1]?.method === "POST")![1].body);
  expect(body.ranges.map((range: { function: number }) => range.function)).toEqual([1,2,3,4]); expect(body.ranges.every((range: { start: number; end: number }) => range.start === 0 && range.end === 255)).toBe(true);
});
it("closing the window leaves the server job running", async () => {
  mocked.job = job("scanning"); const close = vi.fn(); render(<ModbusScanModal initialLocator={{ kind: "rtu", nodeIndex: 0 }} onClose={close} />);
  await screen.findByRole("progressbar"); fireEvent.click(screen.getByRole("button", { name: "Close" })); expect(close).toHaveBeenCalled();
  expect(mocked.request.mock.calls.some((call) => call[1]?.method === "DELETE")).toBe(false);
});
it("offers manual recovery with the backup hash and prevents importing until restored", async () => {
  mocked.job = job("restore-pending"); render(<ModbusScanModal initialLocator={{ kind: "rtu", nodeIndex: 0 }} onClose={() => {}} />);
  await screen.findByRole("progressbar"); expect(screen.getByText(/Backup SHA-256/)).toHaveTextContent("a".repeat(64));
  fireEvent.click(screen.getByLabelText("Select FC03 PDU 109")); expect(screen.getByRole("button", { name: "Add selected (1)" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Restore backup" })); await waitFor(() => expect(mocked.request).toHaveBeenCalledWith("/api/modbus-scans/job/restore", expect.objectContaining({ body: JSON.stringify({ sessionId: "live" }) })));
});
it("imports only selected reads with the current project revision", async () => {
  mocked.job = job(); mocked.request.mockImplementation(async (url) => url.endsWith("/import") ? view : { jobs: [mocked.job] });
  render(<ModbusScanModal initialLocator={{ kind: "rtu", nodeIndex: 0 }} initialJobId="job" onClose={() => {}} />);
  await screen.findByLabelText("Select FC03 PDU 110"); fireEvent.click(screen.getByLabelText("Select FC03 PDU 110")); fireEvent.click(screen.getByRole("button", { name: "Add selected (1)" }));
  await waitFor(() => expect(mocked.acceptView).toHaveBeenCalledWith(view));
  const body = JSON.parse(mocked.request.mock.calls.find((call) => call[0].endsWith("/import"))![1].body); expect(body).toEqual({ selected: ["3:110"], revision: 5 });
});
it("keeps New scan selected when polling a completed job opened from the banner", async () => {
  vi.useFakeTimers(); mocked.job = job();
  try {
    await act(async () => { render(<ModbusScanModal initialLocator={{ kind: "rtu", nodeIndex: 0 }} initialJobId="job" onClose={() => {}} />); });
    chooseOption(screen.getByLabelText("Saved scans"), "New scan");
    expect(screen.getByRole("button", { name: "Start scan" })).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(screen.getByRole("button", { name: "Start scan" })).toBeVisible();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  } finally { cleanup(); vi.useRealTimers(); }
});
