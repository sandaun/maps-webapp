import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { projectFromXml, validateProject } from "@/gateway-families/mbs-knx";
import { SYNTHETIC_MBS_KNX_XML } from "@/gateway-families/mbs-knx/fixtures/synthetic-project";
import { familyById } from "@/server/projects/families";
import type { ProjectPatchInput, ProjectView } from "@/lib/project-types";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceChromeProvider } from "@/lib/workspace-chrome";
import { UndoToast } from "@/components/signals/undo-toast";
import { SignalsScreen } from "./signals-screen";

const mocks = vi.hoisted(() => ({
  applyPatches: vi.fn(),
  view: null as ProjectView | null,
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/signals",
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/lib/current-project", () => ({
  useCurrentProject: () => ({
    projectId: mocks.view?.meta.id ?? null,
    loading: false,
    view: mocks.view,
    error: null,
    setProjectId: vi.fn(),
    refresh: vi.fn(),
    applyPatches: mocks.applyPatches,
  }),
  usePatch: () => mocks.applyPatches,
}));

let xml: XmlDocument;

function currentView(): ProjectView {
  const project = projectFromXml(xml);
  return {
    meta: { id: "mk", name: "MBS-KNX", description: "", source: "file", family: "mbs-knx", updatedAt: "2026-01-01T00:00:00.000Z" },
    family: "mbs-knx",
    project,
    issues: validateProject(project),
    hasCompleteBlob: false,
  };
}

/** The signals after the patches the screen sent, applied through the real family registry. */
function applySent(): ReturnType<typeof projectFromXml>["signals"] {
  for (const call of mocks.applyPatches.mock.calls) {
    familyById("mbs-knx").applyPatches(xml, call[0] as ProjectPatchInput[]);
  }
  return projectFromXml(xml).signals;
}

function renderSignals() {
  return render(
    <WorkspaceChromeProvider>
      <TooltipProvider delayDuration={0}>
        <SignalsScreen />
        <UndoToast />
      </TooltipProvider>
    </WorkspaceChromeProvider>,
  );
}

beforeEach(() => {
  xml = XmlDocument.parse(SYNTHETIC_MBS_KNX_XML);
  mocks.view = currentView();
  mocks.applyPatches.mockReset();
  mocks.applyPatches.mockImplementation(async () => currentView());
  mocks.searchParams = new URLSearchParams();
  window.localStorage.clear();
});

describe("SignalsScreen (mbs-knx)", () => {
  it("shows the Modbus side as the BMS band and KNX as the device band", () => {
    renderSignals();
    expect(screen.getByText("MODBUS SLAVE · BMS SIDE")).toBeInTheDocument();
    expect(screen.getByText("KNX TP · DEVICE SIDE")).toBeInTheDocument();
    expect(screen.getByText("Room temperature")).toBeInTheDocument();
    expect(screen.getByText("Float")).toBeInTheDocument();
    expect(screen.getAllByText("Read / Write").length).toBeGreaterThan(0);
    expect(screen.getByText("1/0/1")).toBeInTheDocument();
    // Additional (listening) address of the alarm.
    expect(screen.getByText("1/0/4")).toBeInTheDocument();
  });

  it("sends only the clicked flag and lets the server apply the read/write limits", async () => {
    renderSignals();
    // Signal 1 is Read (mode "write"): R cannot stay on.
    fireEvent.click(screen.getByRole("button", { name: "Flag R signal 1" }));
    await waitFor(() => expect(mocks.applyPatches).toHaveBeenCalledTimes(1));
    expect(mocks.applyPatches.mock.calls[0][0]).toEqual([
      { type: "updateSignal", id: 1, patch: { knx: { flags: { u: true, t: false, ri: false, w: true, r: true } } } },
    ]);
    expect(applySent()[1].knx.flags).toEqual({ u: true, t: false, ri: false, w: true, r: false });
  });

  it("does not apply the KNX–MBM interlocks client-side (Ri on a read/write signal)", async () => {
    renderSignals();
    // Signal 0 has U T W R: the server clears R and keeps U when Ri is set.
    fireEvent.click(screen.getByRole("button", { name: "Flag RI signal 0" }));
    await waitFor(() => expect(mocks.applyPatches).toHaveBeenCalledTimes(1));
    expect(mocks.applyPatches.mock.calls[0][0]).toEqual([
      { type: "updateSignal", id: 0, patch: { knx: { flags: { u: true, t: true, ri: true, w: true, r: true } } } },
    ]);
    expect(applySent()[0].knx.flags).toEqual({ u: true, t: true, ri: true, w: true, r: false });
  });

  it("turns a register into BitFields as MAPS does (16 bits, bit 0)", async () => {
    renderSignals();
    fireEvent.click(screen.getByText("Float"));
    fireEvent.click(screen.getByRole("option", { name: "BitFields" }));
    await waitFor(() => expect(mocks.applyPatches).toHaveBeenCalledTimes(1));
    expect(mocks.applyPatches.mock.calls[0][0]).toEqual([
      { type: "updateSignal", id: 1, patch: { modbus: { format: 4 } } },
    ]);
    expect(applySent()[1].modbus).toMatchObject({ format: 4, lenBits: 16, bit: 0 });
  });

  it("edits additional addresses as a comma-separated list", async () => {
    renderSignals();
    fireEvent.click(screen.getByText("1/0/4"));
    const editor = screen.getByLabelText("Edit Additional addresses signal 2");
    fireEvent.change(editor, { target: { value: "1/0/4, 2/1/9" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    await waitFor(() => expect(mocks.applyPatches).toHaveBeenCalledTimes(1));
    expect(mocks.applyPatches.mock.calls[0][0]).toEqual([
      { type: "updateSignal", id: 2, patch: { knx: { additionalAddresses: [2052, 4361] } } },
    ]);
  });

  it("rejects an invalid additional address without saving", () => {
    renderSignals();
    fireEvent.click(screen.getByText("1/0/4"));
    const editor = screen.getByLabelText("Edit Additional addresses signal 2");
    fireEvent.change(editor, { target: { value: "1/0/4, 20/0/1" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(screen.getByText(/Invalid group address.*20\/0\/1/)).toBeInTheDocument();
    expect(mocks.applyPatches).not.toHaveBeenCalled();
  });

  it("adds a signal with the MAPS defaults", async () => {
    renderSignals();
    fireEvent.click(screen.getByRole("button", { name: /Add signal/ }));
    await waitFor(() => expect(mocks.applyPatches).toHaveBeenCalledTimes(1));
    expect(mocks.applyPatches.mock.calls[0][0]).toEqual([{ type: "addSignal" }]);
    const added = applySent().at(-1)!;
    expect(added).toMatchObject({ active: false, modbus: { lenBits: 16, readWrite: 2 }, knx: { groupAddress: 2055 } });
  });
});
