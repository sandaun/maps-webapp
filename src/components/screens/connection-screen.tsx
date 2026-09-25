"use client";

import * as React from "react";
import {
  connectGateway,
  disconnectGateway,
  gatewayFamily,
  queryGatewayInfo,
  receiveGatewayProject,
  scanGateways,
  type DiscoveredGateway,
  type GatewayInfoSummary,
  type GatewaySessionStatus,
} from "@/lib/gateway-api";
import { FAMILY_LABELS } from "@/lib/project-types";
import { useCurrentProject } from "@/lib/current-project";
import { useGatewaySession } from "@/lib/gateway-session";
import { useSessionEvents, type TransferProgress } from "@/lib/use-session-events";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal, ModalRow } from "@/components/ui/modal";
import { TransferProgressBar } from "@/components/session-log";

/** Intesis factory fallback address once the 30 s power-up DHCP window closes. */
const FACTORY_DEFAULT_IP = "192.168.100.246";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function isIpv4(value: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value.trim());
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleTimeString("en-GB", { hour12: false });
}

type RowTone = "accent" | "muted" | "success" | "error" | "warning";

const TONE_CLASS: Record<RowTone, string> = {
  accent: "text-hms-blue",
  muted: "text-fg-muted",
  success: "text-success",
  error: "text-error",
  warning: "text-warning",
};

interface DetailRow {
  k: string;
  v: string;
  tone: RowTone;
}

const HOW_TO_STEPS = [
  {
    title: "Cable the gateway",
    sub: "Ethernet CAT5 or higher on the gateway's Ethernet port, on the same subnet as this computer.",
  },
  {
    title: "Scan the network",
    sub: "Broadcast discovery finds Intesis gateways on the local subnet. If nothing answers, connect to an IP address manually.",
  },
  {
    title: "Select the gateway",
    sub: "Names in red run a protocol combination this app does not support.",
  },
  {
    title: "Connect",
    sub: "The default password over IP is admin. Once connected you can receive the configuration stored in the gateway.",
  },
];

export function ConnectionScreen() {
  const { setProjectId } = useCurrentProject();
  const { session } = useGatewaySession();

  const [gateways, setGateways] = React.useState<DiscoveredGateway[] | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const [scanError, setScanError] = React.useState<string | null>(null);
  const [selectedAddress, setSelectedAddress] = React.useState<string | null>(null);

  const [password, setPassword] = React.useState("");
  const [connecting, setConnecting] = React.useState(false);
  const [connectError, setConnectError] = React.useState<string | null>(null);

  const [receiving, setReceiving] = React.useState(false);
  const [receiveError, setReceiveError] = React.useState<string | null>(null);
  const [receivedName, setReceivedName] = React.useState<string | null>(null);

  const [manualOpen, setManualOpen] = React.useState(false);
  const [manualIp, setManualIp] = React.useState("");
  const [manualPassword, setManualPassword] = React.useState("");
  const [manualError, setManualError] = React.useState<string | null>(null);

  const [logClearedAt, setLogClearedAt] = React.useState<string | null>(null);

  const { log, progress } = useSessionEvents(session?.id ?? null);

  const handleScan = React.useCallback(async () => {
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
  }, []);

  // Auto-scan on mount; deferred like the gateway-session provider's initial load.
  React.useEffect(() => {
    const initial = window.setTimeout(() => void handleScan(), 0);
    return () => window.clearTimeout(initial);
  }, [handleScan]);

  // The connected gateway is listed even when it did not answer the last scan.
  const rows = React.useMemo(() => {
    const list = [...(gateways ?? [])];
    if (session?.gateway && !list.some((gateway) => gateway.address === session.host)) {
      list.unshift({ address: session.host, info: session.gateway, raw: {} });
    }
    return list;
  }, [gateways, session]);

  const selected =
    rows.find((gateway) => gateway.address === selectedAddress) ??
    rows.find((gateway) => gateway.address === session?.host) ??
    rows[0] ??
    null;

  const connectedHere =
    selected !== null && session !== null && session.host === selected.address;

  /** Returns null on success, the error message on failure. */
  async function connectTo(host: string, pw: string): Promise<string | null> {
    setConnecting(true);
    setConnectError(null);
    try {
      const next = await connectGateway(host, pw);
      setSelectedAddress(next.host);
      setReceivedName(null);
      setReceiveError(null);
      return null;
    } catch (err) {
      return errorMessage(err, "Connection failed");
    } finally {
      setConnecting(false);
    }
  }

  async function handleConnect() {
    if (!selected) return;
    // The password lives only in this state; clear it right after the attempt.
    const pw = password;
    setPassword("");
    setConnectError(await connectTo(selected.address, pw));
  }

  async function handleManualConnect() {
    if (!isIpv4(manualIp)) {
      setManualError(`"${manualIp.trim()}" is not a valid IPv4 address.`);
      return;
    }
    const pw = manualPassword;
    setManualPassword("");
    const error = await connectTo(manualIp.trim(), pw);
    if (error) {
      setManualError(error);
    } else {
      setManualOpen(false);
      setManualIp("");
      setManualError(null);
    }
  }

  async function handleDisconnect() {
    if (!session) return;
    try {
      await disconnectGateway(session.id);
    } catch {
      // A dead session is gone either way.
    }
    setReceivedName(null);
  }

  async function handleRefreshInfo() {
    if (!session) return;
    try {
      await queryGatewayInfo(session.id);
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
      // Includes the server-side rejection of unsupported project families.
      setReceiveError(errorMessage(err, "Receive failed"));
    } finally {
      setReceiving(false);
    }
  }

  const visibleLog = logClearedAt ? log.filter((entry) => entry.at > logClearedAt) : log;
  const compatibleCount = rows.filter((gateway) => gatewayFamily(gateway.info, gateway.raw)).length;

  return (
    <div className="max-w-[1240px]">
      <div className="grid gap-[14px] lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        {/* ---------- Discovered gateways ---------- */}
        <Card className="flex flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-[18px] py-[14px]">
            <div className="min-w-[210px] flex-1">
              <h2 className="font-display text-[17px] font-light text-hms-blue">
                Discovered gateways
              </h2>
              <p className="mt-0.5 text-[12.5px] text-fg-muted">
                Broadcast discovery on the local subnet · UDP 23
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="text-xs text-fg-muted">Connection type</span>
              <span
                className="rounded-[4px] border border-info-border bg-info-bg px-2.5 py-[5px] text-xs font-bold text-hms-blue"
                aria-current="true"
              >
                IP
              </span>
              <span
                title="USB console connection is not supported yet"
                className="cursor-not-allowed rounded-[4px] border border-border px-2.5 py-[5px] text-xs text-fg-muted opacity-60"
              >
                USB port
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="h-auto shrink-0 border-hms-accent px-3 py-[7px] text-[12.5px] font-bold text-hms-accent hover:bg-info-bg"
              onClick={() => void handleScan()}
              disabled={scanning}
            >
              {scanning ? "Scanning…" : "Scan again"}
            </Button>
          </div>

          <div className="flex bg-table-header px-[18px] py-[7px] font-mono text-[10.5px] font-semibold uppercase tracking-[.06em] text-fg-muted">
            <span className="w-[26px] shrink-0" />
            <span className="min-w-0 flex-1 overflow-hidden pr-2.5">Gateway</span>
            <span className="w-[118px] shrink-0 overflow-hidden">Address · FW</span>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {scanError ? (
              <p role="alert" className="mx-[18px] mt-3 rounded border border-error-border bg-error-bg px-3 py-2 text-xs text-error">
                {scanError}
              </p>
            ) : null}
            {rows.map((gateway) => {
              const on = selected?.address === gateway.address;
              const family = gatewayFamily(gateway.info, gateway.raw);
              const live = session?.host === gateway.address && session.connected;
              return (
                <button
                  key={gateway.address}
                  type="button"
                  aria-pressed={on}
                  className={cn(
                    "flex w-full items-center border-b border-row-rule px-[18px] py-3 text-left last:border-b-0 hover:bg-row-hover",
                    on && "bg-row-hover",
                  )}
                  onClick={() => setSelectedAddress(gateway.address)}
                >
                  <span className="flex w-[26px] shrink-0 items-center">
                    <span
                      className={cn(
                        "size-3 rounded-full bg-white",
                        on ? "border-4 border-hms-accent" : "border-[1.5px] border-border-strong",
                      )}
                    />
                  </span>
                  <span className="min-w-0 flex-1 pr-[14px]">
                    <span
                      className={cn(
                        "block truncate text-[13px] font-bold leading-[1.3]",
                        family ? "text-hms-blue" : "text-error",
                      )}
                    >
                      {gateway.info.name ?? "Intesis gateway"}
                      {live ? <span className="sr-only"> (connected)</span> : null}
                    </span>
                    <span className="mt-[3px] block truncate whitespace-nowrap font-mono text-[11px] text-fg-subtle">
                      {gateway.info.platform ?? gateway.info.appName ?? "Intesis gateway"}
                      {gateway.info.serial ? ` · S/N ${gateway.info.serial}` : ""}
                    </span>
                  </span>
                  <span className="w-[118px] min-w-0 shrink-0">
                    <span className="block truncate font-mono text-[11.5px] text-hms-blue">
                      {gateway.address}
                    </span>
                    <span className="mt-[3px] block font-mono text-[10.5px] text-fg-subtle">
                      {gateway.info.appVersion ?? ""}
                    </span>
                  </span>
                </button>
              );
            })}
            {rows.length === 0 && !scanning && !scanError ? (
              <div className="px-[26px] py-11 text-center">
                <p className="mx-auto max-w-[340px] text-[13px] leading-[1.6] text-fg-muted">
                  {gateways === null
                    ? "Not scanned yet. Run a scan to find Intesis gateways on this network."
                    : "No gateway answered the discovery broadcast. Check the cabling, or connect directly to an IP address."}
                </p>
                <Button className="mt-[14px]" onClick={() => void handleScan()}>
                  Scan the network
                </Button>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-3 border-t border-border px-[18px] py-[9px] text-[11.5px] text-fg-muted">
            <span>
              {gateways === null
                ? "Not scanned yet"
                : `${rows.length} gateways found · ${compatibleCount} compatible`}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              className="text-xs font-bold text-hms-accent hover:underline"
              onClick={() => setManualOpen(true)}
            >
              Connect to an IP address manually →
            </button>
          </div>
        </Card>

        {/* ---------- Selected gateway + help + log ---------- */}
        <div className="flex flex-col gap-[14px]">
          <Card className="px-[18px] py-4">
            {selected ? (
              <SelectedGateway
                gateway={selected}
                session={connectedHere ? session : null}
                password={password}
                onPasswordChange={setPassword}
                connecting={connecting}
                connectError={connectError}
                receiving={receiving}
                receiveError={receiveError}
                receivedName={receivedName}
                progress={progress}
                onConnect={() => void handleConnect()}
                onDisconnect={() => void handleDisconnect()}
                onRefreshInfo={() => void handleRefreshInfo()}
                onReceive={() => void handleReceive()}
              />
            ) : (
              <>
                <h2 className="font-display text-[15px] font-light text-hms-blue">
                  No gateway selected
                </h2>
                <p className="mt-2 text-[11.5px] leading-[1.6] text-fg-muted">
                  Scan the network and pick a gateway, or connect to an IP address manually.
                </p>
              </>
            )}
          </Card>

          <Card className="px-[18px] py-4">
            <h2 className="mb-[11px] font-display text-[15px] font-light text-hms-blue">
              How to connect
            </h2>
            <ol>
              {HOW_TO_STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-2.5 border-t border-border py-2">
                  <span className="flex size-[19px] shrink-0 items-center justify-center rounded-full bg-info-bg font-mono text-[10.5px] font-semibold text-hms-accent">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-bold text-hms-blue">{step.title}</span>
                    <span className="block text-[11.5px] leading-[1.45] text-fg-muted">
                      {step.sub}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>

          <Card className="px-[18px] py-4">
            <div className="mb-[11px] flex items-center">
              <h2 className="flex-1 font-display text-[15px] font-light text-hms-blue">
                Connection log
              </h2>
              <button
                type="button"
                className="text-[11.5px] text-hms-accent hover:underline disabled:pointer-events-none disabled:opacity-50"
                disabled={visibleLog.length === 0}
                onClick={() => setLogClearedAt(new Date().toISOString())}
              >
                Clear
              </button>
            </div>
            <div className="max-h-40 overflow-auto">
              {visibleLog.length === 0 ? (
                <p className="font-mono text-[11px] text-fg-subtle">
                  No activity yet — connect to a gateway to see the conversation.
                </p>
              ) : (
                visibleLog.map((entry, index) => (
                  <div
                    key={index}
                    className="flex gap-[9px] border-t border-row-rule py-[5px] font-mono text-[11px] leading-[1.5]"
                  >
                    <span className="shrink-0 text-fg-subtle">{formatTime(entry.at)}</span>
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-text-body">
                      {entry.line}
                    </span>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>

      {manualOpen ? (
        <Modal
          title="Connect to an IP address"
          description="Use this when the gateway is on another subnet and does not answer the discovery broadcast."
          foot="The gateway must be reachable from this computer"
          ctaLabel={connecting ? "Connecting…" : "Connect"}
          ctaDisabled={connecting || !manualIp.trim()}
          onConfirm={() => void handleManualConnect()}
          onClose={() => {
            setManualOpen(false);
            setManualError(null);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleManualConnect();
            }}
          >
            <ModalRow label="IP address" hint="Fixed address of the gateway">
              <Input
                value={manualIp}
                onChange={(event) => setManualIp(event.target.value)}
                placeholder={FACTORY_DEFAULT_IP}
                autoComplete="off"
                autoFocus
                aria-label="IP address"
                className="w-[190px] font-mono"
              />
            </ModalRow>
            <ModalRow label="Port" hint="MAPS control port">
              <span className="font-mono text-[12.5px] text-hms-blue">23</span>
            </ModalRow>
            <ModalRow label="Password" hint="Default admin">
              <Input
                type="password"
                value={manualPassword}
                onChange={(event) => setManualPassword(event.target.value)}
                autoComplete="off"
                aria-label="Password"
                className="w-[190px] font-mono"
              />
            </ModalRow>
            {manualError ? (
              <p role="alert" className="mt-3 rounded border border-error-border bg-error-bg px-3 py-2 text-xs text-error">
                {manualError}
              </p>
            ) : null}
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

function SelectedGateway({
  gateway,
  session,
  password,
  onPasswordChange,
  connecting,
  connectError,
  receiving,
  receiveError,
  receivedName,
  progress,
  onConnect,
  onDisconnect,
  onRefreshInfo,
  onReceive,
}: {
  gateway: DiscoveredGateway;
  /** Live session when this gateway is the connected one, else null. */
  session: GatewaySessionStatus | null;
  password: string;
  onPasswordChange: (value: string) => void;
  connecting: boolean;
  connectError: string | null;
  receiving: boolean;
  receiveError: string | null;
  receivedName: string | null;
  progress: TransferProgress | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefreshInfo: () => void;
  onReceive: () => void;
}) {
  const family = gatewayFamily(gateway.info, gateway.raw);
  // Once connected, the session carries the fresher INFO? summary.
  const info: GatewayInfoSummary = session?.gateway ?? gateway.info;
  const connected = session?.connected ?? false;

  const rows: DetailRow[] = [
    { k: "IP address", v: gateway.address, tone: "accent" },
    {
      k: "Protocols",
      v: family ? FAMILY_LABELS[family] : (info.appName ?? "Unknown"),
      tone: "muted",
    },
    { k: "Firmware", v: info.appVersion ?? "—", tone: "muted" },
    {
      k: "Template match",
      v: family ? "compatible" : "not compatible",
      tone: family ? "success" : "error",
    },
    ...(info.dhcp !== undefined
      ? [{ k: "Addressing", v: info.dhcp ? "DHCP" : "static", tone: "muted" as RowTone }]
      : []),
    ...(info.mac ? [{ k: "MAC", v: info.mac, tone: "muted" as RowTone }] : []),
    ...(session
      ? [
          {
            k: "Session",
            v: `${session.encrypted ? "Encrypted" : "Cleartext fallback"} · since ${formatTime(session.connectedAt)}`,
            tone: (session.encrypted ? "success" : "warning") as RowTone,
          },
        ]
      : []),
  ];

  const warnings: string[] = [];
  if (!family) {
    warnings.push(
      "This gateway runs a protocol combination this app does not support. You can connect to inspect it, but projects cannot be sent to or received from it.",
    );
  }
  if (info.bootloader) {
    warnings.push("The gateway is in bootloader mode — only a firmware update is possible.");
  }
  if (info.noApp) {
    warnings.push("The gateway has no application running — send a project before using it.");
  }
  if (gateway.address === FACTORY_DEFAULT_IP) {
    warnings.push(
      "This gateway still has the factory default address. DHCP is enabled for 30 seconds at power-up; after that the gateway falls back to 192.168.100.246.",
    );
  }

  return (
    <>
      <div className="mb-[14px] flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[17px] font-light text-hms-blue">
            {info.name ?? "Intesis gateway"}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-fg-muted">
            {info.platform ?? info.appName ?? "Intesis gateway"}
            {info.serial ? ` · S/N ${info.serial}` : ""}
          </p>
        </div>
        {session ? (
          connected ? (
            <Badge variant="success" className="border-success-border">
              connected
            </Badge>
          ) : (
            <Badge variant="warning" className="border-warning-border">
              connection lost
            </Badge>
          )
        ) : family ? (
          <Badge className="border-info-border bg-info-bg text-hms-accent">available</Badge>
        ) : (
          <Badge variant="error" className="border-error-border">
            incompatible family
          </Badge>
        )}
      </div>

      <dl>
        {rows.map((row) => (
          <div
            key={row.k}
            className="flex items-start gap-3 border-t border-row-rule py-2"
          >
            <dt className="w-[104px] shrink-0 pt-px text-[12.5px] text-fg-muted">{row.k}</dt>
            <dd
              className={cn(
                "min-w-0 flex-1 break-words text-right font-mono text-[12.5px] leading-[1.45]",
                TONE_CLASS[row.tone],
              )}
            >
              {row.v}
            </dd>
          </div>
        ))}
      </dl>

      {!session ? (
        <>
          <div className="flex items-center gap-3 border-t border-row-rule pb-1 pt-2.5">
            <label htmlFor="connect-password" className="flex-1 text-[12.5px] text-fg-muted">
              Password
            </label>
            <Input
              id="connect-password"
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder="admin"
              autoComplete="off"
              className="w-[150px] font-mono"
            />
          </div>
          <p className="pb-1 text-[11px] leading-[1.45] text-fg-subtle">
            The default password when connecting over IP is <b>admin</b>. No password is needed over
            USB.
          </p>
        </>
      ) : null}

      {warnings.map((warning) => (
        <div
          key={warning}
          className="mt-3 rounded-[5px] border border-warning-border bg-warning-bg px-3 py-2.5 text-xs leading-[1.5] text-warning-text"
        >
          {warning}
        </div>
      ))}

      {connectError ? (
        <p role="alert" className="mt-3 rounded border border-error-border bg-error-bg px-3 py-2 text-xs text-error">
          {connectError}
        </p>
      ) : null}
      {receiveError ? (
        <p role="alert" className="mt-3 rounded border border-error-border bg-error-bg px-3 py-2 text-xs text-error">
          {receiveError}
        </p>
      ) : null}
      {receivedName ? (
        <p className="mt-3 text-[12.5px] text-success">
          Received “{receivedName}” — it is now the current project.
        </p>
      ) : null}

      {receiving && progress ? (
        <div className="mt-3">
          <TransferProgressBar progress={progress} />
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-[9px]">
        {session ? (
          <>
            <Button className="bg-hms-marine hover:bg-hms-marine/90" onClick={onDisconnect}>
              Disconnect
            </Button>
            <Button
              variant="secondary"
              onClick={onReceive}
              disabled={receiving || session.busy || !connected}
            >
              {receiving ? "Receiving…" : "Receive project"}
            </Button>
            <Button
              variant="secondary"
              onClick={onRefreshInfo}
              disabled={session.busy || !connected}
            >
              Refresh INFO
            </Button>
          </>
        ) : (
          <Button onClick={onConnect} disabled={connecting}>
            {connecting ? "Connecting…" : "Connect"}
          </Button>
        )}
      </div>
    </>
  );
}
