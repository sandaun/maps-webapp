"use client";

import * as React from "react";
import Link from "next/link";
import { Cable, Download, Plug, PlugZap, RefreshCw, Search } from "lucide-react";
import {
  connectGateway,
  disconnectGateway,
  isKnxMbmGateway,
  listGatewaySessions,
  queryGatewayInfo,
  receiveGatewayProject,
  scanGateways,
  type DiscoveredGateway,
  type GatewayInfoSummary,
  type GatewaySessionStatus,
} from "@/lib/gateway-api";
import { useCurrentProject } from "@/lib/current-project";
import { useSessionEvents } from "@/lib/use-session-events";
import { GatewayInfoTable } from "@/components/gateway-info-table";
import { SessionLog, TransferProgressBar } from "@/components/session-log";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function ConnectionScreen() {
  const { setProjectId } = useCurrentProject();

  const [session, setSession] = React.useState<GatewaySessionStatus | null>(null);
  const [info, setInfo] = React.useState<GatewayInfoSummary | null>(null);

  const [gateways, setGateways] = React.useState<DiscoveredGateway[] | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const [scanError, setScanError] = React.useState<string | null>(null);

  const [host, setHost] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [connecting, setConnecting] = React.useState(false);
  const [connectError, setConnectError] = React.useState<string | null>(null);

  const [receiving, setReceiving] = React.useState(false);
  const [receiveError, setReceiveError] = React.useState<string | null>(null);
  const [receivedName, setReceivedName] = React.useState<string | null>(null);

  const { log, progress } = useSessionEvents(session?.id ?? null);

  // Pick up a session that is already open on the (single-process) server.
  React.useEffect(() => {
    listGatewaySessions()
      .then((sessions) => {
        const first = sessions[0] ?? null;
        setSession(first);
        setInfo(first?.gateway ?? null);
      })
      .catch(() => {});
  }, []);

  async function handleScan() {
    setScanning(true);
    setScanError(null);
    try {
      setGateways(await scanGateways());
    } catch (err) {
      setGateways([]);
      setScanError(errorMessage(err, "Scan failed"));
    } finally {
      setScanning(false);
    }
  }

  async function handleConnect(event: React.FormEvent) {
    event.preventDefault();
    if (!host.trim()) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const next = await connectGateway(host.trim(), password);
      setSession(next);
      setInfo(next.gateway ?? null);
      setHost("");
    } catch (err) {
      setConnectError(errorMessage(err, "Connection failed"));
    } finally {
      // The password lives only in this state; clear it right after the attempt.
      setPassword("");
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!session) return;
    try {
      await disconnectGateway(session.id);
    } catch {
      // A dead session is gone either way.
    }
    setSession(null);
    setInfo(null);
    setReceivedName(null);
  }

  async function handleRefreshInfo() {
    if (!session) return;
    try {
      setInfo(await queryGatewayInfo(session.id));
    } catch (err) {
      setReceiveError(errorMessage(err, "INFO? query failed"));
    }
  }

  async function handleReceive() {
    if (!session) return;
    setReceiving(true);
    setReceiveError(null);
    setReceivedName(null);
    try {
      const meta = await receiveGatewayProject(session.id);
      setProjectId(meta.id);
      setReceivedName(meta.name);
    } catch (err) {
      // Includes the server-side rejection of non-KNX–MBM projects.
      setReceiveError(errorMessage(err, "Receive failed"));
    } finally {
      setReceiving(false);
    }
  }

  if (session) {
    const compatible = info ? isKnxMbmGateway(info) : true;
    return (
      <div className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                Gateway session
                <Badge variant={session.connected ? "success" : "error"}>
                  {session.connected ? "Connected" : "Connection lost"}
                </Badge>
                <Badge variant={session.encrypted ? "muted" : "warning"}>
                  {session.encrypted ? "Encrypted" : "Cleartext fallback"}
                </Badge>
                {info && (
                  <Badge variant={compatible ? "default" : "warning"}>
                    {compatible ? "KNX ↔ Modbus Master" : "Different gateway family"}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="font-mono text-xs text-fg-muted">
                {session.host}:{session.port} · connected{" "}
                {new Date(session.connectedAt).toLocaleString()}
              </p>
              {info ? (
                <GatewayInfoTable info={info} />
              ) : (
                <p className="text-sm text-fg-muted">The gateway did not report INFO data.</p>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button size="sm" variant="secondary" onClick={handleRefreshInfo} disabled={session.busy}>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  Refresh INFO
                </Button>
                <Button size="sm" variant="secondary" onClick={handleDisconnect}>
                  <Plug className="h-3.5 w-3.5" aria-hidden />
                  Disconnect
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Receive project from gateway</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-fg-muted">
                Downloads the current project (RECVCMPLT, read-only — the gateway is never
                modified) and opens it here as a project with source “gateway”.
              </p>
              {receiving && progress && <TransferProgressBar progress={progress} />}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleReceive}
                  disabled={receiving || session.busy || !session.connected}
                >
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  {receiving ? "Receiving…" : "Receive from gateway"}
                </Button>
              </div>
              {receivedName && (
                <p className="text-sm text-success">
                  Received “{receivedName}” — it is now the current project.
                </p>
              )}
              {receiveError && (
                <p role="alert" className="text-sm text-error">
                  {receiveError}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Activity log</CardTitle>
          </CardHeader>
          <CardContent>
            <SessionLog log={log} emptyHint="No activity yet." />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>Discovered gateways</CardTitle>
              <p className="text-xs text-fg-muted">
                UDP broadcast scan (port 23) — KNX ↔ Modbus Master units are highlighted.
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={handleScan} disabled={scanning}>
              <Search className="h-3.5 w-3.5" aria-hidden />
              {scanning ? "Scanning…" : gateways === null ? "Scan the network" : "Scan again"}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {scanError && (
              <p role="alert" className="text-sm text-error">
                {scanError}
              </p>
            )}
            {gateways === null && !scanning && (
              <p className="text-sm text-fg-muted">
                Not scanned yet. Run a scan to find Intesis gateways on this network.
              </p>
            )}
            {gateways !== null && gateways.length === 0 && !scanning && !scanError && (
              <p className="text-sm text-fg-muted">
                No gateway answered the discovery broadcast. Check the network or connect to an IP
                address manually.
              </p>
            )}
            {gateways !== null && gateways.length > 0 && (
              <ul className="divide-y divide-border" aria-label="Discovered gateways">
                {gateways.map((gw) => {
                  const compatible = isKnxMbmGateway(gw.info, gw.raw);
                  return (
                    <li
                      key={gw.address}
                      className={compatible ? "py-2.5" : "py-2.5 opacity-60"}
                    >
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium text-text-body">
                              {gw.info.name ?? "Intesis gateway"}
                            </span>
                            {!compatible && <Badge variant="muted">Different family</Badge>}
                          </div>
                          <div className="mt-0.5 font-mono text-xs text-fg-muted">
                            {gw.address}
                            {gw.info.appName ? ` · ${gw.info.appName}` : ""}
                            {gw.info.appVersion ? ` · ${gw.info.appVersion}` : ""}
                            {gw.info.serial ? ` · S/N ${gw.info.serial}` : ""}
                            {gw.info.mac ? ` · ${gw.info.mac}` : ""}
                          </div>
                        </div>
                        {compatible && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setHost(gw.address)}
                          >
                            Use this IP
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Connect to an IP address</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={handleConnect}>
              <Field label="IP address" htmlFor="connect-host">
                <Input
                  id="connect-host"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="192.168.1.100"
                  autoComplete="off"
                />
              </Field>
              <Field
                label="Password"
                htmlFor="connect-password"
                hint="Sent once to the gateway and kept in memory on the server only — never stored."
              >
                <Input
                  id="connect-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="off"
                />
              </Field>
              <Button size="sm" type="submit" disabled={connecting || !host.trim()}>
                <PlugZap className="h-3.5 w-3.5" aria-hidden />
                {connecting ? "Connecting…" : "Connect"}
              </Button>
              {connectError && (
                <p role="alert" className="text-sm text-error">
                  {connectError}
                </p>
              )}
            </form>
          </CardContent>
        </Card>
      </div>

      {gateways !== null && gateways.length === 0 && !scanning && (
        <Card>
          <CardContent className="flex items-start gap-3">
            <Cable className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
            <p className="text-sm text-fg-muted">
              No gateway on the network — you can keep working with the demo project from the{" "}
              <Link href="/overview" className="font-medium text-hms-accent hover:underline">
                Overview
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
