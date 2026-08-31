import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportExportView } from "./import-export-view";

const mocks = vi.hoisted(() => ({
  listProjectHistory: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  exportProjectUrl: (projectId: string) => `/api/projects/${projectId}/export`,
  importSignalsXlsx: vi.fn(),
  listProjectHistory: mocks.listProjectHistory,
  restoreProjectHistory: vi.fn(),
}));

beforeEach(() => {
  mocks.listProjectHistory.mockReset();
});

describe("ImportExportView", () => {
  it("shows four recent history entries before expanding older versions", async () => {
    mocks.listProjectHistory.mockResolvedValue(
      Array.from({ length: 6 }, (_, index) => ({
        id: `version-${index}`,
        at: `2026-08-${String(23 - index).padStart(2, "0")}T12:00:00.000Z`,
        tag: index === 0 ? "draft" : `v${6 - index}`,
        text: `History entry ${index + 1}`,
        who: "local",
      })),
    );

    render(
      <ImportExportView
        family="knx-mbm"
        projectId="project-1"
        projectName="Test project"
        signalCount={12}
        onImported={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("History entry 1")).toBeInTheDocument());
    expect(screen.getByText("History entry 4")).toBeInTheDocument();
    expect(screen.queryByText("History entry 5")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show 2 older versions" }));
    expect(screen.getByText("History entry 5")).toBeInTheDocument();
    expect(screen.getByText("History entry 6")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show recent only" }));
    expect(screen.queryByText("History entry 5")).not.toBeInTheDocument();
  });
});
