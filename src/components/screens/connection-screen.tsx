"use client";

import * as React from "react";
import Link from "next/link";
import { X } from "lucide-react";
import {
  connectGateway,
  connectUsbGateway,
  listGatewaySerialPorts,
  disconnectGateway,
  gatewayFamily,
  queryGatewayInfo,
  scanGateways,
  type DiscoveredGateway,
  type GatewayInfoSummary,
  type GatewaySessionStatus,
  type GatewaySerialPort,
} from "@/lib/gateway-api";
import { FAMILY_LABELS } from "@/lib/project-types";
import { useCurrentProject } from "@/lib/current-project";
import { useGatewaySession } from "@/lib/gateway-session";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal, ModalRow } from "@/components/ui/modal";

/** Intesis factory fallback address once the 30 s power-up DHCP window closes. */
const FACTORY_DEFAULT_IP = "192.168.100.246";
const RECENT_IPS_KEY = "maps-web:recent-gateway-ips";
const RECENT_IPS_LIMIT = 5;

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function isIpv4(value: string): boolean {
  const ip = value.trim();
  return (
    /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) &&
    ip.split(".").every((octet) => Number(octet) <= 255)
  );
}

function readRecentIps(): string[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(RECENT_IPS_KEY) ?? "[]");
    if (!Array.isArray(stored)) return [];
    const ips = stored
      .filter((ip): ip is string => typeof ip === "string" && isIpv4(ip))
      .map((ip) => ip.trim());
    return [...new Set(ips)].slice(0, RECENT_IPS_LIMIT);
  } catch {
    return [];
  }
}

function writeRecentIps(ips: string[]) {
  try {
    window.localStorage.setItem(RECENT_IPS_KEY, JSON.stringify(ips));
  } catch {
    // Recent addresses still work for this visit when browser storage is blocked.
  }
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
    sub: "The default password over IP is admin. Once connected, use Receive in the header to open the configuration stored in the gateway.",
  },
];

export function ConnectionScreen() {
  const { session } = useGatewaySession();
  const { view } = useCurrentProject();

  const [gateways, setGateways] = React.useState<DiscoveredGateway[] | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const [scanError, setScanError] = React.useState<string | null>(null);
  const [selectedAddress, setSelectedAddress] = React.useState<string | null>(null);
  const [scanIp, setScanIp] = React.useState("");
  const [usbOpen, setUsbOpen] = React.useState(false);
  const [usbPorts, setUsbPorts] = React.useState<GatewaySerialPort[]>([]);
  const [usbPath, setUsbPath] = React.useState("");
  const [usbLoading, setUsbLoading] = React.useState(false);
  const [usbError, setUsbError] = React.useState<string | null>(null);

  const [password, setPassword] = React.useState("");
  const [connecting, setConnecting] = React.useState(false);
  const [connectError, setConnectError] = React.useState<string | null>(null);

  const [infoError, setInfoError] = React.useState<string | null>(null);

  const [manualOpen, setManualOpen] = React.useState(false);
  const [manualIp, setManualIp] = React.useState("");
  const [manualPassword, setManualPassword] = React.useState("");
  const [manualError, setManualError] = React.useState<string | null>(null);

  const [recentIps, setRecentIps] = React.useState<string[]>([]);

  const handleScan = React.useCallback(async (target?: string) => {
    if (target && !isIpv4(target)) {
      setScanError(`"${target}" is not a valid IPv4 address.`);
      return;
    }
    setScanning(true);
    setScanError(null);
    try {
      setGateways(await scanGateways(target ? [target] : undefined));
    } catch (err) {
      setGateways([]);
      setScanError(errorMessage(err, "Scan failed"));
    } finally {
      setScanning(false);
    }
  }, []);

  // Auto-scan on mount; deferred like the gateway-session provider's initial load.
  React.useEffect(() => {
    const initial = window.setTimeout(() => {
      setRecentIps(readRecentIps());
      void handleScan();
    }, 0);
    return () => window.clearTimeout(initial);
  }, [handleScan]);

  // The connected gateway is listed even when it did not answer the last scan.
  const rows = React.useMemo(() => {
    const list = [...(gateways ?? [])];
    if (session?.gateway && !list.some((gateway) => gateway.address === session.host)) {
      list.unshift({ address: session.host, info: session.gateway, raw: {}, transport: session.transport });
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
      setInfoError(null);
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
    const host = manualIp.trim();
    if (!isIpv4(host)) {
      setManualError(`"${host}" is not a valid IPv4 address.`);
      return;
    }
    setManualError(null);
    const pw = manualPassword;
    setManualPassword("");
    const error = await connectTo(host, pw);
    if (error) {
      setManualError(error);
    } else {
      updateRecentIps([host, ...recentIps.filter((ip) => ip !== host)].slice(0, RECENT_IPS_LIMIT));
      setManualOpen(false);
      setManualIp("");
      setManualError(null);
    }
  }

  function updateRecentIps(ips: string[]) {
    setRecentIps(ips);
    writeRecentIps(ips);
  }

  async function handleDisconnect() {
    if (!session) return;
    try {
      await disconnectGateway(session.id);
    } catch {
      // A dead session is gone either way.
    }
  }

  async function handleRefreshInfo() {
    if (!session) return;
    setInfoError(null);
    try {
      await queryGatewayInfo(session.id);
    } catch (err) {
      setInfoError(errorMessage(err, "INFO? query failed"));
    }
  }

  async function refreshUsbPorts() {
    setUsbLoading(true);
    setUsbError(null);
    try {
      const result = await listGatewaySerialPorts();
      setUsbPorts(result.ports);
      setUsbPath((current) => result.ports.some((port) => port.path === current)
        ? current : (result.ports[0]?.path ?? ""));
    } catch (error) {
      setUsbError(errorMessage(error, "Could not list USB serial ports"));
    } finally {
      setUsbLoading(false);
    }
  }

  async function handleUsbConnect() {
    setConnecting(true);
    setUsbError(null);
    try {
      const next = await connectUsbGateway(usbPath);
      setSelectedAddress(next.host);
      setInfoError(null);
      setConnectError(null);
      setUsbOpen(false);
    } catch (error) {
      setUsbError(errorMessage(error, "USB connection failed"));
    } finally {
      setConnecting(false);
    }
  }

  const matchCount = rows.filter((gateway) => {
    const info = session?.host === gateway.address ? session.gateway ?? gateway.info : gateway.info;
    const family = gatewayFamily(info, gateway.raw);
    return view ? family === view.family : family !== null;
  }).length;

  return (
    <div className="max-w-[1240px]">
      <div className="grid items-start gap-[14px] lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
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
                className={cn("rounded-[4px] border px-2.5 py-[5px] text-xs font-bold text-hms-blue",
                  session?.transport === "usb" ? "border-border" : "border-info-border bg-info-bg")}
                aria-current={session?.transport === "usb" ? undefined : "true"}
              >
                IP
              </span>
              <button
                type="button"
                onClick={() => { setUsbOpen(true); void refreshUsbPorts(); }}
                disabled={connecting}
                aria-current={session?.transport === "usb" ? "true" : undefined}
                className={cn("rounded-[4px] border px-2.5 py-[5px] text-xs text-hms-blue hover:bg-info-bg",
                  session?.transport === "usb" ? "border-info-border bg-info-bg" : "border-border")}
              >
                USB port
              </button>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="h-auto shrink-0 border-hms-accent px-3 py-[7px] text-[12.5px] font-bold text-hms-accent hover:bg-info-bg"
              onClick={() => void handleScan(scanIp.trim() || undefined)}
              disabled={scanning}
            >
              {scanning ? "Scanning…" : "Scan again"}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-border px-[18px] py-2">
            <label htmlFor="scan-direct-ip" className="text-xs text-fg-muted">Direct IP (optional)</label>
            <Input id="scan-direct-ip" value={scanIp} onChange={(event) => setScanIp(event.target.value)}
              placeholder="192.168.2.167" autoComplete="off" className="w-[150px] font-mono" />
            <p className="text-[11px] text-fg-muted">Use a known IP if discovery does not find the gateway.</p>
          </div>

          <div className="flex bg-table-header px-[18px] py-[7px] font-mono text-[10.5px] font-semibold uppercase tracking-[.06em] text-fg-muted">
            <span className="w-[26px] shrink-0" />
            <span className="min-w-0 flex-1 overflow-hidden pr-2.5">Gateway</span>
            <span className="w-[118px] shrink-0 overflow-hidden">Address · FW</span>
          </div>

          <div className="h-[clamp(16rem,50dvh,32rem)] flex-none overflow-auto">
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
                    : "No gateway answered the discovery broadcast. Enter a known Direct IP and scan again, or connect manually."}
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
                : `${rows.length} gateway${rows.length === 1 ? "" : "s"} found · ${matchCount} ${view ? `template match${matchCount === 1 ? "" : "es"}` : "supported"}`}
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

        {/* ---------- Selected gateway + help ---------- */}
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
                infoError={infoError}
                onConnect={() => void handleConnect()}
                onDisconnect={() => void handleDisconnect()}
                onRefreshInfo={() => void handleRefreshInfo()}
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
            <div className="mt-4 border-t border-border pt-3">
              <Link href="/diagnostics" className="text-xs font-bold text-hms-accent hover:underline">
                Open Diagnostics →
              </Link>
            </div>
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
        </div>
      </div>

      {usbOpen ? (
        <Modal
          title="Connect over USB"
          description="Connect the gateway's USB console cable and select its serial port."
          foot="No password is required over USB."
          ctaLabel={connecting ? "Connecting…" : "Connect"}
          ctaDisabled={connecting || usbLoading || !usbPath}
          onConfirm={() => void handleUsbConnect()}
          onClose={() => setUsbOpen(false)}
        >
          <ModalRow label="Serial port" hint="USB console">
            <Select
              aria-label="USB serial port"
              value={usbPath}
              onValueChange={setUsbPath}
              options={usbPorts.map((port) => ({
                value: port.path,
                label: `${port.path}${port.manufacturer ? ` · ${port.manufacturer}` : ""}`,
              }))}
              placeholder={usbLoading ? "Loading…" : "No serial ports found"}
              disabled={usbLoading || connecting || usbPorts.length === 0}
              className="w-[260px] max-w-[65%] shrink-0 font-mono"
            />
          </ModalRow>
          <div className="mt-3 flex items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              disabled={usbLoading || connecting}
              onClick={() => void refreshUsbPorts()}
            >
              {usbLoading ? "Refreshing…" : "Refresh ports"}
            </Button>
            <span className="text-[11px] text-fg-subtle">Ports on the computer running MAPS Web</span>
          </div>
          <p className="mt-3 text-[11.5px] leading-[1.45] text-fg-muted">
            Use the USB console port, not the USB host port for flash drives.
            Close desktop MAPS or other software using the selected port.
          </p>
          {usbError ? (
            <p role="alert" className="mt-3 rounded border border-error-border bg-error-bg px-3 py-2 text-xs text-error">
              {usbError}
            </p>
          ) : null}
        </Modal>
      ) : null}

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
                disabled={connecting}
                autoComplete="off"
                autoFocus
                aria-label="IP address"
                className="w-[190px] font-mono"
              />
            </ModalRow>
            {recentIps.length > 0 ? (
              <div className="border-b border-row-rule py-[9px]">
                <p className="mb-2 text-[11px] text-fg-muted">Recent IP addresses</p>
                <ul className="flex flex-wrap gap-2" aria-label="Recent IP addresses">
                  {recentIps.map((ip) => (
                    <li key={ip} className="flex overflow-hidden rounded border border-border">
                      <button
                        type="button"
                        className="px-2 py-1 font-mono text-xs text-hms-accent hover:bg-info-bg disabled:opacity-50"
                        disabled={connecting}
                        aria-label={`Use IP address ${ip}`}
                        onClick={() => {
                          setManualIp(ip);
                          setManualError(null);
                        }}
                      >
                        {ip}
                      </button>
                      <button
                        type="button"
                        className="border-l border-border px-1.5 text-fg-muted hover:bg-row-hover disabled:opacity-50"
                        disabled={connecting}
                        aria-label={`Remove IP address ${ip}`}
                        onClick={() => updateRecentIps(recentIps.filter((recent) => recent !== ip))}
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <ModalRow label="Port" hint="MAPS control port">
              <span className="font-mono text-[12.5px] text-hms-blue">23</span>
            </ModalRow>
            <ModalRow label="Password" hint="Default admin">
              <Input
                type="password"
                value={manualPassword}
                disabled={connecting}
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
  infoError,
  onConnect,
  onDisconnect,
  onRefreshInfo,
}: {
  gateway: DiscoveredGateway;
  /** Live session when this gateway is the connected one, else null. */
  session: GatewaySessionStatus | null;
  password: string;
  onPasswordChange: (value: string) => void;
  connecting: boolean;
  connectError: string | null;
  infoError: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefreshInfo: () => void;
}) {
  const { view } = useCurrentProject();
  // Once connected, the session carries the fresher INFO? summary.
  const info: GatewayInfoSummary = session?.gateway ?? gateway.info;
  const family = gatewayFamily(info, gateway.raw);
  const templateMatch = view !== null && family === view.family;
  const connected = session?.connected ?? false;

  const rows: DetailRow[] = [
    { k: gateway.transport === "usb" ? "USB port" : "IP address", v: gateway.address, tone: "accent" },
    {
      k: "Protocols",
      v: family ? FAMILY_LABELS[family] : (info.appName ?? "Unknown"),
      tone: "muted",
    },
    { k: "Firmware", v: info.appVersion ?? "—", tone: "muted" },
    {
      k: "Template match",
      v: view ? (templateMatch ? "Match" : "No match") : "No project open",
      tone: view ? (templateMatch ? "success" : "warning") : "muted",
    },
    ...(info.dhcp !== undefined
      ? [{ k: "Addressing", v: info.dhcp ? "DHCP" : "static", tone: "muted" as RowTone }]
      : []),
    ...(info.mac ? [{ k: "MAC", v: info.mac, tone: "muted" as RowTone }] : []),
    ...(session
      ? [
          {
            k: "Session",
            v: `${session.transport === "usb" ? "USB console" : (session.encrypted ? "Encrypted" : "Cleartext fallback")} · since ${formatTime(session.connectedAt)}`,
            tone: (session.transport === "usb" || session.encrypted ? "success" : "warning") as RowTone,
          },
        ]
      : []),
  ];

  const warnings: string[] = [];
  if (!family) {
    warnings.push(
      "This gateway runs a protocol combination this app does not support. You can connect to inspect it, but projects cannot be sent to or received from it.",
    );
  } else if (view && !templateMatch) {
    warnings.push(
      `This gateway does not match the open project's template (${FAMILY_LABELS[view.family]}). You can connect to inspect it or receive its configuration as another project.`,
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
      {infoError ? (
        <p role="alert" className="mt-3 rounded border border-error-border bg-error-bg px-3 py-2 text-xs text-error">
          {infoError}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-[9px]">
        {session ? (
          <>
            <Button className="bg-hms-marine hover:bg-hms-marine/90" onClick={onDisconnect}>
              Disconnect
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
