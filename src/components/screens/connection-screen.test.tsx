import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionScreen } from "./connection-screen";

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

afterEach(() => vi.unstubAllGlobals());

describe("ConnectionScreen", () => {
  it("auto-scans on mount and shows the honest empty state when no gateway answers", async () => {
    mockFetch((url) => {
      if (url === "/api/gateway/discovery") return { gateways: [] };
      throw new Error(`Unexpected fetch ${url}`);
    });
    render(<ConnectionScreen />);

    await screen.findByText(/No gateway answered the discovery broadcast/);
    expect(screen.getByText("0 gateways found · 0 compatible")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Connect to an IP address manually →" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No gateway selected")).toBeInTheDocument();
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
    expect(screen.getByText("compatible")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();

    // Selecting the incompatible gateway flags it.
    fireEvent.click(screen.getByRole("button", { name: /BACnet gateway/ }));
    expect(await screen.findByText("not compatible")).toBeInTheDocument();
    expect(screen.getByText("incompatible family")).toBeInTheDocument();
    expect(screen.getAllByText(/does not support/).length).toBeGreaterThan(0);
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
});
