import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Header } from "./header";

const mocks = vi.hoisted(() => ({
  view: {
    meta: { family: "knx-mbm" as const },
    family: "knx-mbm" as const,
    issues: [] as { severity: string }[],
  },
  dirtyCount: 3,
  listSessions: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/signals",
  useRouter: () => ({ push: vi.fn() }),
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

vi.mock("@/lib/gateway-api", () => ({
  listGatewaySessions: () => mocks.listSessions(),
}));

describe("Header", () => {
  it("shows protocol, valid, pending changes, offline and Deploy", async () => {
    mocks.listSessions.mockResolvedValue([]);
    render(<Header />);

    expect(screen.getByText("KNX ↔ Modbus Master")).toBeInTheDocument();
    expect(screen.getByText("Valid")).toBeInTheDocument();
    expect(screen.getByText("3 changes pending")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deploy" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Offline")).toBeInTheDocument());
  });

  it("shows Connected when a gateway session is live", async () => {
    mocks.listSessions.mockResolvedValue([
      { id: "s1", host: "192.168.1.50", port: 23, connected: true },
    ]);
    render(<Header />);
    await waitFor(() => expect(screen.getByText("Connected · 192.168.1.50")).toBeInTheDocument());
  });
});
