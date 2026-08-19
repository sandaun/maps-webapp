import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectGateway,
  disconnectGateway,
  GATEWAY_SESSIONS_CHANGED_EVENT,
} from "./gateway-api";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock("./api", () => ({
  request: (...args: unknown[]) => mocks.request(...args),
}));

describe("gateway session change events", () => {
  beforeEach(() => {
    mocks.request.mockReset();
  });

  it("publishes connected session details as soon as connect succeeds", async () => {
    const session = {
      id: "s1",
      host: "192.168.100.35",
      port: 23,
      connected: true,
      encrypted: true,
      busy: false,
      connectedAt: "2026-08-19T17:00:00.000Z",
    };
    mocks.request.mockResolvedValue({ session });
    const listener = vi.fn();
    window.addEventListener(GATEWAY_SESSIONS_CHANGED_EVENT, listener);

    await connectGateway(session.host, "secret");

    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ session });
    window.removeEventListener(GATEWAY_SESSIONS_CHANGED_EVENT, listener);
  });

  it("publishes the disconnected session id as soon as disconnect succeeds", async () => {
    mocks.request.mockResolvedValue(undefined);
    const listener = vi.fn();
    window.addEventListener(GATEWAY_SESSIONS_CHANGED_EVENT, listener);

    await disconnectGateway("s1");

    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ disconnectedId: "s1" });
    window.removeEventListener(GATEWAY_SESSIONS_CHANGED_EVENT, listener);
  });
});
