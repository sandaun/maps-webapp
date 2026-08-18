import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProjectView } from "@/lib/project-types";
import { ValidationPanel } from "./validation-panel";

const view = {
  issues: [
    {
      code: "W-DUP",
      severity: "warning",
      message: "Duplicate group address",
      ref: { screen: "signals", entity: "signal", id: 3, field: "groupAddress" },
    },
    { code: "E-GA", severity: "error", message: "Group address out of range" },
    { code: "E-NODE", severity: "error", message: "Node limit exceeded" },
    { code: "I-TIP", severity: "info", message: "Consider naming devices" },
  ],
} as unknown as ProjectView;

vi.mock("@/lib/current-project", () => ({
  useCurrentProject: () => ({ view }),
}));

describe("ValidationPanel", () => {
  it("groups issues by severity, errors first", () => {
    render(<ValidationPanel />);

    fireEvent.click(screen.getByRole("button", { name: /validation/i }));

    expect(screen.getByText("errors (2)")).toBeInTheDocument();
    expect(screen.getByText("warnings (1)")).toBeInTheDocument();
    expect(screen.getByText("infos (1)")).toBeInTheDocument();

    const sections = screen.getAllByRole("region");
    expect(sections.map((s) => s.getAttribute("aria-label"))).toEqual([
      "errors",
      "warnings",
      "infos",
    ]);

    // The ref renders as a mono breadcrumb path.
    expect(screen.getByText("signals / signal / 3 / groupAddress")).toBeInTheDocument();
  });

  it("shows the collapsed summary badge without opening the list", () => {
    render(<ValidationPanel />);
    expect(screen.getByRole("button", { name: /validation/i })).toBeInTheDocument();
    expect(screen.queryByText("errors (2)")).not.toBeInTheDocument();
  });
});
