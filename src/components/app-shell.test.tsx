import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceChromeProvider } from "@/lib/workspace-chrome";
import { AppShell } from "./app-shell";

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

vi.mock("@/lib/gateway-api", () => ({
  listGatewaySessions: vi.fn().mockResolvedValue([]),
}));

afterEach(() => {
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
    expect(screen.getByText("· INTESIS CLOUD")).toBeInTheDocument();

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
    expect(screen.queryByText("· INTESIS CLOUD")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Signals" })).toBeInTheDocument();
  });
});
