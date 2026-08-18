"use client";

import * as React from "react";
import { formatPhysicalAddress, parsePhysicalAddress } from "@/protocols/knx/address";
import type { ProjectView } from "@/lib/project-types";
import { useSave } from "@/lib/use-save";
import { ScreenGate, ScreenIssues } from "@/components/screens/screen-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

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
      <KnxCard view={view} />
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

function KnxCard({ view }: { view: ProjectView }) {
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
