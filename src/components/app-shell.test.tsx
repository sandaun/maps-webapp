import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/connection",
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("AppShell", () => {
  it("renders brand, all 7 nav sections and the demo banner", () => {
    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
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
    expect(screen.getByText("content")).toBeInTheDocument();
  });
});
