import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportExportView } from "./import-export-view";

const mocks = vi.hoisted(() => ({
  listProjectHistory: vi.fn(),
  importSignalsXlsx: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  exportProjectUrl: (projectId: string) => `/api/projects/${projectId}/export`,
  importSignalsXlsx: mocks.importSignalsXlsx,
  listProjectHistory: mocks.listProjectHistory,
  restoreProjectHistory: vi.fn(),
  signalsXlsxUrl: (projectId: string, mapsVersion: string) => `/api/projects/${projectId}/export/xlsx?mapsVersion=${mapsVersion}`,
}));

beforeEach(() => {
  mocks.listProjectHistory.mockReset();
  mocks.listProjectHistory.mockResolvedValue([]);
  mocks.importSignalsXlsx.mockReset();
  mocks.importSignalsXlsx.mockResolvedValue({});
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
        mapsVersion="1.2.34.0"
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

  it("exports the signal table for the target MAPS version, the project's by default", () => {
    render(
      <ImportExportView
        family="mbs-knx"
        projectId="p"
        projectName="P"
        signalCount={3}
        mapsVersion="1.2.31.0"
        onImported={vi.fn()}
      />,
    );
    const link = () => screen.getByText("Signal table").closest("a")!;
    expect(link()).toHaveAttribute("href", "/api/projects/p/export/xlsx?mapsVersion=1.2.31.0");
    const input = screen.getByLabelText(/Target MAPS version/);
    fireEvent.change(input, { target: { value: "1.2.34.0" } });
    expect(link()).toHaveAttribute("href", "/api/projects/p/export/xlsx?mapsVersion=1.2.34.0");
    fireEvent.change(input, { target: { value: "1.2.34" } });
    expect(link()).not.toHaveAttribute("href");
    expect(link()).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Use four numbers, such as 1.2.34.0.")).toBeInTheDocument();
  });

  it("imports an MBS–KNX table adding or replacing signals, like MAPS", async () => {
    render(
      <ImportExportView
        family="mbs-knx"
        projectId="p"
        projectName="P"
        signalCount={3}
        mapsVersion="1.2.34.0"
        onImported={vi.fn()}
      />,
    );
    const file = new File(["x"], "signals.xlsx");
    fireEvent.click(screen.getByLabelText("Replace signals"));
    fireEvent.change(screen.getByLabelText("Import XLSX"), { target: { files: [file] } });
    await waitFor(() => expect(mocks.importSignalsXlsx).toHaveBeenCalledWith("p", file, "replace"));
  });

  it("offers Replace signals only where it is available", () => {
    render(
      <ImportExportView
        family="me-mbs"
        projectId="p"
        projectName="P"
        signalCount={3}
        mapsVersion="1.2.34.0"
        onImported={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Replace signals")).not.toBeInTheDocument();
  });
});
