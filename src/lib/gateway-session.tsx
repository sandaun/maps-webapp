"use client";

import * as React from "react";
import {
  GATEWAY_SESSIONS_CHANGED_EVENT,
  listGatewaySessions,
  type GatewaySessionStatus,
} from "./gateway-api";

interface GatewaySessionState {
  session: GatewaySessionStatus | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const INERT_STATE: GatewaySessionState = {
  session: null,
  loading: false,
  refresh: async () => {},
};

const GatewaySessionContext = React.createContext<GatewaySessionState>(INERT_STATE);

export function GatewaySessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<GatewaySessionStatus | null>(null);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    try {
      const sessions = await listGatewaySessions();
      setSession(sessions.find((candidate) => candidate.connected) ?? null);
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 5000);
    const onRefresh = () => void refresh();
    window.addEventListener("focus", onRefresh);
    window.addEventListener(GATEWAY_SESSIONS_CHANGED_EVENT, onRefresh);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener(GATEWAY_SESSIONS_CHANGED_EVENT, onRefresh);
    };
  }, [refresh]);

  const value = React.useMemo(() => ({ session, loading, refresh }), [session, loading, refresh]);
  return <GatewaySessionContext.Provider value={value}>{children}</GatewaySessionContext.Provider>;
}

export function useGatewaySession(): GatewaySessionState {
  return React.useContext(GatewaySessionContext);
}
