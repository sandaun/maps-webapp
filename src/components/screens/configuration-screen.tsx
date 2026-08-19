"use client";

import * as React from "react";
import { formatPhysicalAddress, parsePhysicalAddress } from "@/protocols/knx/address";
import { BAUD_RATES, COMM_ERROR_TOUT_RANGE, SLAVE_ID_RANGE } from "@/protocols/modbus/slave";
import { BYTE_ORDER_LABELS } from "@/protocols/modbus/master/types";
import type { ProjectView } from "@/lib/project-types";
import { useSave } from "@/lib/use-save";
import { ScreenGate, ScreenIssues } from "@/components/screens/screen-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export function ConfigurationScreen() {
  return (
    <ScreenGate>
      {(view) => <ConfigurationCards key={view.meta.updatedAt} view={view} />}
    </ScreenGate>
  );
}

function ConfigurationCards({ view }: { view: ProjectView }) {
  return (
    <div className="max-w-3xl space-y-4">
      <ScreenIssues issues={view.issues} screen="configuration" />
      <GeneralCard view={view} />
      <GatewayCard view={view} />
      {view.family === "knx-mbm" && <KnxCard view={view} />}
      {view.family === "me-mbs" && (
        <>
          <MbsCard view={view} />
          <MeScalarsCard view={view} />
        </>
      )}
    </div>
  );
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

function GeneralCard({ view }: { view: ProjectView }) {
  const { save, busy, error } = useSave();
  const [name, setName] = React.useState(view.project.name);
  const [description, setDescription] = React.useState(view.project.description);
  const dirty = name !== view.project.name || description !== view.project.description;

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field label="Project name" hint="Shown across the workspace (max 32 characters)" htmlFor="cfg-name">
          <Input
            id="cfg-name"
            value={name}
            maxLength={32}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Description" hint="Optional project description (max 255 characters)" htmlFor="cfg-desc">
          <Input
            id="cfg-desc"
            value={description}
            maxLength={255}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <SaveRow
          dirty={dirty}
          busy={busy}
          error={error}
          onSave={() => void save([{ type: "setGeneralInfo", name, description }])}
        />
      </CardContent>
    </Card>
  );
}

function GatewayCard({ view }: { view: ProjectView }) {
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
    <Card>
      <CardHeader>
        <CardTitle>Gateway</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field label="Gateway name" htmlFor="cfg-gw-name">
          <Input id="cfg-gw-name" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="IP address" htmlFor="cfg-gw-ip">
            <Input
              id="cfg-gw-ip"
              value={ip}
              disabled={dhcp}
              className="font-mono"
              onChange={(e) => setIp(e.target.value)}
            />
          </Field>
          <Field label="Netmask" htmlFor="cfg-gw-netmask">
            <Input
              id="cfg-gw-netmask"
              value={netmask}
              disabled={dhcp}
              className="font-mono"
              onChange={(e) => setNetmask(e.target.value)}
            />
          </Field>
          <Field label="Gateway" htmlFor="cfg-gw-gateway">
            <Input
              id="cfg-gw-gateway"
              value={gateway}
              disabled={dhcp}
              className="font-mono"
              onChange={(e) => setGateway(e.target.value)}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={dhcp} onChange={(e) => setDhcp(e.target.checked)} />
          DHCP
          <span className="text-[11px] text-fg-subtle">Use this option on networks with a DHCP server</span>
        </label>
        <SaveRow
          dirty={dirty}
          busy={busy}
          error={error}
          onSave={() => void save([{ type: "setGatewayInfo", name, ip, netmask, gateway, dhcp }])}
        />
      </CardContent>
    </Card>
  );
}

function KnxCard({ view }: { view: Extract<ProjectView, { family: "knx-mbm" }> }) {
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
    <Card>
      <CardHeader>
        <CardTitle>KNX TP</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field
          label="Physical address"
          hint="Individual address of the gateway on the line (area.line.device)"
          htmlFor="cfg-knx-address"
          className="max-w-40"
        >
          <Input
            id="cfg-knx-address"
            value={address}
            className="font-mono"
            onChange={(e) => {
              setAddress(e.target.value);
              setInvalid(null);
            }}
          />
        </Field>
        {invalid && (
          <p role="alert" className="text-sm text-error">
            {invalid}
          </p>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={knx.extendedAddresses}
            disabled={busy}
            onChange={(e) => void save([{ type: "setKnxExtendedAddresses", enabled: e.target.checked }])}
          />
          Extended addresses
          <span className="text-[11px] text-fg-subtle">Extends the group address range up to 31/7/255</span>
        </label>
        <SaveRow dirty={dirty} busy={busy} error={error} onSave={() => void saveAddress()} />
      </CardContent>
    </Card>
  );
}

const MEDIA_OPTIONS = [
  { value: 0, label: "RTU" },
  { value: 1, label: "TCP" },
  { value: 2, label: "RTU + TCP" },
] as const;

/** ME–MBS: Modbus Slave (server) configuration card. */
function MbsCard({ view }: { view: Extract<ProjectView, { family: "me-mbs" }> }) {
  const { save, busy, error } = useSave();
  const { mbs } = view.project;
  const [form, setForm] = React.useState({
    media: mbs.media as number,
    byteOrder: mbs.byteOrder,
    updateCOV: mbs.updateCOV,
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
  const baseline = {
    media: mbs.media as number,
    byteOrder: mbs.byteOrder,
    updateCOV: mbs.updateCOV,
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
    <Card>
      <CardHeader>
        <CardTitle>Modbus Slave</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Media" htmlFor="cfg-mbs-media">
            <Select id="cfg-mbs-media" value={form.media} onChange={(e) => set("media", Number(e.target.value))}>
              {MEDIA_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Byte order" htmlFor="cfg-mbs-byteorder">
            <Select
              id="cfg-mbs-byteorder"
              value={form.byteOrder}
              onChange={(e) => set("byteOrder", Number(e.target.value))}
            >
              {Object.entries(BYTE_ORDER_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Register base" htmlFor="cfg-mbs-regbase">
            <Select
              id="cfg-mbs-regbase"
              value={form.registerBase}
              onChange={(e) => set("registerBase", Number(e.target.value))}
            >
              <option value={0}>0-based</option>
              <option value={1}>1-based</option>
            </Select>
          </Field>
          <Field
            label="Comm. error timeout (s)"
            hint={`${COMM_ERROR_TOUT_RANGE.min}–${COMM_ERROR_TOUT_RANGE.max}`}
            htmlFor="cfg-mbs-commerr"
          >
            <Input
              id="cfg-mbs-commerr"
              type="number"
              className="font-mono"
              value={form.commErrorTout}
              min={COMM_ERROR_TOUT_RANGE.min}
              max={COMM_ERROR_TOUT_RANGE.max}
              onChange={(e) => set("commErrorTout", Number(e.target.value))}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={form.updateCOV} onChange={(e) => set("updateCOV", e.target.checked)} />
          Update on change of value (COV)
        </label>

        <h3 className="pt-2 font-mono text-[10.5px] font-medium uppercase tracking-wider text-fg-muted">
          RTU link
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Baudrate" htmlFor="cfg-mbs-baud">
            <Select id="cfg-mbs-baud" value={form.baudrate} onChange={(e) => set("baudrate", Number(e.target.value))}>
              {BAUD_RATES.map((rate) => (
                <option key={rate} value={rate}>
                  {rate}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Data bits" htmlFor="cfg-mbs-databits">
            <Select id="cfg-mbs-databits" value={form.dataBits} onChange={(e) => set("dataBits", Number(e.target.value))}>
              {[5, 6, 7, 8].map((bits) => (
                <option key={bits} value={bits}>
                  {bits}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Parity" htmlFor="cfg-mbs-parity">
            <Select id="cfg-mbs-parity" value={form.parity} onChange={(e) => set("parity", Number(e.target.value))}>
              <option value={0}>None</option>
              <option value={1}>Odd</option>
              <option value={2}>Even</option>
            </Select>
          </Field>
          <Field label="Stop bits" htmlFor="cfg-mbs-stopbits">
            <Select id="cfg-mbs-stopbits" value={form.stopBits} onChange={(e) => set("stopBits", Number(e.target.value))}>
              <option value={1}>1</option>
              <option value={2}>2</option>
            </Select>
          </Field>
          <Field
            label="Slave id"
            hint={`${SLAVE_ID_RANGE.min}–${SLAVE_ID_RANGE.max}`}
            htmlFor="cfg-mbs-slave"
          >
            <Input
              id="cfg-mbs-slave"
              type="number"
              className="font-mono"
              value={form.slaveNumber}
              min={SLAVE_ID_RANGE.min}
              max={SLAVE_ID_RANGE.max}
              onChange={(e) => set("slaveNumber", Number(e.target.value))}
            />
          </Field>
        </div>

        <h3 className="pt-2 font-mono text-[10.5px] font-medium uppercase tracking-wider text-fg-muted">
          TCP
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Port" htmlFor="cfg-mbs-tcpport">
            <Input
              id="cfg-mbs-tcpport"
              type="number"
              className="font-mono"
              value={form.tcpPort}
              min={1}
              max={65535}
              onChange={(e) => set("tcpPort", Number(e.target.value))}
            />
          </Field>
          <Field label="Keep-alive (s)" htmlFor="cfg-mbs-keepalive">
            <Input
              id="cfg-mbs-keepalive"
              type="number"
              className="font-mono"
              value={form.keepAlive}
              min={0}
              onChange={(e) => set("keepAlive", Number(e.target.value))}
            />
          </Field>
        </div>
        <SaveRow dirty={dirty} busy={busy} error={error} onSave={handleSave} />
      </CardContent>
    </Card>
  );
}

/** ME–MBS: Mitsubishi Electric polling scalars. */
function MeScalarsCard({ view }: { view: Extract<ProjectView, { family: "me-mbs" }> }) {
  const { save, busy, error } = useSave();
  const { me } = view.project;
  const [form, setForm] = React.useState({
    pollPeriod: me.pollPeriod,
    ansTimeout: me.ansTimeout,
    controllerTout: me.controllerTout,
    writeMaxBurst: me.writeMaxBurst,
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const dirty = JSON.stringify(form) !== JSON.stringify({
    pollPeriod: me.pollPeriod,
    ansTimeout: me.ansTimeout,
    controllerTout: me.controllerTout,
    writeMaxBurst: me.writeMaxBurst,
  });

  const fields = [
    { key: "pollPeriod", label: "Poll period (ms)" },
    { key: "ansTimeout", label: "Answer timeout (s)" },
    { key: "controllerTout", label: "Controller timeout (s)" },
    { key: "writeMaxBurst", label: "Write max burst" },
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mitsubishi Electric</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {fields.map(({ key, label }) => (
            <Field key={key} label={label} htmlFor={`cfg-me-${key}`}>
              <Input
                id={`cfg-me-${key}`}
                type="number"
                className="font-mono"
                value={form[key]}
                min={0}
                onChange={(e) => set(key, Number(e.target.value))}
              />
            </Field>
          ))}
        </div>
        <SaveRow
          dirty={dirty}
          busy={busy}
          error={error}
          onSave={() => void save([{ type: "updateMeScalars", patch: { ...form } }])}
        />
      </CardContent>
    </Card>
  );
}
