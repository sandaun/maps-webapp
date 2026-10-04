import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionScreen } from "./connection-screen";
import { chooseOption } from "@/components/ui/select-testing";
import type { FamilyId } from "@/lib/project-types";

const project = vi.hoisted(() => ({ view: { family: "knx-mbm" } as { family: FamilyId } | null }));
vi.mock("@/lib/current-project", () => ({ useCurrentProject: () => ({ view: project.view }) }));

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = handler(url, init);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const KNX_MBM_GATEWAY = {
  address: "192.168.1.50",
  info: {
    name: "KNX-MBM gateway",
    appName: "IN-KNX-MBM",
    appId: 4,
    appVersion: "1.0.0",
    serial: "121225-109228",
    mac: "00:11:22:33:44:55",
    bootloader: false,
    noApp: false,
  },
  raw: {},
};

const OTHER_GATEWAY = {
  address: "192.168.1.60",
  info: {
    name: "BACnet gateway",
    appName: "IN-BAC-MBM",
    appId: 78,
    appVersion: "2.1.0",
    bootloader: false,
    noApp: false,
  },
  raw: {},
};

function sessionFor(host: string) {
  return {
    id: "s1",
    host,
    port: 23,
    connected: true,
    encrypted: true,
    busy: false,
    connectedAt: new Date().toISOString(),
    gateway: KNX_MBM_GATEWAY.info,
  };
}

const RECENT_IPS_KEY = "maps-web:recent-gateway-ips";

beforeEach(() => {
  window.localStorage.clear();
  project.view = { family: "knx-mbm" };
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function openManualDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Connect to an IP address manually →" }));
  return screen.getByRole("dialog", { name: "Connect to an IP address" });
}

function submitManualIp(dialog: HTMLElement, ip: string) {
  fireEvent.change(within(dialog).getByLabelText("IP address"), { target: { value: ip } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Connect" }));
}

describe("ConnectionScreen", () => {
  it("discovers a known IP by unicast and rejects invalid octets", async () => {
    const fetch = mockFetch((url) => {
      if (url === "/api/gateway/discovery") return { gateways: [] };
      throw new Error(`Unexpected fetch ${url}`);
    });
    render(<ConnectionScreen />);
    await screen.findByText(/No gateway answered/);
    fireEvent.change(screen.getByLabelText("Direct IP (optional)"), { target: { value: "192.168.2.167" } });
    fireEvent.click(screen.getByRole("button", { name: "Scan again" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/gateway/discovery", expect.objectContaining({
      body: JSON.stringify({ targets: ["192.168.2.167"] }),
    })));
    await screen.findByRole("button", { name: "Scan again" });
    fireEvent.change(screen.getByLabelText("Direct IP (optional)"), { target: { value: "999.1.2.3" } });
    fireEvent.click(screen.getByRole("button", { name: "Scan again" }));
    expect(await screen.findByText(/is not a valid IPv4 address/)).toBeInTheDocument();
  });

  it("lists server serial ports and connects over USB without a password", async () => {
    let posted: unknown;
    mockFetch((url, init) => {
      if (url === "/api/gateway/discovery") return { gateways: [] };
      if (url === "/api/gateway/serial-ports") return { ports: [
        { path: "/dev/ttyACM0", manufacturer: "Intesis" },
        { path: "/dev/ttyACM1", manufacturer: "Intesis" },
      ], isWsl: true };
      if (url === "/api/gateway/sessions" && init?.method === "POST") {
        posted = JSON.parse(String(init.body));
        return { session: { ...sessionFor("/dev/ttyACM1"), transport: "usb", encrypted: false } };
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    render(<ConnectionScreen />);
    fireEvent.click(screen.getByRole("button", { name: "USB port" }));
    const dialog = await screen.findByRole("dialog", { name: "Connect over USB" });
    const ports = within(dialog).getByRole("combobox", { name: "USB serial port" });
    await waitFor(() => expect(ports).toHaveTextContent("/dev/ttyACM0"));
    chooseOption(ports, "/dev/ttyACM1 · Intesis");
    expect(within(dialog).queryByLabelText("Password")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/WSL/)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(posted).toEqual({ transport: "usb", path: "/dev/ttyACM1" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("disables USB connect when no serial ports are available", async () => {
    mockFetch((url) => {
      if (url === "/api/gateway/discovery") return { gateways: [] };
      if (url === "/api/gateway/serial-ports") return { ports: [], isWsl: true };
      throw new Error(`Unexpected fetch ${url}`);
    });
    render(<ConnectionScreen />);
    fireEvent.click(screen.getByRole("button", { name: "USB port" }));
    const dialog = await screen.findByRole("dialog", { name: "Connect over USB" });
    await within(dialog).findByText("No serial ports found");
    expect(within(dialog).getByRole("combobox", { name: "USB serial port" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Connect" })).toBeDisabled();
  });

  it("auto-scans on mount and shows the honest empty state when no gateway answers", async () => {
    mockFetch((url) => {
      if (url === "/api/gateway/discovery") return { gateways: [] };
      throw new Error(`Unexpected fetch ${url}`);
    });
    render(<ConnectionScreen />);

    await screen.findByText(/No gateway answered the discovery broadcast/);
    expect(screen.getByText("0 gateways found · 0 template matches")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Connect to an IP address manually →" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No gateway selected")).toBeInTheDocument();
    expect(screen.queryByText("Connection log")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Diagnostics →" })).toHaveAttribute("href", "/diagnostics");
  });

  it("renders discovered gateways and shows the selected gateway details", async () => {
    mockFetch((url) => {
      if (url === "/api/gateway/discovery") return { gateways: [KNX_MBM_GATEWAY, OTHER_GATEWAY] };
      throw new Error(`Unexpected fetch ${url}`);
    });
    render(<ConnectionScreen />);

    // The name appears both in the list row and in the auto-selected detail panel.
    await screen.findAllByText("KNX-MBM gateway");
    expect(screen.getByText("BACnet gateway")).toBeInTheDocument();
    expect(screen.getAllByText(/121225-109228/).length).toBeGreaterThan(0);

    // The first gateway is auto-selected: detail rows and password are visible.
    expect(screen.getByText("Template match")).toBeInTheDocument();
    expect(screen.getByText("Match")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();

    // Selecting the incompatible gateway flags it.
    fireEvent.click(screen.getByRole("button", { name: /BACnet gateway/ }));
    expect(await screen.findByText("No match")).toBeInTheDocument();
    expect(screen.getByText("incompatible family")).toBeInTheDocument();
    expect(screen.getAllByText(/does not support/).length).toBeGreaterThan(0);
  });

  it.each(["knx-mbm", "me-mbs", "mbs-knx"] as const)("matches only the open %s project template", async (family) => {
    const me = { ...KNX_MBM_GATEWAY, address: "192.168.1.61", info: {
      ...KNX_MBM_GATEWAY.info, name: "ME-MBS gateway", appName: "IN-ME-AC-MBS", appId: 64,
    } };
    const mbsKnx = { ...KNX_MBM_GATEWAY, address: "192.168.1.62", info: {
      ...KNX_MBM_GATEWAY.info, name: "MBS-KNX gateway", appName: "IN-MBS-KNX", appId: 7,
    } };
    const gateways = [KNX_MBM_GATEWAY, me, mbsKnx];
    project.view = { family };
    mockFetch((url) => {
      if (url === "/api/gateway/discovery") return { gateways };
      throw new Error(`Unexpected fetch ${url}`);
    });
    render(<ConnectionScreen />);
    await screen.findByText("3 gateways found · 1 template match");
    for (const [index, gateway] of gateways.entries()) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(gateway.info.name) }));
      const matches = index === ["knx-mbm", "me-mbs", "mbs-knx"].indexOf(family);
      expect(screen.getByText(matches ? "Match" : "No match")).toBeInTheDocument();
      expect(screen.queryByText("incompatible family")).not.toBeInTheDocument();
      if (matches) expect(screen.queryByText(/does not match the open project's template/)).not.toBeInTheDocument();
      else expect(screen.getByText(/does not match the open project's template/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
    }
  });

  it("does not claim a template match without an open project", async () => {
    project.view = null;
    mockFetch((url) => {
      if (url === "/api/gateway/discovery") return { gateways: [KNX_MBM_GATEWAY] };
      throw new Error(`Unexpected fetch ${url}`);
    });
    render(<ConnectionScreen />);
    await screen.findByText("No project open");
    expect(screen.getByText("1 gateway found · 1 supported")).toBeInTheDocument();
    expect(screen.queryByText("Match")).not.toBeInTheDocument();
  });

  it("connects to the selected gateway with the entered password", async () => {
    let posted: unknown;
    mockFetch((url, init) => {
      if (url === "/api/gateway/discovery") return { gateways: [KNX_MBM_GATEWAY] };
      if (url === "/api/gateway/sessions" && init?.method === "POST") {
        posted = JSON.parse(String(init.body));
        return { session: sessionFor("192.168.1.50") };
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    render(<ConnectionScreen />);

    await screen.findAllByText("KNX-MBM gateway");
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() =>
      expect(posted).toEqual({ host: "192.168.1.50", password: "secret" }),
    );
    // The password field is cleared right after the attempt.
    await waitFor(() => expect(screen.getByLabelText("Password")).toHaveValue(""));
  });

  it("connects manually from the modal and validates the IPv4 address", async () => {
    let posted: unknown;
    mockFetch((url, init) => {
      if (url === "/api/gateway/discovery") return { gateways: [] };
      if (url === "/api/gateway/sessions" && init?.method === "POST") {
        posted = JSON.parse(String(init.body));
        return { session: sessionFor("10.0.0.8") };
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    render(<ConnectionScreen />);

    await screen.findByText(/No gateway answered the discovery broadcast/);
    fireEvent.click(screen.getByRole("button", { name: "Connect to an IP address manually →" }));

    const dialog = screen.getByRole("dialog", { name: "Connect to an IP address" });
    fireEvent.change(within(dialog).getByLabelText("IP address"), {
      target: { value: "not-an-ip" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Connect" }));
    expect(await within(dialog).findByText(/is not a valid IPv4 address/)).toBeInTheDocument();

    submitManualIp(dialog, "192.168.1.999");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("is not a valid IPv4 address");
    expect(posted).toBeUndefined();

    fireEvent.change(within(dialog).getByLabelText("IP address"), {
      target: { value: "10.0.0.8" },
    });
    fireEvent.change(within(dialog).getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(posted).toEqual({ host: "10.0.0.8", password: "pw" }));
    // A successful manual connect closes the modal.
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Connect to an IP address" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("remembers only successful manual connections, with five unique IPs ordered by most recent use", async () => {
    window.localStorage.setItem(RECENT_IPS_KEY, JSON.stringify([
      "10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4", "10.0.0.5",
    ]));
    mockFetch((url, init) => {
      if (url === "/api/gateway/discovery") return { gateways: [] };
      if (url === "/api/gateway/sessions" && init?.method === "POST") {
        const { host } = JSON.parse(String(init.body));
        return { session: sessionFor(host) };
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    render(<ConnectionScreen />);
    await screen.findByText(/No gateway answered/);

    let dialog = openManualDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Use IP address 10.0.0.3" }));
    expect(within(dialog).getByLabelText("IP address")).toHaveValue("10.0.0.3");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Password"), { target: { value: "secret" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(JSON.parse(window.localStorage.getItem(RECENT_IPS_KEY)!)).toEqual([
      "10.0.0.3", "10.0.0.1", "10.0.0.2", "10.0.0.4", "10.0.0.5",
    ]);

    dialog = openManualDialog();
    expect(within(dialog).getByLabelText("Password")).toHaveValue("");
    submitManualIp(dialog, " 10.0.0.6 ");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(JSON.parse(window.localStorage.getItem(RECENT_IPS_KEY)!)).toEqual([
      "10.0.0.6", "10.0.0.3", "10.0.0.1", "10.0.0.2", "10.0.0.4",
    ]);
  });

  it("keeps failed attempts out of history and clears the error after a successful retry", async () => {
    window.localStorage.setItem(RECENT_IPS_KEY, JSON.stringify(["10.0.0.1"]));
    let fail = true;
    mockFetch((url, init) => {
      if (url === "/api/gateway/discovery") return { gateways: [] };
      if (url === "/api/gateway/sessions" && init?.method === "POST") {
        if (fail) throw new Error("Gateway unreachable");
        return { session: sessionFor("10.0.0.2") };
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    render(<ConnectionScreen />);
    await screen.findByText(/No gateway answered/);
    const dialog = openManualDialog();
    submitManualIp(dialog, "10.0.0.2");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Gateway unreachable");
    expect(JSON.parse(window.localStorage.getItem(RECENT_IPS_KEY)!)).toEqual(["10.0.0.1"]);

    fail = false;
    fireEvent.click(within(dialog).getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText("Gateway unreachable")).not.toBeInTheDocument();
    expect(within(openManualDialog()).queryByRole("alert")).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(RECENT_IPS_KEY)!)).toEqual(["10.0.0.2", "10.0.0.1"]);
  });

  it("persists removal of an individual IP across screen mounts", async () => {
    window.localStorage.setItem(RECENT_IPS_KEY, JSON.stringify(["10.0.0.1", "10.0.0.2"]));
    mockFetch((url) => {
      if (url === "/api/gateway/discovery") return { gateways: [] };
      throw new Error(`Unexpected fetch ${url}`);
    });
    const { unmount } = render(<ConnectionScreen />);
    await screen.findByText(/No gateway answered/);
    const dialog = openManualDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove IP address 10.0.0.1" }));
    expect(within(dialog).queryByRole("button", { name: "Use IP address 10.0.0.1" })).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(RECENT_IPS_KEY)!)).toEqual(["10.0.0.2"]);

    unmount();
    render(<ConnectionScreen />);
    await screen.findByText(/No gateway answered/);
    expect(within(openManualDialog()).getByRole("button", { name: "Use IP address 10.0.0.2" })).toBeInTheDocument();
  });

  it("still connects and offers recent IPs for this visit when browser storage is blocked", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    mockFetch((url, init) => {
      if (url === "/api/gateway/discovery") return { gateways: [] };
      if (url === "/api/gateway/sessions" && init?.method === "POST") {
        return { session: sessionFor("10.0.0.2") };
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    render(<ConnectionScreen />);
    await screen.findByText(/No gateway answered/);
    submitManualIp(openManualDialog(), "10.0.0.2");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(openManualDialog()).getByRole("button", { name: "Use IP address 10.0.0.2" })).toBeInTheDocument();
  });

  it.each(["invalid JSON", '{"ip":"10.0.0.1"}'])("ignores malformed stored history: %s", async (stored) => {
    window.localStorage.setItem(RECENT_IPS_KEY, stored);
    mockFetch((url) => {
      if (url === "/api/gateway/discovery") return { gateways: [] };
      throw new Error(`Unexpected fetch ${url}`);
    });
    render(<ConnectionScreen />);
    await screen.findByText(/No gateway answered/);
    expect(within(openManualDialog()).queryByRole("list", { name: "Recent IP addresses" })).not.toBeInTheDocument();
  });

  it("sanitizes stored IPs, removes duplicates and limits suggestions to five", async () => {
    window.localStorage.setItem(RECENT_IPS_KEY, JSON.stringify([
      null, 42, "192.168.1.999", "not-an-ip", " 10.0.0.1 ", "10.0.0.1",
      "10.0.0.2", "10.0.0.3", "10.0.0.4", "10.0.0.5", "10.0.0.6",
    ]));
    mockFetch((url) => {
      if (url === "/api/gateway/discovery") return { gateways: [] };
      throw new Error(`Unexpected fetch ${url}`);
    });
    render(<ConnectionScreen />);
    await screen.findByText(/No gateway answered/);
    const recent = within(openManualDialog()).getByRole("list", { name: "Recent IP addresses" });
    expect(within(recent).getAllByRole("listitem")).toHaveLength(5);
    expect(within(recent).getByRole("button", { name: "Use IP address 10.0.0.1" })).toBeInTheDocument();
    expect(within(recent).queryByRole("button", { name: "Use IP address 10.0.0.6" })).not.toBeInTheDocument();
  });
});
