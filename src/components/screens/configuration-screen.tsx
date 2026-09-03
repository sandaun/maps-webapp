"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { formatPhysicalAddress, parsePhysicalAddress } from "@/protocols/knx/address";
import { BAUD_RATES, COMM_ERROR_TOUT_RANGE, SLAVE_ID_RANGE } from "@/protocols/modbus/slave";
import { BYTE_ORDER_LABELS } from "@/protocols/modbus/master/types";
import { FAMILY_LABELS, type FamilyId, type ProjectView } from "@/lib/project-types";
import { useSave } from "@/lib/use-save";
import { ScreenGate, ScreenIssues } from "@/components/screens/screen-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type SectionKey = "general" | "network" | "bms" | "device" | "conv";

const SECTION_LABELS: Record<SectionKey, string> = {
  general: "General",
  network: "Network & time",
  bms: "BMS",
  device: "Device",
  conv: "Conversions",
};

function sectionsFor(family: FamilyId): { key: SectionKey; label: string }[] {
  return [
    { key: "general", label: SECTION_LABELS.general },
    { key: "network", label: SECTION_LABELS.network },
    { key: "bms", label: family === "knx-mbm" ? "BMS · KNX" : "BMS · Modbus server" },
    { key: "device", label: family === "knx-mbm" ? "Modbus Master" : "Mitsubishi Electric" },
    { key: "conv", label: SECTION_LABELS.conv },
  ];
}

export function ConfigurationScreen() {
  return (
    <ScreenGate>
      {(view) => <ConfigurationWorkspace key={view.meta.updatedAt} view={view} />}
    </ScreenGate>
  );
}

function ConfigurationWorkspace({ view }: { view: ProjectView }) {
  const sections = sectionsFor(view.family);
  const [section, setSection] = React.useState<SectionKey>("general");
  const [query, setQuery] = React.useState("");
  const shown = sections.filter((s) => s.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="-m-6 flex min-h-full">
      {/* ---------- section rail (V10) ---------- */}
      <aside className="w-[236px] shrink-0 border-r border-border bg-white px-3 py-4">
        <div className="relative mb-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search settings"
            aria-label="Search settings"
            className="w-full rounded-[4px] border border-border bg-[#FBFBFC] py-[7px] pl-[28px] pr-[9px] text-[12.5px] focus-visible:outline-2 focus-visible:outline-hms-accent"
          />
          <Search className="pointer-events-none absolute left-[8px] top-[9px] size-[13px] text-fg-subtle" />
        </div>
        {shown.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSection(s.key)}
            className={cn(
              "mb-[2px] flex w-full cursor-pointer items-center gap-2 rounded-[4px] px-[10px] py-2 text-left text-[12.5px]",
              section === s.key ? "bg-[#EAF3FB] font-bold text-hms-blue" : "font-normal text-fg-muted",
            )}
          >
            <span className="flex-1">{s.label}</span>
          </button>
        ))}
      </aside>

      {/* ---------- section content ---------- */}
      <div className="min-w-0 flex-1">
        <div className="max-w-[900px] px-[26px] pb-10 pt-[22px]">
          <ScreenIssues issues={view.issues} screen="configuration" />
          {section === "general" && <GeneralSection view={view} />}
          {section === "network" && <NetworkSection view={view} />}
          {section === "bms" &&
            (view.family === "knx-mbm" ? (
              <BmsKnxSection view={view} />
            ) : (
              <BmsMbsSection view={view} />
            ))}
          {section === "device" &&
            (view.family === "knx-mbm" ? (
              <DeviceMbmSection view={view} />
            ) : (
              <DeviceMeSection view={view} />
            ))}
          {section === "conv" && <ConversionsSection view={view} />}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * V10 building blocks: section header, group card, field rows and controls.
 * ------------------------------------------------------------------------- */

function SectionHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <>
      <h2 className="mb-1 font-display text-[22px] font-normal text-hms-blue">{title}</h2>
      <p className="mb-[22px] max-w-[600px] text-[13px] leading-[1.55] text-fg-muted">{desc}</p>
    </>
  );
}

function GroupCard({
  label,
  tag,
  tagTone = "warning",
  action,
  children,
}: {
  label: string;
  tag?: string;
  tagTone?: "warning" | "info";
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4 overflow-hidden rounded-lg border border-border bg-white">
      <header className="flex items-center gap-[9px] border-b border-border bg-[#FCFCFD] px-4 py-3">
        <h3 className="text-[13px] font-bold text-hms-blue">{label}</h3>
        {tag && (
          <span
            className={cn(
              "inline-flex items-center whitespace-nowrap rounded-full border px-[7px] py-[2px] text-[11px] font-bold",
              tagTone === "warning"
                ? "border-warning-border bg-warning-bg text-warning-text"
                : "border-[#C9DEF0] bg-[#EAF3FB] text-hms-accent",
            )}
          >
            {tag}
          </span>
        )}
        {action && <div className="ml-auto">{action}</div>}
      </header>
      <div className="px-4 pb-[14px] pt-[6px]">{children}</div>
    </section>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 border-b border-[#F2F3F4] py-[11px]">
      <div className="w-[210px] shrink-0 pt-[5px]">
        <div className="text-[12.5px] font-bold text-text-body">{label}</div>
        {hint && <div className="mt-[2px] text-[11px] leading-[1.45] text-fg-subtle">{hint}</div>}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function TextControl({
  id,
  value,
  onChange,
  width = 240,
  unit,
  mono,
  disabled,
  maxLength,
  type,
  min,
  max,
}: {
  id: string;
  value: string | number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  width?: number;
  unit?: string;
  mono?: boolean;
  disabled?: boolean;
  maxLength?: number;
  type?: string;
  min?: number;
  max?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type={type}
        value={value}
        disabled={disabled}
        maxLength={maxLength}
        min={min}
        max={max}
        onChange={onChange}
        style={{ width }}
        className={cn("h-auto rounded-[4px] px-[9px] py-[6px] text-[12.5px]", mono && "font-mono")}
      />
      {unit && <span className="font-mono text-[11.5px] text-fg-subtle">{unit}</span>}
    </div>
  );
}

function SelectControl({
  id,
  value,
  onChange,
  children,
}: {
  id: string;
  value: string | number;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <Select
      id={id}
      value={value}
      onChange={onChange}
      className="h-auto w-auto min-w-[220px] rounded-[4px] px-[9px] py-[6px] text-[12.5px]"
    >
      {children}
    </Select>
  );
}

function ToggleControl({
  label,
  checked,
  onToggle,
  disabled,
}: {
  label: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-[10px] py-[3px]">
      <Switch checked={checked} onCheckedChange={onToggle} aria-label={label} disabled={disabled} />
      <span className="text-[12px] text-fg-muted">{checked ? "Enabled" : "Disabled"}</span>
    </div>
  );
}

function ReadOnly({ value }: { value: string }) {
  return <div className="py-[6px] font-mono text-[12.5px] text-hms-blue">{value}</div>;
}

function SaveRow({
  dirty,
  busy,
  error,
  onSave,
}: {
  dirty: boolean;
  busy: boolean;
  error: string | null;
  onSave: () => void;
}) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <Button size="sm" disabled={!dirty || busy} onClick={onSave}>
        Save
      </Button>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Sections
 * ------------------------------------------------------------------------- */

function GeneralSection({ view }: { view: ProjectView }) {
  const { save, busy, error } = useSave();
  const [name, setName] = React.useState(view.project.name);
  const [description, setDescription] = React.useState(view.project.description);
  const dirty = name !== view.project.name || description !== view.project.description;

  return (
    <>
      <SectionHeader
        title="General"
        desc="Identification of the project and of the gateway it is bound to."
      />
      <GroupCard label="Project">
        <FieldRow label="Project name" hint="Shown across the workspace (max 32 characters)">
          <TextControl
            id="cfg-name"
            value={name}
            maxLength={32}
            width={300}
            onChange={(e) => setName(e.target.value)}
          />
        </FieldRow>
        <FieldRow label="Description" hint="Optional project description (max 255 characters)">
          <TextControl
            id="cfg-desc"
            value={description}
            maxLength={255}
            width={300}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FieldRow>
        <FieldRow label="Template">
          <ReadOnly value={FAMILY_LABELS[view.family]} />
        </FieldRow>
      </GroupCard>
      <SaveRow
        dirty={dirty}
        busy={busy}
        error={error}
        onSave={() => void save([{ type: "setGeneralInfo", name, description }])}
      />
    </>
  );
}

function NetworkSection({ view }: { view: ProjectView }) {
  const { save, busy, error } = useSave();
  const gw = view.project.gateway;
  const [name, setName] = React.useState(gw.name);
  const [ip, setIp] = React.useState(gw.ip);
  const [netmask, setNetmask] = React.useState(gw.netmask);
  const [gateway, setGateway] = React.useState(gw.gateway);
  const [dhcp, setDhcp] = React.useState(gw.dhcp);
  const dirty =
    name !== gw.name || ip !== gw.ip || netmask !== gw.netmask || gateway !== gw.gateway || dhcp !== gw.dhcp;

  return (
    <>
      <SectionHeader
        title="Network & time"
        desc="Gateway addressing on the building network. Changing the IP address requires a reboot."
      />
      <GroupCard label="Ethernet" tag="reboot required">
        <FieldRow label="Gateway name" hint="Shown in the workspace header and the project list">
          <TextControl
            id="cfg-gw-name"
            value={name}
            maxLength={32}
            width={300}
            onChange={(e) => setName(e.target.value)}
          />
        </FieldRow>
        <FieldRow label="IP address" hint="Static address on the building network">
          <TextControl
            id="cfg-gw-ip"
            value={ip}
            disabled={dhcp}
            width={190}
            mono
            onChange={(e) => setIp(e.target.value)}
          />
        </FieldRow>
        <FieldRow label="Subnet mask">
          <TextControl
            id="cfg-gw-netmask"
            value={netmask}
            disabled={dhcp}
            width={190}
            mono
            onChange={(e) => setNetmask(e.target.value)}
          />
        </FieldRow>
        <FieldRow label="Default gateway" hint="Needed to reach devices on another subnet">
          <TextControl
            id="cfg-gw-gateway"
            value={gateway}
            disabled={dhcp}
            width={190}
            mono
            onChange={(e) => setGateway(e.target.value)}
          />
        </FieldRow>
        <FieldRow label="DHCP" hint="Use this option on networks with a DHCP server">
          <ToggleControl label="DHCP" checked={dhcp} onToggle={setDhcp} />
        </FieldRow>
      </GroupCard>
      <SaveRow
        dirty={dirty}
        busy={busy}
        error={error}
        onSave={() => void save([{ type: "setGatewayInfo", name, ip, netmask, gateway, dhcp }])}
      />
    </>
  );
}

function BmsKnxSection({ view }: { view: Extract<ProjectView, { family: "knx-mbm" }> }) {
  const { save, busy, error } = useSave();
  const knx = view.project.knx;
  const [address, setAddress] = React.useState(formatPhysicalAddress(knx.physicalAddress));
  const [invalid, setInvalid] = React.useState<string | null>(null);
  const dirty = address !== formatPhysicalAddress(knx.physicalAddress);

  async function saveAddress() {
    const parsed = parsePhysicalAddress(address);
    if (parsed === undefined) {
      setInvalid("Invalid physical address — expected area.line.device, e.g. 15.15.255");
      return;
    }
    setInvalid(null);
    await save([{ type: "setKnxPhysicalAddress", address: parsed }]);
  }

  return (
    <>
      <SectionHeader
        title="BMS protocol · KNX"
        desc="The KNX side of the gateway. Group addresses, DPTs and flags are assigned per signal in the signal table."
      />
      <GroupCard label="KNX TP">
        <FieldRow
          label="Physical address"
          hint="Individual address of the gateway on the line (area.line.device)"
        >
          <div>
            <TextControl
              id="cfg-knx-address"
              value={address}
              width={110}
              mono
              onChange={(e) => {
                setAddress(e.target.value);
                setInvalid(null);
              }}
            />
            {invalid && (
              <p role="alert" className="mt-[7px] text-[11.5px] text-error">
                {invalid}
              </p>
            )}
          </div>
        </FieldRow>
        <FieldRow label="Extended addresses" hint="Extends the group address range up to 31/7/255">
          <ToggleControl
            label="Extended addresses"
            checked={knx.extendedAddresses}
            disabled={busy}
            onToggle={(enabled) => void save([{ type: "setKnxExtendedAddresses", enabled }])}
          />
        </FieldRow>
      </GroupCard>
      <SaveRow dirty={dirty} busy={busy} error={error} onSave={() => void saveAddress()} />
    </>
  );
}


/** KNX-MBM: global Modbus Master settings (per-node RTU/TCP settings live on the Devices screen). */
function DeviceMbmSection({ view }: { view: Extract<ProjectView, { family: "knx-mbm" }> }) {
  const { save, busy, error } = useSave();
  const { mbm } = view.project;
  const [form, setForm] = React.useState({
    media: mbm.media as number,
    deadband: mbm.deadband,
    pollEnabled: mbm.pollRecords.enabled,
    useMissingReg: mbm.pollRecords.useMissingReg,
    maxRegisters: mbm.pollRecords.maxRegisters,
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const dirty = JSON.stringify(form) !== JSON.stringify({
    media: mbm.media as number,
    deadband: mbm.deadband,
    pollEnabled: mbm.pollRecords.enabled,
    useMissingReg: mbm.pollRecords.useMissingReg,
    maxRegisters: mbm.pollRecords.maxRegisters,
  });

  function handleSave() {
    void save([
      {
        type: "updateMbmConfig",
        patch: {
          media: form.media,
          deadband: form.deadband,
          pollRecords: {
            enabled: form.pollEnabled,
            useMissingReg: form.useMissingReg,
            maxRegisters: form.maxRegisters,
          },
        },
      },
    ]);
  }

  return (
    <>
      <SectionHeader
        title="Device protocol · Modbus Master"
        desc="Connection to the Modbus slave devices. Per-node RTU/TCP settings and devices are edited on the Devices screen."
      />
      <GroupCard label="Connection" tag="reboot required">
        <FieldRow label="Connection type" hint="RTU, TCP or both simultaneously">
          <SelectControl
            id="cfg-mbm-media"
            value={form.media}
            onChange={(e) => set("media", Number(e.target.value))}
          >
            {MEDIA_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </SelectControl>
        </FieldRow>
        <FieldRow
          label="Deadband to internal system"
          hint="Minimum change to forward to KNX · non-boolean signals · 0–1"
        >
          <TextControl
            id="cfg-mbm-deadband"
            type="number"
            value={form.deadband}
            min={0}
            max={1}
            width={110}
            onChange={(e) => set("deadband", Number(e.target.value))}
          />
        </FieldRow>
        <FieldRow label="RTU nodes" hint="Serial links — baud rate and timings are set per node on Devices">
          <ReadOnly value={String(mbm.rtuNodes.length)} />
        </FieldRow>
        <FieldRow label="TCP nodes" hint="Modbus TCP servers — IP and timeouts are set per node on Devices">
          <ReadOnly value={String(mbm.tcpNodes.length)} />
        </FieldRow>
      </GroupCard>
      <GroupCard label="Modbus poll records">
        <FieldRow label="Enable poll records" hint="Groups poll requests into multi-register reads">
          <ToggleControl
            label="Enable poll records"
            checked={form.pollEnabled}
            onToggle={(v) => set("pollEnabled", v)}
          />
        </FieldRow>
        {form.pollEnabled && (
          <>
            <FieldRow label="Max registers per record" hint="1–255 · default 100">
              <TextControl
                id="cfg-mbm-maxreg"
                type="number"
                value={form.maxRegisters}
                min={1}
                max={255}
                width={110}
                onChange={(e) => set("maxRegisters", Number(e.target.value))}
              />
            </FieldRow>
            <FieldRow
              label="Use missing registers"
              hint="Allows records to span gaps left by unmapped registers"
            >
              <ToggleControl
                label="Use missing registers"
                checked={form.useMissingReg}
                onToggle={(v) => set("useMissingReg", v)}
              />
            </FieldRow>
          </>
        )}
      </GroupCard>
      <SaveRow dirty={dirty} busy={busy} error={error} onSave={handleSave} />
    </>
  );
}

const MEDIA_OPTIONS = [
  { value: 0, label: "RTU" },
  { value: 1, label: "TCP" },
  { value: 2, label: "RTU + TCP" },
] as const;

/** ME–MBS: Modbus Slave (server) configuration. */
function BmsMbsSection({ view }: { view: Extract<ProjectView, { family: "me-mbs" }> }) {
  const { save, busy, error } = useSave();
  const { mbs } = view.project;
  const [form, setForm] = React.useState({
    media: mbs.media as number,
    byteOrder: mbs.byteOrder,
    updateCOV: mbs.updateCOV,
    addressMode: mbs.addressMode as number,
    slaveAddressMode: mbs.slaveAddressMode as number,
    slaves: mbs.slaves.map((s) => ({ ...s })),
    commErrorTout: mbs.commErrorTout,
    registerBase: mbs.registerBase as number,
    baudrate: mbs.rtu.baudrate,
    dataBits: mbs.rtu.dataBits,
    parity: mbs.rtu.parity as number,
    stopBits: mbs.rtu.stopBits as number,
    slaveNumber: mbs.rtu.slaveNumber,
    tcpPort: mbs.tcp.port,
    keepAlive: mbs.tcp.keepAlive,
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const setSlave = (index: number, patch: Partial<{ address: number; description: string }>) =>
    setForm((prev) => ({
      ...prev,
      slaves: prev.slaves.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  const baseline = {
    media: mbs.media as number,
    byteOrder: mbs.byteOrder,
    updateCOV: mbs.updateCOV,
    addressMode: mbs.addressMode as number,
    slaveAddressMode: mbs.slaveAddressMode as number,
    slaves: mbs.slaves.map((s) => ({ ...s })),
    commErrorTout: mbs.commErrorTout,
    registerBase: mbs.registerBase as number,
    baudrate: mbs.rtu.baudrate,
    dataBits: mbs.rtu.dataBits,
    parity: mbs.rtu.parity as number,
    stopBits: mbs.rtu.stopBits as number,
    slaveNumber: mbs.rtu.slaveNumber,
    tcpPort: mbs.tcp.port,
    keepAlive: mbs.tcp.keepAlive,
  };
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);

  function handleSave() {
    void save([
      {
        type: "updateMbsConfig",
        patch: {
          media: form.media as 0 | 1 | 2,
          byteOrder: form.byteOrder,
          updateCOV: form.updateCOV,
          addressMode: form.addressMode as 0 | 1 | 2,
          slaveAddressMode: form.slaveAddressMode as 0 | 1,
          slaves: form.slaves,
          commErrorTout: form.commErrorTout,
          registerBase: form.registerBase as 0 | 1,
        },
      },
      {
        type: "updateRtuConfig",
        patch: {
          baudrate: form.baudrate,
          dataBits: form.dataBits,
          parity: form.parity as 0 | 1 | 2,
          stopBits: form.stopBits as 1 | 2,
          slaveNumber: form.slaveNumber,
        },
      },
      { type: "updateTcpConfig", patch: { port: form.tcpPort, keepAlive: form.keepAlive } },
    ]);
  }

  return (
    <>
      <SectionHeader
        title="BMS protocol · Modbus server"
        desc="The Modbus side of the gateway. Registers, formats and scaling are assigned per signal in the signal table."
      />
      <GroupCard label="Modbus">
        <FieldRow label="Media" hint="Serial, IP, or both simultaneously">
          <SelectControl
            id="cfg-mbs-media"
            value={form.media}
            onChange={(e) => set("media", Number(e.target.value))}
          >
            {MEDIA_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </SelectControl>
        </FieldRow>
        <FieldRow
          label="Modbus addresses"
          hint={
            form.addressMode === 1
              ? "Custom — you edit every register; groups added later get no register until you assign one"
              : "Fixed — factory register list, one block per integrated group"
          }
        >
          <SelectControl
            id="cfg-mbs-addrmode"
            value={form.addressMode}
            onChange={(e) => set("addressMode", Number(e.target.value))}
          >
            <option value={0}>Fixed</option>
            <option value={1}>Custom</option>
          </SelectControl>
        </FieldRow>
        <FieldRow label="Byte order">
          <SelectControl
            id="cfg-mbs-byteorder"
            value={form.byteOrder}
            onChange={(e) => set("byteOrder", Number(e.target.value))}
          >
            {Object.entries(BYTE_ORDER_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectControl>
        </FieldRow>
        <FieldRow label="Register base">
          <SelectControl
            id="cfg-mbs-regbase"
            value={form.registerBase}
            onChange={(e) => set("registerBase", Number(e.target.value))}
          >
            <option value={0}>0-based</option>
            <option value={1}>1-based</option>
          </SelectControl>
        </FieldRow>
        <FieldRow
          label="Comm. error timeout"
          hint={`${COMM_ERROR_TOUT_RANGE.min}–${COMM_ERROR_TOUT_RANGE.max}`}
        >
          <TextControl
            id="cfg-mbs-commerr"
            type="number"
            value={form.commErrorTout}
            min={COMM_ERROR_TOUT_RANGE.min}
            max={COMM_ERROR_TOUT_RANGE.max}
            width={110}
            unit="s"
            onChange={(e) => set("commErrorTout", Number(e.target.value))}
          />
        </FieldRow>
        <FieldRow label="Update on change of value (COV)">
          <ToggleControl
            label="Update on change of value (COV)"
            checked={form.updateCOV}
            onToggle={(v) => set("updateCOV", v)}
          />
        </FieldRow>
      </GroupCard>

      <GroupCard label="RTU · EIA-485" tag={form.media === 1 ? "not in use" : undefined} tagTone="info">
        <FieldRow label="Connection type" hint="The gateway has a single EIA-485 port, so there is nothing to choose">
          <ReadOnly value="EIA-485" />
        </FieldRow>
        <FieldRow label="Baudrate">
          <SelectControl
            id="cfg-mbs-baud"
            value={form.baudrate}
            onChange={(e) => set("baudrate", Number(e.target.value))}
          >
            {BAUD_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate}
              </option>
            ))}
          </SelectControl>
        </FieldRow>
        <FieldRow label="Data bits">
          <SelectControl
            id="cfg-mbs-databits"
            value={form.dataBits}
            onChange={(e) => set("dataBits", Number(e.target.value))}
          >
            {[5, 6, 7, 8].map((bits) => (
              <option key={bits} value={bits}>
                {bits}
              </option>
            ))}
          </SelectControl>
        </FieldRow>
        <FieldRow label="Parity">
          <SelectControl
            id="cfg-mbs-parity"
            value={form.parity}
            onChange={(e) => set("parity", Number(e.target.value))}
          >
            <option value={0}>None</option>
            <option value={1}>Odd</option>
            <option value={2}>Even</option>
          </SelectControl>
        </FieldRow>
        <FieldRow label="Stop bits">
          <SelectControl
            id="cfg-mbs-stopbits"
            value={form.stopBits}
            onChange={(e) => set("stopBits", Number(e.target.value))}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
          </SelectControl>
        </FieldRow>
        <FieldRow label="Slave id" hint={`${SLAVE_ID_RANGE.min}–${SLAVE_ID_RANGE.max}`}>
          <TextControl
            id="cfg-mbs-slave"
            type="number"
            value={form.slaveNumber}
            min={SLAVE_ID_RANGE.min}
            max={SLAVE_ID_RANGE.max}
            width={90}
            onChange={(e) => set("slaveNumber", Number(e.target.value))}
          />
        </FieldRow>
        <FieldRow
          label="Slave addressing mode"
          hint="One server address for the whole gateway, or one per AC group"
        >
          <SelectControl
            id="cfg-mbs-slavemode"
            value={form.slaveAddressMode}
            onChange={(e) => set("slaveAddressMode", Number(e.target.value))}
          >
            <option value={0}>Single Slave</option>
            <option value={1}>Multiple Slaves</option>
          </SelectControl>
        </FieldRow>
        {form.slaveAddressMode === 1 && (
          <FieldRow
            label="Slave list"
            hint="Each AC group answers on its own server address with the same register block"
          >
            <div className="space-y-2">
              {form.slaves.map((slave, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    type="number"
                    aria-label={`Slave ${i + 1} address`}
                    min={SLAVE_ID_RANGE.min}
                    max={SLAVE_ID_RANGE.max}
                    value={slave.address}
                    onChange={(e) => setSlave(i, { address: Number(e.target.value) })}
                    style={{ width: 90 }}
                    className="h-auto rounded-[4px] px-[9px] py-[6px] font-mono text-[12.5px]"
                  />
                  <Input
                    aria-label={`Slave ${i + 1} description`}
                    value={slave.description}
                    maxLength={128}
                    placeholder="Description"
                    onChange={(e) => setSlave(i, { description: e.target.value })}
                    style={{ width: 240 }}
                    className="h-auto rounded-[4px] px-[9px] py-[6px] text-[12.5px]"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({ ...prev, slaves: prev.slaves.filter((_, j) => j !== i) }))
                    }
                    className="text-[12px] font-medium text-fg-subtle hover:text-error"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      slaves: [...prev.slaves, { address: prev.slaves.length + 1, description: "" }],
                    }))
                  }
                >
                  Add slave
                </Button>
              </div>
            </div>
          </FieldRow>
        )}
      </GroupCard>

      <GroupCard label="TCP" tag={form.media === 0 ? "not in use" : undefined} tagTone="info">
        <FieldRow label="Port" hint="Default 502">
          <TextControl
            id="cfg-mbs-tcpport"
            type="number"
            value={form.tcpPort}
            min={1}
            max={65535}
            width={110}
            onChange={(e) => set("tcpPort", Number(e.target.value))}
          />
        </FieldRow>
        <FieldRow label="Keep alive" hint="0 disables the function">
          <TextControl
            id="cfg-mbs-keepalive"
            type="number"
            value={form.keepAlive}
            min={0}
            width={110}
            unit="s"
            onChange={(e) => set("keepAlive", Number(e.target.value))}
          />
        </FieldRow>
      </GroupCard>
      <SaveRow dirty={dirty} busy={busy} error={error} onSave={handleSave} />
    </>
  );
}

/** ME–MBS: global Mitsubishi Electric parameters; controllers and groups live in AC units. */
function DeviceMeSection({ view }: { view: Extract<ProjectView, { family: "me-mbs" }> }) {
  const router = useRouter();
  const { save, busy, error } = useSave();
  const { me } = view.project;
  const [form, setForm] = React.useState({
    pollPeriod: me.pollPeriod,
    ansTimeout: me.ansTimeout,
    controllerTout: me.controllerTout,
    writeMaxBurst: me.writeMaxBurst,
    temperatureMode: me.temperatureMode as number,
    consumptionEnabled: me.consumptionEnabled,
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const dirty = JSON.stringify(form) !== JSON.stringify({
    pollPeriod: me.pollPeriod,
    ansTimeout: me.ansTimeout,
    controllerTout: me.controllerTout,
    writeMaxBurst: me.writeMaxBurst,
    temperatureMode: me.temperatureMode as number,
    consumptionEnabled: me.consumptionEnabled,
  });
  const groupsIntegrated = me.controllers.reduce(
    (n, c) => n + c.groups.filter((g) => g.enabled).length,
    0,
  );

  return (
    <>
      <SectionHeader
        title="Device protocol · Mitsubishi Electric"
        desc="Global parameters of the Mitsubishi Electric side. The centralized controllers and their M-NET groups are managed in AC units."
      />
      <GroupCard
        label="Global parameters"
        action={
          <button
            type="button"
            className="text-[12px] font-bold text-hms-accent hover:underline"
            onClick={() => router.push("/devices")}
          >
            Manage controllers →
          </button>
        }
      >
        <FieldRow label="Temperature units" hint="Unit used on the Mitsubishi Electric side">
          <SelectControl
            id="cfg-me-tempMode"
            value={form.temperatureMode}
            onChange={(e) => set("temperatureMode", Number(e.target.value))}
          >
            <option value={0}>Celsius</option>
            <option value={1}>Fahrenheit</option>
          </SelectControl>
        </FieldRow>
        <FieldRow label="Polling period" hint="For the whole installation">
          <TextControl
            id="cfg-me-pollPeriod"
            type="number"
            value={form.pollPeriod}
            min={0}
            width={110}
            unit="ms"
            onChange={(e) => set("pollPeriod", Number(e.target.value))}
          />
        </FieldRow>
        <FieldRow label="Answer timeout">
          <TextControl
            id="cfg-me-ansTimeout"
            type="number"
            value={form.ansTimeout}
            min={0}
            width={110}
            unit="s"
            onChange={(e) => set("ansTimeout", Number(e.target.value))}
          />
        </FieldRow>
        <FieldRow label="Controller connection timeout">
          <TextControl
            id="cfg-me-controllerTout"
            type="number"
            value={form.controllerTout}
            min={0}
            width={110}
            unit="s"
            onChange={(e) => set("controllerTout", Number(e.target.value))}
          />
        </FieldRow>
        <FieldRow label="Write max burst">
          <TextControl
            id="cfg-me-writeMaxBurst"
            type="number"
            value={form.writeMaxBurst}
            min={0}
            width={90}
            onChange={(e) => set("writeMaxBurst", Number(e.target.value))}
          />
        </FieldRow>
        <FieldRow
          label="Consumption function"
          hint="Adds consumption signals to every group · the AC system and energy meters must already be commissioned"
        >
          <ToggleControl
            label="Consumption function"
            checked={form.consumptionEnabled}
            onToggle={(v) => set("consumptionEnabled", v)}
          />
        </FieldRow>
        <FieldRow label="Groups integrated" hint="Across both centralized controllers · edited in AC units">
          <ReadOnly value={`${groupsIntegrated} of 100 licensed`} />
        </FieldRow>
      </GroupCard>
      <SaveRow
        dirty={dirty}
        busy={busy}
        error={error}
        onSave={() =>
          void save([
            {
              type: "updateMeScalars",
              patch: { ...form, temperatureMode: form.temperatureMode as 0 | 1 },
            },
          ])
        }
      />
    </>
  );
}


const CONVERSION_TYPE_LABELS: Record<number, string> = {
  0: "Filter",
  1: "Scale",
  2: "Arithmetic",
  3: "Logical",
  4: "LUT remap",
};

const FILTER_TYPE_LABELS: Record<string, string> = {
  "0": "Comparison — returns 0/1",
  "1": "No-limit — passes the value or invalidates it",
  "2": "Limited — clamps the value to the range",
};

const FILTER_COMPARISON_LABELS: Record<string, string> = {
  "0": "Equal",
  "1": "Different",
  "2": "Less than",
  "3": "Greater than",
  "4": "In range",
  "5": "Out of range",
};

type ConversionEntry = ProjectView["project"]["conversions"][number];

/** Human-readable parameter rows for a conversion, mirroring the desktop Conversions Manager. */
function conversionDetail(c: ConversionEntry): { label: string; value: string }[] {
  const [p1, p2, p3, p4] = c.params;
  switch (c.type) {
    case 0: {
      const rows = [
        { label: "Filter type", value: FILTER_TYPE_LABELS[p1] ?? p1 },
        { label: "Comparison", value: FILTER_COMPARISON_LABELS[p2] ?? p2 },
        { label: "Value", value: p3 },
      ];
      if (["2", "4", "5"].includes(p2)) rows.push({ label: "Upper value", value: p4 });
      return rows;
    }
    case 1:
      return [
        { label: "Input range", value: `${p1} – ${p2}` },
        { label: "Output range", value: `${p3} – ${p4}` },
        { label: "Behaviour", value: `Clamps the input to ${p1}–${p2}, then linear interpolation` },
      ];
    case 2:
      return [
        { label: "A · exponent", value: p1 },
        { label: "B · factor", value: p2 },
        { label: "C · offset", value: p3 },
        { label: "Formula", value: `y = x · ${p2} · (10^${p1}) + ${p3}` },
      ];
    case 3:
      return [
        { label: "OR mask", value: p1 },
        { label: "AND mask", value: p2 },
        { label: "XOR mask", value: p3 },
        { label: "Behaviour", value: "Applied in order: OR → AND → XOR" },
      ];
    case 4:
      return [
        { label: "Remap table", value: p1 },
        { label: "Inverse table", value: Number(p2) & 0x8 ? "Yes" : "No" },
      ];
    default:
      return [{ label: "Parameters", value: c.params.filter(Boolean).join(" · ") || "—" }];
  }
}

/** Master-detail: Filters / Operations lists on the left, selected conversion detail on the right. */
function ConversionsSection({ view }: { view: ProjectView }) {
  const conversions = view.project.conversions;
  const filters = conversions.filter((c) => c.type === 0);
  const operations = conversions.filter((c) => c.type !== 0);
  const [selected, setSelected] = React.useState<number | null>(conversions[0]?.id ?? null);
  const current = conversions.find((c) => c.id === selected) ?? null;

  const listButton = (c: ConversionEntry) => (
    <button
      key={c.id}
      type="button"
      onClick={() => setSelected(c.id)}
      className={cn(
        "mb-[2px] flex w-full cursor-pointer items-center gap-2 rounded-[4px] px-[10px] py-2 text-left text-[12.5px]",
        selected === c.id ? "bg-[#EAF3FB] font-bold text-hms-blue" : "font-normal text-fg-muted",
      )}
    >
      <span className="flex-1 truncate">{c.description || `Conversion ${c.id}`}</span>
    </button>
  );

  return (
    <>
      <SectionHeader
        title="Conversions"
        desc="Filters and operations applied between the raw register value and the BMS datapoint. Assigned per signal in the signal table."
      />
      {conversions.length === 0 ? (
        <GroupCard label="Value operations">
          <FieldRow label="No conversions defined">
            <ReadOnly value="—" />
          </FieldRow>
        </GroupCard>
      ) : (
        <div className="flex items-start gap-4">
          <div className="w-[230px] shrink-0 rounded-lg border border-border bg-white p-3">
            {filters.length > 0 && (
              <>
                <div className="mb-2 px-[10px] font-mono text-[10.5px] font-medium uppercase tracking-wider text-fg-muted">
                  Filters
                </div>
                {filters.map(listButton)}
              </>
            )}
            {operations.length > 0 && (
              <>
                <div className="mb-2 mt-3 px-[10px] font-mono text-[10.5px] font-medium uppercase tracking-wider text-fg-muted">
                  Operations
                </div>
                {operations.map(listButton)}
              </>
            )}
          </div>
          {current && (
            <div className="min-w-0 flex-1">
              <GroupCard
                label={current.description || `Conversion ${current.id}`}
                tag={CONVERSION_TYPE_LABELS[current.type] ?? `Type ${current.type}`}
                tagTone="info"
              >
                {conversionDetail(current).map((row) => (
                  <FieldRow key={row.label} label={row.label}>
                    <ReadOnly value={row.value} />
                  </FieldRow>
                ))}
              </GroupCard>
            </div>
          )}
        </div>
      )}
    </>
  );
}
