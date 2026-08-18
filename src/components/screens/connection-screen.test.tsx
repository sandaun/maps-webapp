import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

afterEach(() => vi.unstubAllGlobals());

describe("ConnectionScreen", () => {
  it("shows the honest empty state when no gateway answers the scan", async () => {
    mockFetch((url) => {
      if (url === "/api/gateway/sessions") return { sessions: [] };
      if (url === "/api/gateway/discovery") return { gateways: [] };
      throw new Error(`Unexpected fetch ${url}`);
    });
    render(<ConnectionScreen />);

    expect(screen.getByText("Connect to an IP address")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Scan the network/ }));

    await screen.findByText(/No gateway answered the discovery broadcast/);
    expect(screen.getByText(/No gateway on the network/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/overview");
  });

  it("renders discovered gateways and greys out other families", async () => {
    mockFetch((url) => {
      if (url === "/api/gateway/sessions") return { sessions: [] };
      if (url === "/api/gateway/discovery") return { gateways: [KNX_MBM_GATEWAY, OTHER_GATEWAY] };
      throw new Error(`Unexpected fetch ${url}`);
    });
    render(<ConnectionScreen />);

    fireEvent.click(screen.getByRole("button", { name: /Scan the network/ }));

    await screen.findByText("KNX-MBM gateway");
    expect(screen.getByText("BACnet gateway")).toBeInTheDocument();
    expect(screen.getByText("Different family")).toBeInTheDocument();
    expect(screen.getByText(/121225-109228/)).toBeInTheDocument();
    // Only the compatible gateway offers an action.
    expect(screen.getAllByRole("button", { name: "Use this IP" })).toHaveLength(1);
  });

  it("prefills the IP form from a compatible discovered gateway", async () => {
    mockFetch((url) => {
      if (url === "/api/gateway/sessions") return { sessions: [] };
      if (url === "/api/gateway/discovery") return { gateways: [KNX_MBM_GATEWAY] };
      throw new Error(`Unexpected fetch ${url}`);
    });
    render(<ConnectionScreen />);

    fireEvent.click(screen.getByRole("button", { name: /Scan the network/ }));
    await screen.findByText("KNX-MBM gateway");

    fireEvent.click(screen.getByRole("button", { name: "Use this IP" }));
    await waitFor(() =>
      expect(screen.getByLabelText("IP address")).toHaveValue("192.168.1.50"),
    );
  });
});
