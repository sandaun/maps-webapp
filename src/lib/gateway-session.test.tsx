import { render, screen, waitFor } from "@testing-library/react";
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

  it("loads the connected session and refreshes after session changes", async () => {
    mocks.listSessions.mockResolvedValue([
      { id: "s1", host: "192.168.100.35", port: 23, connected: true },
    ]);
    render(
      <GatewaySessionProvider>
        <SessionProbe />
      </GatewaySessionProvider>,
    );

    expect(await screen.findByText("192.168.100.35")).toBeInTheDocument();
    mocks.listSessions.mockResolvedValue([]);
    window.dispatchEvent(new Event("maps:gateway-sessions-changed"));
    await waitFor(() => expect(screen.getByText("None")).toBeInTheDocument());
  });
});
