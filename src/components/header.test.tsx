import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "./header";

const mocks = vi.hoisted(() => ({
  view: {
    meta: { family: "knx-mbm" as const },
    family: "knx-mbm" as const,
    issues: [] as { severity: string }[],
  },
  dirtyCount: 3,
  unsavedCount: 3,
  session: null as null | { id: string; host: string; port: number; connected: boolean },
  pathname: "/signals",
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/lib/current-project", () => ({
  useCurrentProject: () => ({ view: mocks.view }),
}));

vi.mock("@/lib/workspace-chrome", () => ({
  useWorkspaceChrome: () => ({
    dirtyCount: mocks.dirtyCount,
    sidebarCollapsed: false,
    setSidebarCollapsed: vi.fn(),
    bumpDirty: vi.fn(),
    undo: null,
    pushUndo: vi.fn(),
    clearUndo: vi.fn(),
  }),
}));

vi.mock("@/lib/gateway-session", () => ({
  useGatewaySession: () => ({ session: mocks.session, loading: false, refresh: vi.fn() }),
}));

vi.mock("@/lib/property-drafts", () => ({
  usePendingPropertyChanges: () => mocks.unsavedCount,
  useSaveInProgress: () => false,
}));

beforeEach(() => {
  mocks.pathname = "/signals";
  mocks.dirtyCount = 3;
  mocks.unsavedCount = 3;
  mocks.session = null;
});

describe("Header", () => {
  it("shows protocol, valid, unsaved changes, offline and Deploy", async () => {
    mocks.session = null;
    render(<Header />);

    expect(screen.getByText("KNX TP")).toBeInTheDocument();
    expect(screen.getByText("MODBUS MASTER")).toBeInTheDocument();
    expect(screen.getByText("Valid")).toBeInTheDocument();
    expect(screen.getByText("3 unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deploy" })).toHaveClass("h-[34px]", "rounded-[4px]");
    await waitFor(() => expect(screen.getByText("Not connected")).toBeInTheDocument());
  });

  it("opens Validation from the Valid chip", async () => {
    mocks.push.mockReset();
    mocks.session = null;
    render(<Header />);
    fireEvent.click(screen.getByRole("button", { name: "Valid" }));
    expect(mocks.push).toHaveBeenCalledWith("/signals?tab=validation");
  });

  it("shows Connected when a gateway session is live", async () => {
    mocks.session = { id: "s1", host: "192.168.1.50", port: 23, connected: true };
    render(<Header />);
    await waitFor(() => expect(screen.getByText("Connected · Ethernet")).toBeInTheDocument());
    expect(screen.getByText("192.168.1.50")).toBeInTheDocument();
  });

  it("keeps project status and deploy actions visible in Projects", () => {
    mocks.pathname = "/projects";
    mocks.dirtyCount = 0;
    mocks.unsavedCount = 0;
    render(<Header />);

    expect(screen.getByLabelText("Breadcrumb")).toHaveTextContent("Local workspace/Projects");
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByText("Valid")).toBeInTheDocument();
    expect(screen.queryByText("Up to date")).not.toBeInTheDocument();
    expect(screen.queryByText(/unsaved change/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deploy" })).toBeInTheDocument();
  });

  it("does not label saved local changes as unsaved or synchronized", () => {
    mocks.dirtyCount = 5;
    mocks.unsavedCount = 0;
    render(<Header />);
    expect(screen.queryByText(/unsaved change|changes pending|Up to date/)).not.toBeInTheDocument();
  });

  it("clears the unsaved chip when edits have been saved", () => {
    mocks.unsavedCount = 1;
    const { rerender } = render(<Header />);
    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();
    mocks.unsavedCount = 0;
    rerender(<Header />);
    expect(screen.queryByText(/unsaved change/)).not.toBeInTheDocument();
  });
});
