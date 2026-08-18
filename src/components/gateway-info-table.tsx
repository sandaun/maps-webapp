import type { GatewayInfoSummary } from "@/lib/gateway-api";

/** Read-only rendering of an `INFO?` summary as a definition list. */
export function GatewayInfoTable({ info }: { info: GatewayInfoSummary }) {
  const rows: [string, string | undefined][] = [
    ["Name", info.name],
    ["Serial", info.serial],
    ["Application", info.appName],
    ["AppId", info.appId === undefined ? undefined : String(info.appId)],
    ["Version", info.appVersion],
    ["Platform", info.platform],
    ["IP", info.ip],
    ["Netmask", info.netmask],
    ["Gateway", info.gateway],
    ["DHCP", info.dhcp === undefined ? undefined : info.dhcp ? "On" : "Off"],
    ["MAC", info.mac],
    ["Status", info.status],
  ];
  const visible = rows.filter((row): row is [string, string] => row[1] !== undefined && row[1] !== "");
  if (visible.length === 0 && !info.bootloader && !info.noApp) {
    return <p className="text-sm text-fg-muted">No INFO data reported by the gateway.</p>;
  }
  return (
    <div className="space-y-1.5">
      {(info.bootloader || info.noApp) && (
        <div className="flex flex-wrap gap-1.5 pb-1">
          {info.bootloader && (
            <span className="rounded-full bg-warning-bg px-2 py-0.5 text-[11px] font-medium text-warning-text">
              Bootloader mode
            </span>
          )}
          {info.noApp && (
            <span className="rounded-full bg-error-bg px-2 py-0.5 text-[11px] font-medium text-error">
              No application running
            </span>
          )}
        </div>
      )}
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {visible.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-2">
            <dt className="text-fg-muted">{label}</dt>
            <dd className="font-mono text-xs font-medium text-text-body">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
