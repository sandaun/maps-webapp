import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectMeta, ProjectView } from "@/lib/project-types";
import { ProjectsScreen } from "./projects-screen";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), view: vi.fn(), remove: vi.fn(), setProjectId: vi.fn(), push: vi.fn(),
  projectId: "keep" as string | null,
  session: null as { id: string; projectId?: string } | null,
}));

vi.mock("@/lib/api", () => ({
  listProjects: mocks.list,
  getProjectView: mocks.view,
  deleteProject: mocks.remove,
}));
vi.mock("@/lib/gateway-api", () => ({ receiveGatewayProject: vi.fn() }));
vi.mock("@/lib/current-project", () => ({
  useCurrentProject: () => ({ projectId: mocks.projectId, setProjectId: mocks.setProjectId }),
}));
vi.mock("@/lib/gateway-session", () => ({ useGatewaySession: () => ({ session: mocks.session }) }));
vi.mock("@/lib/workspace-chrome", () => ({ useWorkspaceChrome: () => ({ dirtyCount: 0 }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));

const projects: ProjectMeta[] = [
  { id: "keep", family: "knx-mbm", name: "Keep me", source: "file", updatedAt: "2026-09-29T10:00:00Z" },
  { id: "remove", family: "me-mbs", name: "Remove me", source: "file", updatedAt: "2026-09-28T10:00:00Z" },
] as ProjectMeta[];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.projectId = "keep";
  mocks.session = null;
  mocks.list.mockResolvedValue(projects);
  mocks.view.mockImplementation(async (id: string) => ({
    meta: projects.find((project) => project.id === id), project: { signals: [] },
    family: "knx-mbm", issues: [], hasCompleteBlob: false, passwordValid: false, mapsVersion: "1.2.34.0",
  } as unknown as ProjectView));
  mocks.remove.mockResolvedValue(undefined);
});

describe("ProjectsScreen deletion", () => {
  it("keeps open and delete as separate actions, confirms and refreshes the list", async () => {
    render(<ProjectsScreen />);
    const deleteButton = await screen.findByRole("button", { name: "Delete project Remove me" });
    fireEvent.click(deleteButton);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Delete “Remove me”?" })).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("remove"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Delete project Remove me" })).not.toBeInTheDocument());
    expect(mocks.setProjectId).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Open project Keep me" })).toBeInTheDocument();
  });

  it("explains why the selected project cannot be deleted during a gateway session", async () => {
    mocks.session = { id: "session", projectId: "keep" };
    render(<ProjectsScreen />);
    const button = await screen.findByRole("button", { name: "Delete project Keep me" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(screen.getByRole("alert")).toHaveTextContent("open in a gateway session");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("keeps the confirmation open with the server rejection reason", async () => {
    mocks.remove.mockRejectedValue(new Error("This project is being uploaded. Wait for the upload to finish."));
    render(<ProjectsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete project Remove me" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("being uploaded");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("clears the current selection after deleting that project without a gateway session", async () => {
    render(<ProjectsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete project Keep me" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    await waitFor(() => expect(mocks.setProjectId).toHaveBeenCalledWith(null));
    expect(screen.getByRole("button", { name: "Open project Remove me" })).toBeInTheDocument();
  });
});
