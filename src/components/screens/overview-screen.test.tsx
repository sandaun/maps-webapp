import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OverviewScreen } from "./overview-screen";

vi.mock("@/lib/current-project", () => ({
  useCurrentProject: () => ({
    projectId: null,
    loading: false,
    view: null,
    error: null,
    setProjectId: vi.fn(),
    refresh: vi.fn(),
    applyPatches: vi.fn(),
  }),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listProjects: vi.fn().mockResolvedValue([]),
}));

describe("OverviewScreen", () => {
  it("renders the explicit 'no project' empty state", () => {
    render(<OverviewScreen />);

    expect(screen.getByText("No project loaded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /load demo project/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open \.ibmaps file/i })).toBeInTheDocument();
  });
});
