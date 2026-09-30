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
import { useSignalSelection } from "@/components/screens/use-signal-selection";

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
    passwordValid: false, mapsVersion: "1.2.34.0", hasCompleteBlob: false,
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
  const selection = useSignalSelection(view?.project.signals.map((signal) => signal.id) ?? []);
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
      <button onClick={() => void run([{ type: "moveSignal", id: 0, toIndex: 4 }])}>move</button>
      <button onClick={() => void run([{ type: "moveSignal", id: 0, count: 2, toIndex: 1 }])}>move block</button>
      <button onClick={() => void run([{ type: "moveSignal", id: 1, count: 2, toIndex: 0 }])}>undo block</button>
      <button onClick={() => void run([{ type: "moveSignal", id: 0, count: 2, toIndex: 0 }])}>same position</button>
      <button onClick={() => selection.toggle(0)}>select</button>
      <button onClick={() => selection.selectMany([0, 1])}>select block</button>
      <p data-testid="selection">{[...selection.selected].join(",")}</p>
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
  it("remaps selected IDs after moving a signal", async () => {
    await renderWithUndo();
    fireEvent.click(screen.getByRole("button", { name: "select" }));
    expect(screen.getByTestId("selection")).toHaveTextContent("0");
    fireEvent.click(screen.getByRole("button", { name: "move" }));
    await waitFor(() => expect(screen.getByTestId("revision")).toHaveTextContent("3"));
    expect(screen.getByTestId("selection")).toHaveTextContent("4");
    expect(screen.getByTestId("undo")).toHaveTextContent("none");
    expect(projectFromXml(doc).signals[4].description).toBe("signal 0");
  });

  it("keeps the selection on the moved block and restores it on undo", async () => {
    await renderWithUndo();
    fireEvent.click(screen.getByRole("button", { name: "select block" }));
    fireEvent.click(screen.getByRole("button", { name: "move block" }));
    await waitFor(() => expect(screen.getByTestId("selection")).toHaveTextContent("1,2"));
    fireEvent.click(screen.getByRole("button", { name: "undo block" }));
    await waitFor(() => expect(screen.getByTestId("selection")).toHaveTextContent("0,1"));
    expect(projectFromXml(doc).signals.slice(0, 2).map((signal) => signal.description)).toEqual(["signal 0", "signal 1"]);
  });

  it("does not invalidate undo or selection when a move returns the same revision", async () => {
    await renderWithUndo();
    mocks.patch.mockImplementationOnce(async (id: string) => serverView(id));
    fireEvent.click(screen.getByRole("button", { name: "select block" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "same position" })));
    expect(screen.getByTestId("undo")).toHaveTextContent("Disable signal 3");
    expect(screen.getByTestId("selection")).toHaveTextContent("0,1");
  });

  it.each(["rename", "move"])("prevents a move from overlapping a pending %s", async (first) => {
    await renderWithUndo();
    const callsBefore = mocks.patch.mock.calls.length;
    let finish!: (view: ProjectView) => void;
    mocks.patch.mockImplementationOnce(() => new Promise<ProjectView>((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: first }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledTimes(callsBefore + 1));
    fireEvent.click(screen.getByRole("button", { name: first === "move" ? "rename" : "move" }));
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("Wait for the current change"));
    expect(mocks.patch).toHaveBeenCalledTimes(callsBefore + 1);
    await act(async () => finish(serverView("demo")));
    fireEvent.click(screen.getByRole("button", { name: "move" }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledTimes(callsBefore + 2));
  });

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
