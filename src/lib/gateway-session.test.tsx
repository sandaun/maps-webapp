import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GatewaySessionProvider, useGatewaySession } from "./gateway-session";

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
}));

vi.mock("./gateway-api", () => ({
  GATEWAY_SESSIONS_CHANGED_EVENT: "maps:gateway-sessions-changed",
  listGatewaySessions: () => mocks.listSessions(),
}));

function SessionProbe() {
  const { session, loading } = useGatewaySession();
  return <div>{loading ? "Loading" : session?.host ?? "None"}</div>;
}

describe("GatewaySessionProvider", () => {
  beforeEach(() => {
    mocks.listSessions.mockReset();
  });

  it("updates immediately from connect and disconnect events", async () => {
    mocks.listSessions.mockResolvedValueOnce([]);
    render(
      <GatewaySessionProvider>
        <SessionProbe />
      </GatewaySessionProvider>,
    );

    expect(await screen.findByText("None")).toBeInTheDocument();
    mocks.listSessions.mockReturnValue(new Promise(() => {}));
    const session = {
      id: "s1",
      host: "192.168.100.35",
      port: 23,
      connected: true,
      encrypted: true,
      busy: false,
      connectedAt: "2026-08-19T17:00:00.000Z",
    };

    window.dispatchEvent(
      new CustomEvent("maps:gateway-sessions-changed", { detail: { session } }),
    );
    expect(await screen.findByText("192.168.100.35")).toBeInTheDocument();

    window.dispatchEvent(
      new CustomEvent("maps:gateway-sessions-changed", { detail: { disconnectedId: "s1" } }),
    );
    expect(await screen.findByText("None")).toBeInTheDocument();
  });
});
