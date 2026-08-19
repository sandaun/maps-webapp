"use client";

import * as React from "react";
import {
  GATEWAY_SESSIONS_CHANGED_EVENT,
  listGatewaySessions,
  type GatewaySessionsChangedDetail,
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
  const requestVersion = React.useRef(0);

  const refresh = React.useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const sessions = await listGatewaySessions();
      if (version !== requestVersion.current) return;
      setSession(sessions.find((candidate) => candidate.connected) ?? null);
    } catch {
      if (version !== requestVersion.current) return;
      setSession(null);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 5000);
    const onRefresh = () => void refresh();
    const onSessionsChanged = (event: Event) => {
      const detail = (event as CustomEvent<GatewaySessionsChangedDetail>).detail;
      requestVersion.current += 1;
      if (detail?.session?.connected) {
        setSession(detail.session);
        setLoading(false);
      } else if (detail?.disconnectedId) {
        setSession((current) => current?.id === detail.disconnectedId ? null : current);
        setLoading(false);
      }
      void refresh();
    };
    window.addEventListener("focus", onRefresh);
    window.addEventListener(GATEWAY_SESSIONS_CHANGED_EVENT, onSessionsChanged);
    return () => {
      requestVersion.current += 1;
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener(GATEWAY_SESSIONS_CHANGED_EVENT, onSessionsChanged);
    };
  }, [refresh]);

  const value = React.useMemo(() => ({ session, loading, refresh }), [session, loading, refresh]);
  return <GatewaySessionContext.Provider value={value}>{children}</GatewaySessionContext.Provider>;
}

export function useGatewaySession(): GatewaySessionState {
  return React.useContext(GatewaySessionContext);
}
