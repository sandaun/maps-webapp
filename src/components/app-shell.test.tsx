import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewaySessionStatus } from "@/lib/gateway-api";
import { WorkspaceChromeProvider } from "@/lib/workspace-chrome";
import { AppShell } from "./app-shell";

const mocks = vi.hoisted(() => ({
  session: null as GatewaySessionStatus | null,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/connection",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/gateway-session", () => ({
  useGatewaySession: () => ({ session: mocks.session, loading: false, refresh: vi.fn() }),
}));

vi.mock("@/lib/current-project", () => ({
  usePatch: () => vi.fn(),
  useCurrentProject: () => ({
    view: {
      meta: { name: "Office demo", source: "demo", family: "knx-mbm" },
      family: "knx-mbm",
      issues: [],
    },
  }),
}));

afterEach(() => {
  mocks.session = null;
  window.localStorage.clear();
});

describe("AppShell", () => {
  it("renders brand, all 7 nav sections and the demo banner", () => {
    render(
      <WorkspaceChromeProvider>
        <AppShell>
          <div>content</div>
        </AppShell>
      </WorkspaceChromeProvider>,
    );

    expect(screen.getByText("MAPS")).toBeInTheDocument();
    expect(screen.getByText("INTESIS · CLOUD")).toBeInTheDocument();
    expect(screen.getByText("Office demo")).toBeInTheDocument();
    expect(screen.getByText("KNX ↔ Modbus Master")).toBeInTheDocument();
    expect(screen.getByText("Gateway workspace")).toBeInTheDocument();

    for (const label of [
      "Connection",
      "Overview",
      "Configuration",
      "Modbus devices",
      "Signals",
      "Diagnostics",
      "Deploy",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }

    expect(screen.getByRole("status")).toHaveTextContent(/Demo mode/);
    expect(screen.getByText("No gateway connected")).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("collapses the sidebar to icon-only width", () => {
    render(
      <WorkspaceChromeProvider>
        <AppShell>
          <div>content</div>
        </AppShell>
      </WorkspaceChromeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(screen.queryByText("INTESIS · CLOUD")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Signals" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
    expect(screen.getByText("INTESIS · CLOUD")).toBeInTheDocument();
  });

  it("shows the real session and hides the demo banner when connected", () => {
    mocks.session = {
      id: "s1",
      host: "192.168.100.35",
      port: 23,
      connected: true,
      encrypted: true,
      busy: false,
      connectedAt: "2026-08-19T17:00:00.000Z",
      gateway: {
        name: "Plant room",
        appName: "IN770AIR00SO000",
        appVersion: "1.6.4",
        platform: "INKNXMBM1000000",
        serial: "ABC123",
        ip: "192.168.100.35",
        bootloader: false,
        noApp: false,
      },
    };
    render(
      <WorkspaceChromeProvider>
        <AppShell>
          <div>content</div>
        </AppShell>
      </WorkspaceChromeProvider>,
    );

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getAllByText("192.168.100.35")).toHaveLength(2);
    expect(screen.getByText("Gateway connected")).toBeInTheDocument();
    expect(screen.getByText("Plant room")).toBeInTheDocument();
    expect(screen.getByText("IN770AIR00SO000 · INKNXMBM1000000")).toBeInTheDocument();
    expect(screen.getByText("1.6.4")).toBeInTheDocument();
    expect(screen.getByText("ABC123")).toBeInTheDocument();
    expect(screen.queryByText("Session")).not.toBeInTheDocument();
  });
});
