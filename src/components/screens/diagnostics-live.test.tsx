import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { SYNTHETIC_MBS_KNX_XML } from "@/gateway-families/mbs-knx/fixtures/synthetic-project";
import { projectFromXml } from "@/gateway-families/mbs-knx/from-xml";
import type { ProjectView } from "@/lib/project-types";
import type { GatewaySessionStatus } from "@/lib/gateway-api";
import type { LogEntry } from "@/lib/use-session-events";
import { DiagnosticsScreen } from "./diagnostics-screen";

const state = vi.hoisted(() => ({
  view: null as ProjectView | null,
  session: null as GatewaySessionStatus | null,
  monitor: [] as LogEntry[],
  log: [] as LogEntry[],
  setMonitor: vi.fn(),
  command: vi.fn(),
}));

vi.mock("@/lib/current-project", () => ({ useCurrentProject: () => ({ view: state.view }) }));
vi.mock("@/lib/gateway-session", () => ({ useGatewaySession: () => ({ session: state.session, loading: false }) }));
vi.mock("@/lib/use-session-events", () => ({
  useSessionEvents: () => ({ log: state.log, monitor: state.monitor, status: state.session }),
}));
vi.mock("@/lib/gateway-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/gateway-api")>(),
  setGatewayMonitor: state.setMonitor,
  sendConsoleCommand: state.command,
}));

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.setItem("maps.diagnostics.signalsOpen", "1");
  state.session = {
    id: "session", host: "10.0.0.1", port: 23, connected: true, encrypted: true,
    busy: false, monitoring: true, monitorComms: true, monitorDebug: false, connectedAt: new Date().toISOString(),
  };
  state.view = {
    family: "mbs-knx", project: projectFromXml(XmlDocument.parse(SYNTHETIC_MBS_KNX_XML)),
    meta: { id: "test", name: "test", description: "", source: "file", family: "mbs-knx", updatedAt: "" },
    passwordValid: false, mapsVersion: "", issues: [], hasCompleteBlob: false,
  };
  state.monitor = [];
  state.log = [];
  state.setMonitor.mockResolvedValue(state.session);
  state.command.mockImplementation(async (_id: string, command: string) => ({
    lines: [command.endsWith("?") ? `${command.slice(0, -1)}=0;0` : `${command.slice(0, 3)}:OK`],
    timedOut: false,
  }));
});

describe("MBS–KNX live diagnostics", () => {
  it("identifies bus traffic, filters by signal name and explains unassigned frames", async () => {
    state.monitor = [
      { at: "2026-10-03T10:00:00.000Z", line: "0MS:RTUB [Rx] 01 03 00 00 00 01 84 0A" },
      { at: "2026-10-03T10:00:00.025Z", line: "0MS:RTUB [Tx] 01 03 02 00 01 79 84" },
      { at: "2026-10-03T10:00:00.050Z", line: "0MS:RTUB [Tx] 01 03 02 00 01 79 84" },
    ];
    render(<DiagnosticsScreen />);
    expect(screen.getByText("SIGNAL", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("FRAME / MESSAGE", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("OBJECT", { exact: true })).not.toBeInTheDocument();
    const request = await screen.findByRole("button", { name: /MODBUS RX .* Setpoint/ });
    expect(within(request).getByText("01 03 00 00 00 01 84 0A")).toBeInTheDocument();
    expect(within(request).queryByText(/0MS:RTUB/)).not.toBeInTheDocument();
    expect(within(request).getByText("Setpoint")).toHaveAttribute("title", "Setpoint · 0 ⇄ 1/0/1");
    fireEvent.change(screen.getByPlaceholderText("Filter frames (text or regex)"), { target: { value: "Setpoint" } });
    expect(screen.getAllByRole("button", { name: /MODBUS (RX|TX) .* Setpoint/ })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /MODBUS TX .* —/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Filter frames (text or regex)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /MODBUS TX .* —/ }));
    expect(screen.getByText(/No signal could be identified from this frame/)).toBeInTheDocument();
    expect(screen.getByText("Console message 0MS:RTUB [Tx] 01 03 02 00 01 79 84")).toBeInTheDocument();
  });

  it.each([null, { family: "me-mbs" } as ProjectView])("hides the signal column for an absent or unsupported project: %j", async (view) => {
    state.view = view;
    state.monitor = [{ at: new Date().toISOString(), line: "1MM:RTUB Timeout!" }];
    render(<DiagnosticsScreen />);
    expect(screen.getByText("Open a KNX ↔ Modbus project to identify signals in the traffic log.")).toBeInTheDocument();
    expect(screen.queryByText("SIGNAL", { exact: true })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /MODBUS.*1MM:RTUB Timeout!/ })).toBeInTheDocument();
  });

  it("marks unsent drafts and keeps the read-only side of each signal non-editable", async () => {
    render(<DiagnosticsScreen />);
    expect(screen.getByRole("textbox", { name: "Room temperature Modbus value" })).toHaveAttribute("readonly");
    expect(screen.getByRole("textbox", { name: "Reset KNX value" })).toHaveAttribute("readonly");
    expect(screen.getByRole("textbox", { name: "Reset Modbus value" })).not.toHaveAttribute("readonly");
    const knx = screen.getByRole("textbox", { name: "Setpoint KNX value" });
    fireEvent.change(knx, { target: { value: "1" } });
    expect(screen.getByText("Pending — press Enter to send")).toBeInTheDocument();
    expect(state.command).not.toHaveBeenCalled();
    fireEvent.keyDown(knx, { key: "Enter" });
    await waitFor(() => expect(state.command).toHaveBeenCalledWith("session", "1KX:00010801=1"));
    await waitFor(() => expect(screen.queryByText("Pending — press Enter to send")).not.toBeInTheDocument());
    // Even a synthetic Enter event on a read-only input cannot bypass the guard.
    const readOnly = screen.getByRole("textbox", { name: "Room temperature Modbus value" });
    fireEvent.change(readOnly, { target: { value: "1" } });
    fireEvent.keyDown(readOnly, { key: "Enter" });
    expect(state.command).toHaveBeenCalledTimes(1);
  });

  it("shows active project signals and uses each protocol's runtime ids to refresh and write", async () => {
    render(<DiagnosticsScreen />);
    expect(screen.getByText("4 of 4 signals")).toBeInTheDocument();
    expect(screen.queryByText("Spare")).not.toBeInTheDocument();
    expect(screen.getByText("0 ⇄ 1/0/1")).toBeInTheDocument();
    await waitFor(() => expect(state.setMonitor).toHaveBeenCalledWith("session", true, { comms: true, debug: false }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(state.command).toHaveBeenCalledTimes(8));
    expect(state.command).toHaveBeenCalledWith("session", "1KX:00010801?");
    expect(state.command).toHaveBeenCalledWith("session", "0MS:00000000?");
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Setpoint KNX value" })).toHaveValue("0"));
    expect(screen.getByRole("textbox", { name: "Setpoint Modbus value" })).toHaveValue("0");
    const knx = screen.getByRole("textbox", { name: "Setpoint KNX value" });
    fireEvent.change(knx, { target: { value: "22.5" } });
    fireEvent.keyDown(knx, { key: "Enter" });
    await waitFor(() => expect(state.command).toHaveBeenCalledWith("session", "1KX:00010801=22.5"));
    const modbus = screen.getByRole("textbox", { name: "Setpoint Modbus value" });
    fireEvent.change(modbus, { target: { value: "225" } });
    fireEvent.keyDown(modbus, { key: "Enter" });
    await waitFor(() => expect(state.command).toHaveBeenCalledWith("session", "0MS:00000000=225;"));
  });

  it("updates the viewer from spontaneous KNX and Modbus values", async () => {
    state.monitor = [
      { at: new Date().toISOString(), line: "1KX:00010801=22.5;0" },
      { at: new Date().toISOString(), line: "0MS:00000000=225;0" },
    ];
    const { unmount } = render(<DiagnosticsScreen />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Setpoint KNX value" })).toHaveValue("22.5"));
    expect(screen.getByRole("textbox", { name: "Setpoint Modbus value" })).toHaveValue("225");
    expect(screen.getByText("2 frames")).toBeInTheDocument();
    unmount();
    await waitFor(() => expect(state.setMonitor).toHaveBeenCalledWith("session", false, { comms: true, debug: false }));
  });

  it("shows monitor errors and clears them after a successful toggle", async () => {
    state.setMonitor.mockRejectedValueOnce(new Error("The live monitor does not support this gateway application"));
    render(<DiagnosticsScreen />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Monitor could not start");
    fireEvent.click(screen.getByRole("button", { name: "Debug" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(state.setMonitor).toHaveBeenCalledWith("session", true, { comms: true, debug: true });
  });

  it("serialises monitor startup and cleanup under StrictMode", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    state.setMonitor.mockImplementation(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 10));
      concurrent--;
      return state.session;
    });
    render(<StrictMode><DiagnosticsScreen /></StrictMode>);
    await waitFor(() => expect(state.setMonitor).toHaveBeenCalledTimes(3));
    expect(state.setMonitor.mock.calls.map((call) => call[1])).toEqual([true, false, true]);
    expect(maxConcurrent).toBe(1);
  });
});
