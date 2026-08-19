"use client";

import * as React from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import {
  gatewayFamily,
  getGatewaySession,
  listGatewaySessions,
  queryGatewayInfo,
  type GatewayInfoSummary,
  type GatewaySessionStatus,
} from "@/lib/gateway-api";
import { FAMILY_LABELS } from "@/lib/project-types";
import { useSessionEvents } from "@/lib/use-session-events";
import { GatewayInfoTable } from "@/components/gateway-info-table";
import { SessionLog, TransferProgressBar } from "@/components/session-log";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Live diagnostics: session state, INFO? snapshot and the transfer/connection
 * log (SSE). Advanced bus monitors are out of scope for the MVP and are not
 * faked here.
 */
export function DiagnosticsScreen() {
  const [session, setSession] = React.useState<GatewaySessionStatus | null>(null);
  const [info, setInfo] = React.useState<GatewayInfoSummary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [infoError, setInfoError] = React.useState<string | null>(null);

  const { log, progress } = useSessionEvents(session?.id ?? null);

  React.useEffect(() => {
    listGatewaySessions()
      .then((sessions) => {
        const first = sessions[0] ?? null;
        setSession(first);
        setInfo(first?.gateway ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleRefresh() {
    if (!session) return;
    setInfoError(null);
    try {
      const [status, freshInfo] = await Promise.all([
        getGatewaySession(session.id),
        queryGatewayInfo(session.id),
      ]);
      setSession(status);
      setInfo(freshInfo);
    } catch (err) {
      setInfoError(err instanceof Error ? err.message : "Refresh failed");
    }
  }

  if (loading) {
    return <p className="text-sm text-fg-muted">Checking gateway session…</p>;
  }

  if (!session) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Diagnostics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-fg-muted">
            No gateway session is open. Diagnostics shows live data only — session state, the
            INFO? snapshot and the transfer log — so it needs an active connection.
          </p>
          <p className="text-sm text-fg-muted">
            Connect from the{" "}
            <Link href="/connection" className="font-medium text-hms-accent hover:underline">
              Connection
            </Link>{" "}
            screen. Without a gateway you can keep working with the demo project.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Session state
              <Badge variant={session.connected ? "success" : "error"}>
                {session.connected ? "Connected" : "Connection lost"}
              </Badge>
              {session.busy && <Badge variant="warning">Transfer in progress</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-1 text-sm">
              <Row label="Host" value={`${session.host}:${session.port}`} />
              <Row label="Connected since" value={new Date(session.connectedAt).toLocaleString()} />
              <Row label="Encryption" value={session.encrypted ? "XXTEA session cipher" : "Cleartext fallback (old firmware)"} />
              <Row
                label="Family"
                value={
                  session.gateway
                    ? (() => {
                        const family = gatewayFamily(session.gateway);
                        return family ? FAMILY_LABELS[family] : "Different gateway family";
                      })()
                    : "Unknown"
                }
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>INFO? snapshot</CardTitle>
            <Button size="sm" variant="secondary" onClick={handleRefresh} disabled={session.busy}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Refresh
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {info ? (
              <GatewayInfoTable info={info} />
            ) : (
              <p className="text-sm text-fg-muted">No INFO data reported by the gateway.</p>
            )}
            {infoError && (
              <p role="alert" className="text-sm text-error">
                {infoError}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transfer &amp; connection log</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {progress && <TransferProgressBar progress={progress} />}
          <SessionLog log={log} emptyHint="No activity recorded for this session yet." />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="font-mono text-xs font-medium text-text-body">{value}</dd>
    </div>
  );
}
