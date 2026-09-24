import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { projectFromXml as readKnx } from "@/gateway-families/knx-mbm";
import { projectFromXml as readMe } from "@/gateway-families/me-mbs";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { SYNTHETIC_ME_MBS_XML } from "@/gateway-families/me-mbs/fixtures/synthetic-project";
import { familyById } from "@/server/projects/families";
import {
  CurrentProjectProvider,
  useCurrentProject,
} from "@/lib/current-project";
import { PropertyDraftProvider } from "@/lib/property-drafts";
import { ApiError } from "@/lib/api";
import type {
  FamilyId,
  ProjectView,
  ProjectPatchInput,
} from "@/lib/project-types";
import { ConfigurationScreen } from "./configuration-screen";
import { DevicesScreen } from "./devices-screen";

const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  getProjectView: mocks.get,
  patchProject: mocks.patch,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

let xml: XmlDocument;
let family: FamilyId;
/** Mirrors the server write counter: bumped by every applied batch. */
let revision: number;
function currentView(id = "demo"): ProjectView {
  const meta = {
    id,
    family,
    name: "Project",
    description: "",
    source: "demo" as const,
    updatedAt: String(Date.now()),
    revision,
  };
  return family === "knx-mbm"
    ? {
        family,
        meta,
        project: readKnx(xml),
        issues: [],
        hasCompleteBlob: false,
      }
    : {
        family,
        meta,
        project: readMe(xml),
        issues: [],
        hasCompleteBlob: false,
      };
}
function setup(nextFamily: FamilyId = "knx-mbm") {
  family = nextFamily;
  xml = XmlDocument.parse(
    family === "knx-mbm" ? SYNTHETIC_KNX_MBM_XML : SYNTHETIC_ME_MBS_XML,
  );
  revision = 1;
  mocks.get.mockImplementation(async (id: string) => currentView(id));
  mocks.patch.mockImplementation(
    async (id: string, patches: ProjectPatchInput[], expected?: number) => {
      // Same optimistic-concurrency guard as the real API (If-Match).
      if (expected !== undefined && expected !== revision)
        throw new ApiError(409, "Changed elsewhere", "revision-conflict");
      familyById(family).applyPatches(xml, patches);
      revision++;
      return currentView(id);
    },
  );
}
function ProjectSwitcher() {
  const current = useCurrentProject();
  return (
    <button onClick={() => current.setProjectId("other")}>
      Switch project
    </button>
  );
}
function Workspace({ devices = false }: { devices?: boolean }) {
  return (
    <CurrentProjectProvider>
      <PropertyDraftProvider>
        <ProjectSwitcher />
        {/* Same focus target as the app shell's <main>. */}
        <main id="main-content" tabIndex={-1}>
          {devices ? <DevicesScreen /> : <ConfigurationScreen />}
        </main>
      </PropertyDraftProvider>
    </CurrentProjectProvider>
  );
}
beforeEach(() => {
  localStorage.clear();
  mocks.get.mockReset();
  mocks.patch.mockReset();
  setup();
});

describe("V12 property saving", () => {
  it("shows one shared bar across sections, highlights fields and saves a single batch", async () => {
    render(<Workspace />);
    const name = await screen.findByRole("textbox", { name: "Project name" });
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).toBeNull();
    fireEvent.change(name, { target: { value: "Shared draft" } });
    expect(name).toHaveClass("border-hms-accent", "bg-[#F4FAFE]");
    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Network & time" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Gateway name" }), {
      target: { value: "Gateway draft" },
    });
    expect(screen.getByText("2 unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.queryByText("2 unsaved changes")).toBeNull(),
    );
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(mocks.patch.mock.calls[0][1]).toEqual([
      { type: "setGeneralInfo", name: "Shared draft" },
      { type: "setGatewayInfo", name: "Gateway draft" },
    ]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "2 changes saved to the project",
    );
    expect(
      screen.getByRole("textbox", { name: "Gateway name" }),
    ).toBeInTheDocument();
  });

  it("persists before a reload, restores automatically, and Discard restores saved values", async () => {
    const base = currentView().project.name;
    const app = render(<Workspace />);
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Project name" }),
      { target: { value: "Survives reload" } },
    );
    app.unmount();
    render(<Workspace />);
    expect(
      await screen.findByRole("textbox", { name: "Project name" }),
    ).toHaveValue("Survives reload");
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 unsaved change recovered",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Discard" }),
    );
    expect(screen.getByRole("textbox", { name: "Project name" })).toHaveValue(
      base,
    );
    expect(screen.queryByText("1 unsaved change")).toBeNull();
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it("limits the summary to three labels and removes an individually reverted property", async () => {
    render(<Workspace />);
    const original = currentView().project.name;
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Project name" }),
      { target: { value: "Pending name" } },
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Description" }),
      { target: { value: "Pending description" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Network & time" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Gateway name" }), {
      target: { value: "New gateway" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "IP address" }), {
      target: { value: "192.168.1.99" },
    });
    expect(screen.getByText("4 unsaved changes")).toBeInTheDocument();
    expect(
      screen.getByText("Project name · Description · Gateway name + 1 more"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "General" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), {
      target: { value: original },
    });
    expect(screen.getByText("3 unsaved changes")).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Project name" }),
    ).not.toHaveClass("bg-[#F4FAFE]");
  });

  it("reports an immediate toggle failure without creating a save bar", async () => {
    render(<Workspace />);
    await screen.findByRole("textbox", { name: "Project name" });
    fireEvent.click(screen.getByRole("button", { name: "Network & time" }));
    const previous = currentView().project.gateway.dhcp;
    mocks.patch.mockRejectedValueOnce(
      new Error("Gateway property could not be stored"),
    );
    fireEvent.click(screen.getByRole("switch", { name: "DHCP" }));
    await screen.findByText("Gateway property could not be stored");
    expect(screen.getByRole("switch", { name: "DHCP" })).toHaveAttribute(
      "aria-checked",
      String(previous),
    );
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).toBeNull();
  });

  it("applies toggles immediately without resetting the section or other drafts", async () => {
    render(<Workspace />);
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Project name" }),
      { target: { value: "Keep pending" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Network & time" }));
    const before = currentView().project.gateway.dhcp;
    fireEvent.click(screen.getByRole("switch", { name: "DHCP" }));
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith(
        "demo",
        [{ type: "setGatewayInfo", dhcp: !before }],
        1,
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "DHCP" })).not.toHaveAttribute("aria-disabled"),
    );
    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "General" }),
    );
    expect(screen.getByRole("textbox", { name: "Project name" })).toHaveValue(
      "Keep pending",
    );
  });

  it("retains edits after an error, prevents duplicate saves, and retries", async () => {
    render(<Workspace />);
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Project name" }),
      { target: { value: "Retry this" } },
    );
    let reject!: (error: Error) => void;
    mocks.patch.mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Saving 1 change…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saving…" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Discard" })).toHaveAttribute("aria-disabled", "true");
    await act(async () => reject(new Error("Connection lost")));
    expect(await screen.findByRole("button", { name: "Retry" })).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("textbox", { name: "Project name" })).toHaveValue(
      "Retry this",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("1 change saved to the project");
    expect(mocks.patch).toHaveBeenCalledTimes(2);
  });

  it("validates an unmounted section before sending any patches", async () => {
    render(<Workspace />);
    await screen.findByRole("textbox", { name: "Project name" });
    fireEvent.click(screen.getByRole("button", { name: "BMS · KNX" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Physical address" }),
      { target: { value: "99.99.999" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "General" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByRole("textbox", { name: "Physical address" }),
    ).toHaveAttribute("aria-invalid", "true");
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it("finds recovery conflicts, shows the current value and requires an explicit decision", async () => {
    const app = render(<Workspace />);
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Project name" }),
      { target: { value: "Mine" } },
    );
    app.unmount();
    familyById(family).applyPatches(xml, [
      { type: "setGeneralInfo", name: "Changed elsewhere" },
    ]);
    revision++;
    render(<Workspace />);
    await screen.findByRole("button", { name: "Keep my edit" });
    expect(screen.getByText(/Saved: Changed elsewhere/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save" }),
    ).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "Use saved value" }));
    expect(screen.getByRole("textbox", { name: "Project name" })).toHaveValue(
      "Changed elsewhere",
    );
  });

  it("keeps ME controller edits when navigating to a group and enforces model dependencies", async () => {
    setup("me-mbs");
    familyById(family).applyPatches(xml, [
      { type: "updateController", controllerIndex: 0, patch: { model: 2, compatibility: 0 } },
    ]);
    render(<Workspace devices />);
    const first = await screen.findByRole("textbox", {
      name: "Controller 1 · Description",
    });
    fireEvent.change(first, { target: { value: "Edited controller" } });
    const model = screen.getByRole("combobox", {
      name: "Controller 1 · Model",
    });
    fireEvent.change(model, { target: { value: "0" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Select controller 1 group 1",
      }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Controller 1 · G1 · Description" }),
      { target: { value: "Another unit" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Save" }),
      ).toBeNull(),
    );
    const patches = mocks.patch.mock.calls[0][1] as ProjectPatchInput[];
    expect(patches).toContainEqual(
      expect.objectContaining({
        type: "updateController",
        controllerIndex: 0,
        patch: expect.objectContaining({
          description: "Edited controller",
          model: 0,
          compatibility: 1,
        }),
      }),
    );
    expect(patches).toContainEqual({
      type: "updateGroup",
      controllerIndex: 0,
      groupIndex: 0,
      patch: { description: "Another unit" },
    });
  });

  it("uses one Devices bar for KNX nodes and device rows, with no row Save buttons", async () => {
    render(<Workspace devices />);
    await screen.findByRole("combobox", { name: "RTU node 1 · Baudrate" });
    expect(screen.queryByRole("button", { name: "Save node" })).toBeNull();
    fireEvent.change(
      screen.getByRole("combobox", { name: "RTU node 1 · Baudrate" }),
      { target: { value: "19200" } },
    );
    const name = screen.getAllByRole("textbox", { name: "Device name" })[0];
    fireEvent.change(name, { target: { value: "Meter draft" } });
    expect(screen.getByText("2 unsaved changes")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Save" }),
    ).toHaveLength(1);
    const row = name.closest("tr")!;
    fireEvent.click(within(row).getByRole("checkbox", { name: "Enabled" }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledTimes(1));
    expect(
      (mocks.patch.mock.calls[0][1] as ProjectPatchInput[])[0],
    ).toMatchObject({ type: "updateDevice", patch: { enabled: false } });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save" }),
      ).not.toHaveAttribute("aria-disabled"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("2 changes saved to the project");
  });

  it("asks what to do with a removed device's signals and keeps later device drafts on their device", async () => {
    familyById("knx-mbm").applyPatches(xml, [{ type: "addDevice", locator: { kind: "rtu", nodeIndex: 0 } }]);
    render(<Workspace devices />);
    const names = await screen.findAllByRole("textbox", { name: "Device name" });
    fireEvent.change(names[1], { target: { value: "Second device draft" } });
    fireEvent.click(within(names[0].closest("tr")!).getByRole("button", { name: "Remove" }));
    const dialog = screen.getByRole("dialog", { name: "Remove device 0" });
    expect(dialog).toHaveTextContent("2 signals use this device");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Delete only the device/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove device" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.patch.mock.calls[0][1]).toEqual([
      { type: "removeDevice", locator: { kind: "rtu", nodeIndex: 0 }, deviceIndex: 0, signals: "unassign" },
    ]);
    const remaining = screen.getAllByRole("textbox", { name: "Device name" });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toHaveValue("Second device draft");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("1 change saved to the project");
    expect(mocks.patch.mock.calls[1][1]).toEqual([
      { type: "updateDevice", locator: { kind: "rtu", nodeIndex: 0 }, deviceIndex: 0, patch: { name: "Second device draft" } },
    ]);
  });

  describe("mutations never lock the whole screen", () => {
    /** Holds the next patch until `release` is called. */
    function holdNextPatch() {
      let release!: () => void;
      const original = mocks.patch.getMockImplementation()!;
      mocks.patch.mockImplementationOnce(
        (...args: Parameters<typeof original>) =>
          new Promise((resolve) => {
            release = () => resolve(original(...args));
          }),
      );
      return () => act(async () => release());
    }

    it("keeps keyboard focus on a switch while its own value is saved", async () => {
      render(<Workspace />);
      await screen.findByRole("textbox", { name: "Project name" });
      fireEvent.click(screen.getByRole("button", { name: "Network & time" }));
      const dhcp = screen.getByRole("switch", { name: "DHCP" });
      dhcp.focus();
      const release = holdNextPatch();
      fireEvent.click(dhcp);
      await waitFor(() => expect(dhcp).toHaveAttribute("aria-busy", "true"));
      // Browsers drop focus from a control that becomes `disabled` (jsdom does
      // not), so a busy control must only be aria-disabled.
      expect(dhcp).not.toBeDisabled();
      expect(dhcp).toHaveAttribute("aria-disabled", "true");
      expect(document.activeElement).toBe(dhcp);
      // Other fields, the section rail and the search stay usable meanwhile.
      const name = screen.getByRole("textbox", { name: "Gateway name" });
      expect(name).toBeEnabled();
      fireEvent.change(name, { target: { value: "Typed while saving" } });
      expect(screen.getByRole("button", { name: "General" })).toBeEnabled();
      expect(screen.getByRole("textbox", { name: /search/i })).toBeEnabled();
      await release();
      await waitFor(() => expect(dhcp).not.toHaveAttribute("aria-busy"));
      expect(document.activeElement).toBe(dhcp);
      expect(screen.getByText("1 unsaved change")).toBeInTheDocument();
    });

    it("keeps focus on Save while it saves", async () => {
      render(<Workspace />);
      fireEvent.change(await screen.findByRole("textbox", { name: "Project name" }), {
        target: { value: "Focus stays" },
      });
      const release = holdNextPatch();
      const save = screen.getByRole("button", { name: "Save" });
      save.focus();
      fireEvent.click(save);
      await screen.findByRole("button", { name: "Saving…" });
      expect(save).not.toBeDisabled();
      expect(save).toHaveAttribute("aria-disabled", "true");
      expect(document.activeElement).toBe(save);
      await release();
      await screen.findByText("1 change saved to the project");
    });

    it("holds structural actions of the project while a Save is in flight", async () => {
      render(<Workspace devices />);
      fireEvent.change(await screen.findByRole("combobox", { name: "RTU node 1 · Baudrate" }), {
        target: { value: "19200" },
      });
      const release = holdNextPatch();
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await screen.findByRole("button", { name: "Saving…" });
      expect(screen.getByRole("button", { name: "Add device" })).toBeDisabled();
      expect(screen.getAllByRole("button", { name: "Add node" })[0]).toBeDisabled();
      await release();
      await waitFor(() => expect(screen.getByRole("button", { name: "Add device" })).toBeEnabled());
    });
  });

  describe("bar details", () => {
    it("is a labelled region and returns focus to the content when Discard closes it", async () => {
      render(<Workspace />);
      fireEvent.change(await screen.findByRole("textbox", { name: "Project name" }), {
        target: { value: "Going away" },
      });
      expect(screen.getByRole("region", { name: "Pending property changes" })).toBeInTheDocument();
      const discard = screen.getByRole("button", { name: "Discard" });
      discard.focus();
      fireEvent.click(discard);
      expect(screen.queryByRole("region", { name: "Pending property changes" })).toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(document.getElementById("main-content")));
    });

    it("returns focus to the content after a successful Save, but not after a failed one", async () => {
      render(<Workspace />);
      fireEvent.change(await screen.findByRole("textbox", { name: "Project name" }), {
        target: { value: "Saved soon" },
      });
      mocks.patch.mockRejectedValueOnce(new Error("Connection lost"));
      const save = screen.getByRole("button", { name: "Save" });
      save.focus();
      fireEvent.click(save);
      const retry = await screen.findByRole("button", { name: "Retry" });
      expect(document.activeElement).toBe(retry);
      fireEvent.click(retry);
      await screen.findByText("1 change saved to the project");
      await waitFor(() => expect(document.activeElement).toBe(document.getElementById("main-content")));
    });

    it("shows conflicting values with the labels the form uses", async () => {
      setup("me-mbs");
      const app = render(<Workspace />);
      await screen.findByRole("textbox", { name: "Project name" });
      fireEvent.click(screen.getByRole("button", { name: "BMS · Modbus server" }));
      fireEvent.change(screen.getByRole("combobox", { name: "Parity" }), { target: { value: "2" } });
      app.unmount();
      familyById(family).applyPatches(xml, [{ type: "updateRtuConfig", patch: { parity: 1 } }]);
      revision++;
      render(<Workspace />);
      expect(await screen.findByText(/Saved: Odd/)).toHaveTextContent("Saved: Odd · Pending: Even");
    });

    it("keeps other fields' validation messages while one of them is corrected", async () => {
      render(<Workspace />);
      await screen.findByRole("textbox", { name: "Project name" });
      fireEvent.click(screen.getByRole("button", { name: "Network & time" }));
      fireEvent.change(screen.getByRole("textbox", { name: "Gateway name" }), { target: { value: "x".repeat(40) } });
      fireEvent.change(screen.getByRole("textbox", { name: "IP address" }), { target: { value: "y".repeat(50) } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findAllByText(/Maximum \d+ characters/)).toHaveLength(2);
      fireEvent.change(screen.getByRole("textbox", { name: "Gateway name" }), { target: { value: "Fine" } });
      expect(screen.getAllByText(/Maximum \d+ characters/)).toHaveLength(1);
      expect(screen.getByText(/Check the highlighted properties/)).toBeInTheDocument();
    });

    it("shows unreadable recovery data even when nothing could be recovered", async () => {
      localStorage.setItem("maps.propertyDrafts.v1:demo", "{not json");
      render(<Workspace />);
      await screen.findByRole("textbox", { name: "Project name" });
      expect(screen.queryByRole("region", { name: "Pending property changes" })).toBeNull();
      expect(screen.getByRole("alert")).toHaveTextContent(/could not be read and were ignored/);
      fireEvent.click(screen.getByRole("button", { name: "Dismiss recovery warning" }));
      expect(screen.queryByText(/could not be read/)).toBeNull();
    });

    it("mentions pending edits only when removing a slave would discard them", async () => {
      setup("me-mbs");
      familyById(family).applyPatches(xml, [
        {
          type: "updateMbsConfig",
          patch: { slaveAddressMode: 1, slaves: [{ address: 1, description: "A" }, { address: 2, description: "B" }] },
        },
      ]);
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      render(<Workspace />);
      await screen.findByRole("textbox", { name: "Project name" });
      fireEvent.click(screen.getByRole("button", { name: "BMS · Modbus server" }));
      fireEvent.change(screen.getByRole("textbox", { name: "Slave 1 description" }), { target: { value: "Edited" } });
      const removes = screen.getAllByRole("button", { name: "Remove" });
      fireEvent.click(removes[0]);
      fireEvent.click(removes[1]);
      expect(confirm.mock.calls.map(([text]) => text)).toEqual([
        "Remove slave 1? Its 1 unsaved edit will be discarded.",
        "Remove slave 2?",
      ]);
      confirm.mockRestore();
    });
  });

  describe("two tabs: a TCP node removed and re-added at the same position", () => {
    /** Tab A drafts TCP node 2; tab B then replaces that node (count unchanged). */
    async function replacedNodeScenario() {
      familyById("knx-mbm").applyPatches(xml, [{ type: "addTcpNode" }, { type: "addTcpNode" }]);
      render(<Workspace devices />);
      const description = await screen.findByRole("textbox", { name: "TCP node 2 · Description" });
      fireEvent.change(description, { target: { value: "Meant for the old node" } });
      // Tab B, through the same API: the node at position 1 is a new one now.
      familyById("knx-mbm").applyPatches(xml, [
        { type: "removeNode", locator: { kind: "tcp", nodeIndex: 1 } },
        { type: "addTcpNode" },
      ]);
      revision++;
    }

    function expectBlockedWithoutKeep() {
      expect(screen.getByText(/may have been replaced or removed/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Keep my edit" })).toBeNull();
      expect(screen.getByRole("button", { name: /Save|Retry/ })).toHaveAttribute("aria-disabled", "true");
    }

    it("blocks the draft on Save and only offers to discard it", async () => {
      await replacedNodeScenario();
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await screen.findByRole("button", { name: "Discard this edit" });
      expectBlockedWithoutKeep();
      expect(mocks.patch).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Discard this edit" }));
      expect(screen.queryByText(/unsaved change/)).toBeNull();
      expect(screen.getByRole("textbox", { name: "TCP node 2 · Description" })).not.toHaveValue(
        "Meant for the old node",
      );
    });

    it("reloads after a 409 from any other mutation and blocks the draft", async () => {
      await replacedNodeScenario();
      const row = screen.getAllByRole("textbox", { name: "Device name" })[0].closest("tr")!;
      fireEvent.click(within(row).getByRole("checkbox", { name: "Enabled" }));
      expect(await screen.findByText(/changed elsewhere and has been reloaded/)).toBeInTheDocument();
      await screen.findByRole("button", { name: "Discard this edit" });
      expectBlockedWithoutKeep();
      expect(mocks.get).toHaveBeenCalledTimes(2);
    });
  });

  it("does not replace a newly selected project with a late save response", async () => {
    render(<Workspace />);
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Project name" }),
      { target: { value: "Old project draft" } },
    );
    let finish!: (view: ProjectView) => void;
    mocks.patch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Switch project" }));
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Project name" }),
      ).not.toHaveValue("Old project draft"),
    );
    await act(async () =>
      finish({
        ...currentView(),
        project: { ...currentView().project, name: "Old project draft" },
      } as ProjectView),
    );
    expect(
      screen.getByRole("textbox", { name: "Project name" }),
    ).not.toHaveValue("Old project draft");
  });
});
