import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { projectFromXml } from "@/gateway-families/knx-mbm";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { familyById } from "@/server/projects/families";
import { ApiError } from "./api";
import { CurrentProjectProvider, useCurrentProject } from "./current-project";
import type { ProjectPatchInput, ProjectView } from "./project-types";
import { useWorkspaceChrome, WorkspaceChromeProvider } from "./workspace-chrome";

const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  getProjectView: mocks.get,
  patchProject: mocks.patch,
}));

const knx = familyById("knx-mbm");
let doc: XmlDocument;
let revision: number;

function serverView(id: string): ProjectView {
  return {
    family: "knx-mbm",
    meta: { id, family: "knx-mbm", name: "P", description: "", source: "demo", updatedAt: "", revision },
    project: projectFromXml(doc),
    issues: [],
    hasCompleteBlob: false,
  };
}

/** Another tab writing through the same API (the server renumbers signal IDs). */
function otherTab(patches: ProjectPatchInput[]) {
  knx.applyPatches(doc, patches);
  revision++;
}

beforeEach(() => {
  localStorage.clear();
  doc = XmlDocument.parse(SYNTHETIC_KNX_MBM_XML);
  knx.applyPatches(doc, [
    { type: "addSignal" },
    { type: "addSignal" },
    { type: "addSignal" },
    ...[0, 1, 2, 3, 4].map((id): ProjectPatchInput => ({ type: "updateSignal", id, patch: { description: `signal ${id}` } })),
  ]);
  revision = 1;
  mocks.get.mockReset().mockImplementation(async (id: string) => serverView(id));
  mocks.patch.mockReset().mockImplementation(async (id: string, patches: ProjectPatchInput[], expected?: number) => {
    if (expected !== undefined && expected !== revision) {
      throw new ApiError(409, "Changed elsewhere", "revision-conflict");
    }
    knx.applyPatches(doc, patches);
    revision++;
    return serverView(id);
  });
});

function Probe() {
  const { view, applyPatches, refresh, setProjectId } = useCurrentProject();
  const { undo, pushUndo } = useWorkspaceChrome();
  const [error, setError] = React.useState("");
  const run = (patches: ProjectPatchInput[]) =>
    applyPatches(patches).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  return (
    <>
      <button
        onClick={async () => {
          await applyPatches([{ type: "updateSignal", id: 3, patch: { active: false } }]);
          pushUndo({ label: "Disable signal 3", patches: [{ type: "updateSignal", id: 3, patch: { active: true } }] });
        }}
      >
        disable
      </button>
      <button onClick={() => void run([{ type: "setGeneralInfo", name: "Renamed" }])}>rename</button>
      <button onClick={() => void refresh()}>refresh</button>
      <button onClick={() => setProjectId("other")}>switch</button>
      <button onClick={() => setProjectId("demo")}>reselect</button>
      <p data-testid="undo">{undo?.label ?? "none"}</p>
      <p data-testid="error">{error}</p>
      <p data-testid="revision">{view?.meta.revision ?? "-"}</p>
    </>
  );
}

async function renderWithUndo() {
  render(
    <CurrentProjectProvider>
      <WorkspaceChromeProvider>
        <Probe />
      </WorkspaceChromeProvider>
    </CurrentProjectProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("revision")).toHaveTextContent("1"));
  fireEvent.click(screen.getByRole("button", { name: "disable" }));
  await waitFor(() => expect(screen.getByTestId("undo")).toHaveTextContent("Disable signal 3"));
}

describe("undo across external revisions", () => {
  it("drops the undo entry when a 409 reveals that another tab renumbered the signals", async () => {
    await renderWithUndo();
    otherTab([{ type: "removeSignal", id: 1 }]);
    // Signal 3 of the undo entry is now a different signal on the server.
    expect(projectFromXml(doc).signals[3].description).toBe("signal 4");
    fireEvent.click(screen.getByRole("button", { name: "rename" }));
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("has been reloaded"));
    expect(screen.getByTestId("undo")).toHaveTextContent("none");
    expect(screen.getByTestId("revision")).toHaveTextContent("3");
  });

  it("does not claim a reload that failed", async () => {
    await renderWithUndo();
    otherTab([{ type: "removeSignal", id: 1 }]);
    mocks.get.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "rename" }));
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("could not be reloaded"));
    expect(screen.getByTestId("error")).not.toHaveTextContent("has been reloaded");
    expect(screen.getByTestId("undo")).toHaveTextContent("none");
  });

  it("drops it when a reload brings a revision written elsewhere", async () => {
    await renderWithUndo();
    otherTab([{ type: "setGeneralInfo", name: "Elsewhere" }]);
    fireEvent.click(screen.getByRole("button", { name: "refresh" }));
    await waitFor(() => expect(screen.getByTestId("undo")).toHaveTextContent("none"));
  });

  it("keeps it across a reload that finds nothing new", async () => {
    await renderWithUndo();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "refresh" })));
    expect(screen.getByTestId("undo")).toHaveTextContent("Disable signal 3");
  });

  it("drops it when another project is selected", async () => {
    await renderWithUndo();
    fireEvent.click(screen.getByRole("button", { name: "switch" }));
    await waitFor(() => expect(screen.getByTestId("undo")).toHaveTextContent("none"));
  });

  it("reloads the open project when it is selected again after being replaced", async () => {
    await renderWithUndo();
    // The same project id re-opened elsewhere (e.g. loading the demo again).
    otherTab([{ type: "setGeneralInfo", name: "Re-opened" }]);
    fireEvent.click(screen.getByRole("button", { name: "reselect" }));
    await waitFor(() => expect(screen.getByTestId("revision")).toHaveTextContent("3"));
    expect(screen.getByTestId("undo")).toHaveTextContent("none");
    // The next edit is based on the reloaded revision: no conflict.
    fireEvent.click(screen.getByRole("button", { name: "rename" }));
    await waitFor(() => expect(screen.getByTestId("revision")).toHaveTextContent("4"));
    expect(screen.getByTestId("error")).toHaveTextContent("");
  });
});
