import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PROJECT_PATCHED_EVENT, type ProjectPatchedDetail } from "./project-events";
import type { ProjectPatchInput, ProjectView } from "./project-types";
import { useWorkspaceChrome, WorkspaceChromeProvider } from "./workspace-chrome";

function UndoProbe() {
  const { undo, pushUndo } = useWorkspaceChrome();
  return (
    <>
      <button onClick={() => pushUndo({ label: "Disable", patches: [{ type: "updateSignal", id: 5, patch: { active: true } }] })}>
        push
      </button>
      <output>{undo?.label ?? "none"}</output>
    </>
  );
}

const knxView = (signals: number) =>
  ({ family: "knx-mbm", project: { signals: Array.from({ length: signals }, (_, id) => ({ id })) } }) as unknown as ProjectView;

function patched(before: number, next: number, patches: ProjectPatchInput[]) {
  const detail: ProjectPatchedDetail = { before: knxView(before), next: knxView(next), patches };
  act(() => {
    window.dispatchEvent(new CustomEvent(PROJECT_PATCHED_EVENT, { detail }));
  });
}

function renderProbe() {
  render(
    <WorkspaceChromeProvider>
      <UndoProbe />
    </WorkspaceChromeProvider>,
  );
  act(() => screen.getByRole("button", { name: "push" }).click());
}

describe("workspace undo", () => {
  it("keeps the undo entry across batches that cannot renumber signal IDs", () => {
    renderProbe();
    patched(8, 9, [{ type: "addSignal" }, { type: "updateSignal", id: 2, patch: { active: false } }]);
    expect(screen.getByRole("status")).toHaveTextContent("Disable");
  });

  it("drops the undo entry after a deletion", () => {
    renderProbe();
    patched(8, 7, [{ type: "removeSignal", id: 2 }]);
    expect(screen.getByRole("status")).toHaveTextContent("none");
  });

  it("drops it even when the batch also adds a signal and the count is unchanged", () => {
    renderProbe();
    patched(8, 8, [{ type: "removeSignal", id: 2 }, { type: "addSignal" }]);
    expect(screen.getByRole("status")).toHaveTextContent("none");
  });
});
