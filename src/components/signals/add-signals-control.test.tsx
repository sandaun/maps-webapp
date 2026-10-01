import * as React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { projectFromXml } from "@/gateway-families/knx-mbm";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { familyById } from "@/server/projects/families";
import { WorkspaceChromeProvider, useWorkspaceChrome } from "@/lib/workspace-chrome";
import type { ProjectPatchInput, ProjectView } from "@/lib/project-types";
import { AddSignalsControl } from "./add-signals-control";

function setup(ambiguous = false, failure = false) {
  const doc = XmlDocument.parse(SYNTHETIC_KNX_MBM_XML);
  const project = projectFromXml(doc);
  if (ambiguous) project.mbm.rtuNodes[0].devices.push({ ...project.mbm.rtuNodes[0].devices[0], index: 1, name: "Second" });
  const apply = vi.fn(async (patches: ProjectPatchInput[]) => {
    if (failure) throw new Error("Conflict: project changed");
    familyById("knx-mbm").applyPatches(doc, patches);
    return { project: projectFromXml(doc) } as ProjectView;
  });
  const onAdded = vi.fn();
  function UndoProbe() {
    const { undo } = useWorkspaceChrome();
    return <output data-testid="creation-undo">{JSON.stringify(undo)}</output>;
  }
  render(<WorkspaceChromeProvider><AddSignalsControl project={project} selected={new Set([0])} applyPatches={apply} onAdded={onAdded} /><UndoProbe /></WorkspaceChromeProvider>);
  return { apply, onAdded };
}

describe("add signal controls", () => {
  it("adds one complete signal directly without opening a dialog", async () => {
    const { apply, onAdded } = setup();
    fireEvent.click(screen.getByRole("button", { name: "+ Add signal" }));
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(apply).toHaveBeenCalledExactlyOnceWith([{ type: "addSignals", options: { count: 1, device: { port: 0, deviceIndex: 0 } } }]);
    expect(JSON.parse(screen.getByTestId("creation-undo").textContent!).patches).toHaveLength(1);
  });

  it("previews a batch and inserts it after the selection with a single undo", async () => {
    const { apply, onAdded } = setup();
    fireEvent.click(screen.getByRole("button", { name: "More signal actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Add multiple signals…" }));
    const dialog = screen.getByRole("dialog", { name: "Add signals" });
    fireEvent.change(within(dialog).getByLabelText("Quantity"), { target: { value: "3" } });
    fireEvent.click(within(dialog).getByLabelText("Position"));
    fireEvent.click(screen.getByRole("option", { name: "After signal 0" }));
    fireEvent.click(within(dialog).getByLabelText("Signal type"));
    fireEvent.click(screen.getByRole("option", { name: /Unsigned 32-bit/ }));
    expect(within(dialog).getByRole("status")).toHaveTextContent("3 signals");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add 3 signals" }));
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(1, 1));
    expect(apply.mock.calls[0][0]).toEqual([{ type: "addSignals", options: { count: 3, afterId: 0, device: { port: 0, deviceIndex: 0 }, profile: "unsigned32", active: true } }]);
    expect(JSON.parse(screen.getByTestId("creation-undo").textContent!).patches).toEqual([1, 2, 3].map((id) => ({ type: "removeSignal", id })));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("blocks an occupied KNX address before submitting", () => {
    const { apply } = setup();
    fireEvent.click(screen.getByRole("button", { name: "More signal actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Add multiple signals…" }));
    fireEvent.change(screen.getByLabelText("Starting KNX address"), { target: { value: "1/0/3" } });
    expect(screen.getByRole("alert")).toHaveTextContent("already used");
    expect(screen.getByRole("button", { name: "Add 1 signal" })).toBeDisabled();
    expect(apply).not.toHaveBeenCalled();
  });

  it("keeps failed creation reviewable without recording undo", async () => {
    const { onAdded } = setup(false, true);
    fireEvent.click(screen.getByRole("button", { name: "+ Add signal" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("project changed"));
    expect(screen.getByTestId("creation-undo")).toHaveTextContent("null");
    expect(onAdded).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "+ Add signal" })).toBeEnabled();
  });
});
