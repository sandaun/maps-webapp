import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewaySessionStatus } from "@/lib/gateway-api";
import { GatewayTransferActions } from "./gateway-transfer-actions";

const mocks = vi.hoisted(() => ({
  session: null as GatewaySessionStatus | null,
  view: {} as object | null,
  loading: false,
  mutating: false,
  saving: false,
  dirty: 0,
  drafts: 0,
  status: null as GatewaySessionStatus | null,
  progress: null as { receivedBytes: number; totalBytes: number } | null,
  receive: vi.fn(),
  setProjectId: vi.fn(),
  bumpDirty: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/current-project", () => ({ useCurrentProject: () => ({
  view: mocks.view, loading: mocks.loading, mutating: mocks.mutating, setProjectId: mocks.setProjectId,
}) }));
vi.mock("@/lib/gateway-session", () => ({ useGatewaySession: () => ({ session: mocks.session, loading: false }) }));
vi.mock("@/lib/gateway-api", () => ({ receiveGatewayProject: mocks.receive }));
vi.mock("@/lib/workspace-chrome", () => ({ useWorkspaceChrome: () => ({ dirtyCount: mocks.dirty, bumpDirty: mocks.bumpDirty }) }));
vi.mock("@/lib/property-drafts", () => ({
  usePendingPropertyChanges: () => mocks.drafts, useSaveInProgress: () => mocks.saving,
}));
vi.mock("@/lib/use-session-events", () => ({ useSessionEvents: () => ({ progress: mocks.progress, status: mocks.status }) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { id: "s1", host: "192.168.1.50", port: 23, connected: true, busy: false, encrypted: true, connectedAt: "2026-10-02T10:00:00Z", monitoring: false, monitorComms: false, monitorDebug: false };
  mocks.view = {};
  mocks.loading = mocks.mutating = mocks.saving = false;
  mocks.dirty = mocks.drafts = 0;
  mocks.status = null;
  mocks.progress = null;
  mocks.receive.mockResolvedValue({ id: "received", name: "Gateway project" });
});

describe("GatewayTransferActions", () => {
  it("groups both actions and opens the gated Deploy screen", () => {
    render(<GatewayTransferActions />);
    const group = screen.getByRole("group", { name: "Gateway transfer" });
    expect(within(group).getByRole("button", { name: "Receive" })).toBeEnabled();
    fireEvent.click(within(group).getByRole("button", { name: "Deploy" }));
    expect(mocks.push).toHaveBeenCalledWith("/deploy");
  });

  it.each(["offline", "busy", "saving", "mutating", "loading", "live busy"])("blocks transfers when %s", (state) => {
    if (state === "offline") mocks.session = null;
    if (state === "busy") mocks.session!.busy = true;
    if (state === "saving") mocks.saving = true;
    if (state === "mutating") mocks.mutating = true;
    if (state === "loading") mocks.loading = true;
    if (state === "live busy") mocks.status = { ...mocks.session!, busy: true };
    render(<GatewayTransferActions />);
    expect(screen.getByRole("button", { name: "Receive" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deploy" })).toBeDisabled();
  });

  it("allows Receive without an open project", async () => {
    mocks.view = null;
    render(<GatewayTransferActions />);
    expect(screen.getByRole("button", { name: "Deploy" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Receive" }));
    await waitFor(() => expect(mocks.setProjectId).toHaveBeenCalledWith("received"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Gateway project");
  });

  it.each(["local changes", "property drafts"])("requires confirmation for %s and permits cancellation", (state) => {
    if (state === "local changes") mocks.dirty = 2;
    else mocks.drafts = 2;
    render(<GatewayTransferActions />);
    fireEvent.click(screen.getByRole("button", { name: "Receive" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("2 pending changes");
    expect(mocks.receive).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.setProjectId).not.toHaveBeenCalled();
  });

  it("switches projects only after the confirmed receive succeeds", async () => {
    mocks.dirty = 3;
    render(<GatewayTransferActions />);
    fireEvent.click(screen.getByRole("button", { name: "Receive" }));
    fireEvent.click(screen.getByRole("button", { name: "Receive project" }));
    await waitFor(() => expect(mocks.setProjectId).toHaveBeenCalledWith("received"));
    expect(mocks.receive).toHaveBeenCalledExactlyOnceWith("s1");
    expect(mocks.bumpDirty).toHaveBeenCalledWith(-3);
  });

  it("invalidates confirmation when the connected gateway changes", () => {
    mocks.drafts = 1;
    const { rerender } = render(<GatewayTransferActions />);
    fireEvent.click(screen.getByRole("button", { name: "Receive" }));
    mocks.session = { ...mocks.session!, id: "s2" };
    rerender(<GatewayTransferActions />);
    expect(screen.getByRole("button", { name: "Receive project" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Receive project" }));
    expect(mocks.receive).not.toHaveBeenCalled();
  });

  it("shows transfer progress and blocks duplicate receives and Deploy", async () => {
    let finish!: (value: { id: string; name: string }) => void;
    mocks.receive.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    mocks.progress = { receivedBytes: 1024, totalBytes: 1024 };
    const { rerender } = render(<GatewayTransferActions />);
    fireEvent.click(screen.getByRole("button", { name: "Receive" }));
    expect(screen.queryByLabelText("Transfer progress")).not.toBeInTheDocument();
    mocks.progress = { receivedBytes: 512, totalBytes: 1024 };
    rerender(<GatewayTransferActions />);
    expect(screen.getByLabelText("Transfer progress")).toHaveTextContent("50%");
    expect(screen.getByRole("button", { name: "Deploy" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Receiving…" }));
    expect(mocks.receive).toHaveBeenCalledTimes(1);
    expect(mocks.setProjectId).not.toHaveBeenCalled();
    finish({ id: "received", name: "Gateway project" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Receive" })).toBeEnabled());
  });

  it("keeps the current project and changes on failure and allows retry", async () => {
    mocks.receive.mockRejectedValueOnce(new Error("Connection lost"));
    render(<GatewayTransferActions />);
    fireEvent.click(screen.getByRole("button", { name: "Receive" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
    expect(mocks.setProjectId).not.toHaveBeenCalled();
    expect(mocks.bumpDirty).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Receive" }));
    await waitFor(() => expect(mocks.setProjectId).toHaveBeenCalledWith("received"));
  });
});
