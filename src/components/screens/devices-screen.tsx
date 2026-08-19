"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  BAUD_RATES,
  DEVICE_TIMEOUT_RANGE,
  MAX_RTU_NODES,
  MAX_TCP_NODES,
  type MbmDevice,
  type MbmRtuNode,
  type MbmTcpNode,
} from "@/protocols/modbus/master";
import type { NodeLocator, ProjectView } from "@/lib/project-types";
import { useSave } from "@/lib/use-save";
import { ScreenGate, ScreenIssues } from "@/components/screens/screen-gate";
import { MeMbsDevicesView } from "@/components/screens/devices-screen-me-mbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function DevicesScreen() {
  return (
    <ScreenGate>
      {(view) =>
        view.family === "me-mbs" ? (
          <MeMbsDevicesView view={view} />
        ) : (
          <DevicesSections key={view.meta.updatedAt} view={view} />
        )
      }
    </ScreenGate>
  );
}

function DevicesSections({ view }: { view: Extract<ProjectView, { family: "knx-mbm" }> }) {
  const { save, error } = useSave();
  const { rtuNodes, tcpNodes } = view.project.mbm;

  return (
    <div className="max-w-5xl space-y-4">
      <ScreenIssues issues={view.issues} screen="devices" />
      {error && (
        <p role="alert" className="rounded-lg border border-error/30 bg-error-bg px-4 py-2 text-sm text-error">
          {error}
        </p>
      )}

      <NodeSection
        title="Modbus RTU nodes"
        count={rtuNodes.length}
        max={MAX_RTU_NODES}
        onAdd={() => void save([{ type: "addRtuNode" }])}
      >
        {rtuNodes.map((node, nodeIndex) => (
          <RtuNodeCard key={nodeIndex} node={node} nodeIndex={nodeIndex} />
        ))}
      </NodeSection>

      <NodeSection
        title="Modbus TCP nodes"
        count={tcpNodes.length}
        max={MAX_TCP_NODES}
        onAdd={() => void save([{ type: "addTcpNode" }])}
      >
        {tcpNodes.map((node, nodeIndex) => (
          <TcpNodeCard key={nodeIndex} node={node} nodeIndex={nodeIndex} />
        ))}
      </NodeSection>
    </div>
  );
}

function NodeSection({
  title,
  count,
  max,
  onAdd,
  children,
}: {
  title: string;
  count: number;
  max: number;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3" aria-label={title}>
      <div className="flex items-center gap-3">
        <h2 className="font-mono text-[10.5px] font-medium uppercase tracking-wider text-fg-muted">
          {title}
        </h2>
        <Badge variant="muted">
          {count} / {max}
        </Badge>
        <Button size="sm" variant="secondary" onClick={onAdd} disabled={count >= max}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add node
        </Button>
      </div>
      {count === 0 ? (
        <p className="text-sm text-fg-muted">No nodes yet.</p>
      ) : (
        <div className="space-y-3">{children}</div>
      )}
    </section>
  );
}

function NodeShell({
  title,
  locator,
  children,
  devices,
}: {
  title: string;
  locator: NodeLocator;
  children: React.ReactNode;
  devices: MbmDevice[];
}) {
  const { save, busy } = useSave();
  const [confirmRemove, setConfirmRemove] = React.useState(false);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <Button
          size="sm"
          variant={confirmRemove ? "destructive" : "ghost"}
          disabled={busy}
          onClick={() => {
            if (!confirmRemove) {
              setConfirmRemove(true);
              return;
            }
            void save([{ type: "removeNode", locator }]);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          {confirmRemove ? "Confirm remove node" : "Remove node"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {children}
        <DeviceTable locator={locator} devices={devices} />
      </CardContent>
    </Card>
  );
}

function NumberInput({
  id,
  value,
  onChange,
  min,
  max,
}: {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <Input
      id={id}
      type="number"
      className="font-mono"
      value={Number.isNaN(value) ? "" : value}
      min={min}
      max={max}
      onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
    />
  );
}

function RtuNodeCard({ node, nodeIndex }: { node: MbmRtuNode; nodeIndex: number }) {
  const { save, busy, error } = useSave();
  const [form, setForm] = React.useState({ ...node });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const dirty = JSON.stringify(form) !== JSON.stringify(node);
  const locator: NodeLocator = { kind: "rtu", nodeIndex };

  return (
    <NodeShell title={`RTU node ${nodeIndex + 1} — Port ${node.physicalPort === 0 ? "A" : "B"}`} locator={locator} devices={node.devices}>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Field label="Baudrate" htmlFor={`rtu-${nodeIndex}-baud`}>
          <Select
            id={`rtu-${nodeIndex}-baud`}
            value={form.baudrate}
            onChange={(e) => set("baudrate", Number(e.target.value))}
          >
            {BAUD_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Data bits" htmlFor={`rtu-${nodeIndex}-databits`}>
          <Select
            id={`rtu-${nodeIndex}-databits`}
            value={form.dataBits}
            onChange={(e) => set("dataBits", Number(e.target.value))}
          >
            {[5, 6, 7, 8].map((bits) => (
              <option key={bits} value={bits}>
                {bits}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Parity" htmlFor={`rtu-${nodeIndex}-parity`}>
          <Select
            id={`rtu-${nodeIndex}-parity`}
            value={form.parity}
            onChange={(e) => set("parity", Number(e.target.value) as 0 | 1 | 2)}
          >
            <option value={0}>None</option>
            <option value={1}>Odd</option>
            <option value={2}>Even</option>
          </Select>
        </Field>
        <Field label="Stop bits" htmlFor={`rtu-${nodeIndex}-stopbits`}>
          <Select
            id={`rtu-${nodeIndex}-stopbits`}
            value={form.stopBits}
            onChange={(e) => set("stopBits", Number(e.target.value) as 1 | 2)}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
          </Select>
        </Field>
        <Field label="Inter-frame (ms)" htmlFor={`rtu-${nodeIndex}-tir`}>
          <NumberInput
            id={`rtu-${nodeIndex}-tir`}
            value={form.timeInterFrame}
            min={0}
            onChange={(v) => set("timeInterFrame", v)}
          />
        </Field>
        <Field label="Physical port" hint="KNX products use Port B" htmlFor={`rtu-${nodeIndex}-port`}>
          <Select
            id={`rtu-${nodeIndex}-port`}
            value={form.physicalPort}
            onChange={(e) => set("physicalPort", Number(e.target.value) as 0 | 1)}
          >
            <option value={1}>Port B</option>
            <option value={0}>Port A</option>
          </Select>
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <Checkbox checked={form.pollAfterWrite} onChange={(e) => set("pollAfterWrite", e.target.checked)} />
          Poll after write
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <Checkbox checked={form.pollReadSignal} onChange={(e) => set("pollReadSignal", e.target.checked)} />
          Poll read signal
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={!dirty || busy}
          onClick={() => {
            const { devices: _devices, ...patch } = form;
            void save([{ type: "updateRtuNode", nodeIndex, patch }]);
          }}
        >
          Save node
        </Button>
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
      </div>
    </NodeShell>
  );
}

function TcpNodeCard({ node, nodeIndex }: { node: MbmTcpNode; nodeIndex: number }) {
  const { save, busy, error } = useSave();
  const [form, setForm] = React.useState({ ...node });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const dirty = JSON.stringify(form) !== JSON.stringify(node);
  const locator: NodeLocator = { kind: "tcp", nodeIndex };
  const id = (field: string) => `tcp-${nodeIndex}-${field}`;

  return (
    <NodeShell title={`TCP node ${nodeIndex + 1} — ${node.ip}:${node.port}`} locator={locator} devices={node.devices}>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Field label="Description" htmlFor={id("desc")}>
          <Input id={id("desc")} value={form.description} maxLength={128} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <Field label="IP address" htmlFor={id("ip")}>
          <Input id={id("ip")} value={form.ip} maxLength={45} className="font-mono" onChange={(e) => set("ip", e.target.value)} />
        </Field>
        <Field label="Port" htmlFor={id("port")}>
          <NumberInput id={id("port")} value={form.port} min={1} max={65535} onChange={(v) => set("port", v)} />
        </Field>
        <Field label="Inter-frame (ms)" htmlFor={id("tir")}>
          <NumberInput id={id("tir")} value={form.timeInterFrame} min={0} onChange={(v) => set("timeInterFrame", v)} />
        </Field>
        <Field label="Retry timeout (ms)" htmlFor={id("retry")}>
          <NumberInput id={id("retry")} value={form.retryTimeout} min={0} onChange={(v) => set("retryTimeout", v)} />
        </Field>
        <Field label="Connection timeout (ms)" htmlFor={id("conn")}>
          <NumberInput id={id("conn")} value={form.connTimeout} min={0} onChange={(v) => set("connTimeout", v)} />
        </Field>
        <Field label="RX timeout (ms)" htmlFor={id("rx")}>
          <NumberInput id={id("rx")} value={form.rxTimeout} min={0} onChange={(v) => set("rxTimeout", v)} />
        </Field>
        <Field label="Slave-change inter-frame (ms)" htmlFor={id("tirsc")}>
          <NumberInput
            id={id("tirsc")}
            value={form.timeInterFrameSlaveChange}
            min={100}
            onChange={(v) => set("timeInterFrameSlaveChange", v)}
          />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={!dirty || busy}
          onClick={() => {
            const { devices: _devices, ...patch } = form;
            void save([{ type: "updateTcpNode", nodeIndex, patch }]);
          }}
        >
          Save node
        </Button>
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
      </div>
    </NodeShell>
  );
}

function DeviceTable({ locator, devices }: { locator: NodeLocator; devices: MbmDevice[] }) {
  const { save, busy } = useSave();
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <h3 className="font-mono text-[10.5px] font-medium uppercase tracking-wider text-fg-muted">
          Devices
        </h3>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => void save([{ type: "addDevice", locator }])}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add device
        </Button>
      </div>
      {devices.length === 0 ? (
        <p className="text-sm text-fg-muted">No devices on this node.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Manufacturer</TableHead>
              <TableHead>Slave</TableHead>
              <TableHead>Base register</TableHead>
              <TableHead>Timeout (ms)</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices.map((device) => (
              <DeviceRow key={device.index} locator={locator} device={device} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function DeviceRow({ locator, device }: { locator: NodeLocator; device: MbmDevice }) {
  const { save, busy } = useSave();
  const [form, setForm] = React.useState({ ...device });
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const dirty = JSON.stringify(form) !== JSON.stringify(device);
  const slaveRange = locator.kind === "rtu" ? { min: 1, max: 254 } : { min: 0, max: 255 };

  return (
    <TableRow>
      <TableCell className="font-mono text-fg-subtle">{device.index}</TableCell>
      <TableCell>
        <Input
          aria-label="Device name"
          className="h-7 w-40 text-xs"
          value={form.name}
          maxLength={128}
          onChange={(e) => set("name", e.target.value)}
        />
      </TableCell>
      <TableCell>
        <Input
          aria-label="Manufacturer"
          className="h-7 w-32 text-xs"
          value={form.manufacturer}
          maxLength={128}
          onChange={(e) => set("manufacturer", e.target.value)}
        />
      </TableCell>
      <TableCell>
        <Input
          aria-label="Slave"
          type="number"
          className="h-7 w-20 font-mono text-xs"
          value={form.slave}
          min={slaveRange.min}
          max={slaveRange.max}
          onChange={(e) => set("slave", Number(e.target.value))}
        />
      </TableCell>
      <TableCell>
        <Select
          aria-label="Base register"
          className="h-7 w-24 text-xs"
          value={form.baseRegister}
          onChange={(e) => set("baseRegister", Number(e.target.value) as 0 | 1)}
        >
          <option value={0}>0-based</option>
          <option value={1}>1-based</option>
        </Select>
      </TableCell>
      <TableCell>
        <Input
          aria-label="Timeout"
          type="number"
          className="h-7 w-24 font-mono text-xs"
          value={form.timeout}
          min={DEVICE_TIMEOUT_RANGE.min}
          max={DEVICE_TIMEOUT_RANGE.max}
          onChange={(e) => set("timeout", Number(e.target.value))}
        />
      </TableCell>
      <TableCell>
        <Checkbox
          aria-label="Enabled"
          checked={form.enabled}
          onChange={(e) => set("enabled", e.target.checked)}
        />
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="secondary"
            disabled={!dirty || busy}
            onClick={() => {
              const { index: _index, ...patch } = form;
              void save([{ type: "updateDevice", locator, deviceIndex: device.index, patch }]);
            }}
          >
            Save
          </Button>
          <Button
            size="sm"
            variant={confirmRemove ? "destructive" : "ghost"}
            disabled={busy}
            onClick={() => {
              if (!confirmRemove) {
                setConfirmRemove(true);
                return;
              }
              void save([{ type: "removeDevice", locator, deviceIndex: device.index }]);
            }}
          >
            {confirmRemove ? "Confirm" : "Remove"}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
