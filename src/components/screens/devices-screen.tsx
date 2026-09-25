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
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Radio } from "@/components/ui/radio";
import { DraftInput as Input, DraftSelect as Select, ImmediatePropertyError, PropertyCheckbox } from "@/components/properties/draft-controls";
import { StickySaveBar } from "@/components/properties/sticky-save-bar";
import { useDraftForm, usePropertyDrafts, useRevealProperty } from "@/lib/property-drafts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function DevicesScreen() {
  return (
    <ScreenGate>
      {(view) =>
        view.family === "me-mbs" ? (
          <MeMbsDevicesView key={view.meta.id} view={view} />
        ) : (
          <DevicesSections key={view.meta.id} view={view} />
        )
      }
    </ScreenGate>
  );
}

function DevicesSections({ view }: { view: Extract<ProjectView, { family: "knx-mbm" }> }) {
  useRevealProperty(React.useCallback(() => {}, []));
  const { save, busy, error } = useSave();
  const { rtuNodes, tcpNodes } = view.project.mbm;

  return (
    <div className="flex min-h-full max-w-5xl flex-col">
      <div className="flex-1 space-y-4 pb-6">
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
        busy={busy}
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
        busy={busy}
        onAdd={() => void save([{ type: "addTcpNode" }])}
      >
        {tcpNodes.map((node, nodeIndex) => (
          <TcpNodeCard key={nodeIndex} node={node} nodeIndex={nodeIndex} />
        ))}
      </NodeSection>
      </div>
      <StickySaveBar screen="devices" />
    </div>
  );
}

function NodeSection({
  title,
  count,
  max,
  busy,
  onAdd,
  children,
}: {
  title: string;
  count: number;
  max: number;
  busy: boolean;
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
        <Button size="sm" variant="secondary" onClick={onAdd} disabled={busy || count >= max}>
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
  const { save, busy, error } = useSave();
  const drafts = usePropertyDrafts();
  const pendingCount = Object.values(drafts.snapshot.projects[drafts.view?.meta.id ?? ""]?.edits ?? {}).filter((edit) => edit.group === `${locator.kind}-${locator.nodeIndex}` || edit.group.startsWith(`${locator.kind}-${locator.nodeIndex}-device-`)).length;
  const signals = signalsOn(drafts.view, locator);
  const virtual = signals.filter((signal) => signal.virtual).length;
  const [confirmRemove, setConfirmRemove] = React.useState(false);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <Button size="sm" variant="ghost-destructive" disabled={busy} onClick={() => setConfirmRemove(true)}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          Remove node
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && !confirmRemove && <p role="alert" className="text-sm text-error">{error}</p>}
        {children}
        <DeviceTable locator={locator} devices={devices} />
      </CardContent>
      {confirmRemove && (
        <Modal
          title={`Remove ${title.split(" — ")[0]}`}
          description={`Removes the node and its ${devices.length} ${devices.length === 1 ? "device" : "devices"}. Signals on later nodes are renumbered so they keep pointing at the same devices.`}
          ctaLabel="Remove node"
          ctaDisabled={busy}
          onClose={() => setConfirmRemove(false)}
          onConfirm={() =>
            void save([{ type: "removeNode", locator }]).then((ok) => ok && setConfirmRemove(false))
          }
        >
          <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-text-body">
            <li>
              {signals.length - virtual === 0
                ? "No signals use this node."
                : `${signals.length - virtual} ${signals.length - virtual === 1 ? "signal loses" : "signals lose"} its device and must be reassigned.`}
            </li>
            {virtual > 0 && <li>{`${virtual} virtual ${virtual === 1 ? "signal is" : "signals are"} deleted.`}</li>}
            {pendingCount > 0 && <li>{`${pendingCount} unsaved ${pendingCount === 1 ? "edit is" : "edits are"} discarded.`}</li>}
          </ul>
          {error && <p role="alert" className="mt-3 text-sm text-error">{error}</p>}
        </Modal>
      )}
    </Card>
  );
}

/** Signals on a node (signal `Port`: RTU nodes first, then TCP), optionally on one device position. */
function signalsOn(view: ProjectView | null, locator: NodeLocator, position?: number) {
  if (view?.family !== "knx-mbm") return [];
  const port = locator.kind === "rtu" ? locator.nodeIndex : view.project.mbm.rtuNodes.length + locator.nodeIndex;
  return view.project.signals.filter(
    (signal) => signal.modbus.port === port && (position === undefined || signal.modbus.deviceIndex === position),
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
  const { form, set } = useDraftForm(`rtu-${nodeIndex}`, { ...node });
  const locator: NodeLocator = { kind: "rtu", nodeIndex };

  return (
    <NodeShell title={`RTU node ${nodeIndex + 1} — Port ${node.physicalPort === 0 ? "A" : "B"}`} locator={locator} devices={node.devices}>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Field label="Baudrate" htmlFor={`rtu-${nodeIndex}-baud`}>
          <Select
            id={`rtu-${nodeIndex}-baud`}
            value={form.baudrate}
            onValueChange={(value) => set("baudrate", Number(value))}
            options={BAUD_RATES.map((rate) => ({ value: String(rate), label: String(rate) }))}
          />
        </Field>
        <Field label="Data bits" htmlFor={`rtu-${nodeIndex}-databits`}>
          <Select
            id={`rtu-${nodeIndex}-databits`}
            value={form.dataBits}
            onValueChange={(value) => set("dataBits", Number(value))}
            options={[5, 6, 7, 8].map((bits) => ({ value: String(bits), label: String(bits) }))}
          />
        </Field>
        <Field label="Parity" htmlFor={`rtu-${nodeIndex}-parity`}>
          <Select
            id={`rtu-${nodeIndex}-parity`}
            value={form.parity}
            onValueChange={(value) => set("parity", Number(value) as 0 | 1 | 2)}
            options={[{ value: "0", label: "None" }, { value: "1", label: "Odd" }, { value: "2", label: "Even" }]}
          />
        </Field>
        <Field label="Stop bits" htmlFor={`rtu-${nodeIndex}-stopbits`}>
          <Select
            id={`rtu-${nodeIndex}-stopbits`}
            value={form.stopBits}
            onValueChange={(value) => set("stopBits", Number(value) as 1 | 2)}
            options={[{ value: "1", label: "1" }, { value: "2", label: "2" }]}
          />
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
            onValueChange={(value) => set("physicalPort", Number(value) as 0 | 1)}
            options={[{ value: "1", label: "Port B" }, { value: "0", label: "Port A" }]}
          />
        </Field>
        <label className="mt-5 flex min-h-[30px] items-center gap-2 self-start text-sm">
          <PropertyCheckbox id={`rtu-${nodeIndex}-pollAfterWrite`} checked={form.pollAfterWrite} onChange={(e) => set("pollAfterWrite", e.target.checked)} />
          Poll after write
          <ImmediatePropertyError id={`rtu-${nodeIndex}-pollAfterWrite`} />
        </label>
        <label className="mt-5 flex min-h-[30px] items-center gap-2 self-start text-sm">
          <PropertyCheckbox id={`rtu-${nodeIndex}-pollReadSignal`} checked={form.pollReadSignal} onChange={(e) => set("pollReadSignal", e.target.checked)} />
          Poll read signal
          <ImmediatePropertyError id={`rtu-${nodeIndex}-pollReadSignal`} />
        </label>
      </div>
    </NodeShell>
  );
}

function TcpNodeCard({ node, nodeIndex }: { node: MbmTcpNode; nodeIndex: number }) {
  const { form, set } = useDraftForm(`tcp-${nodeIndex}`, { ...node });
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
              {/* MAPS hides the timeout of TCP devices (p_devAdvanced) and never sends it for them. */}
              {locator.kind === "rtu" && <TableHead>Timeout (ms)</TableHead>}
              <TableHead>Enabled</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices.map((device, position) => (
              <DeviceRow key={position} locator={locator} device={device} position={position} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/** Devices are addressed by position: that is what the API and signal references use. */
function DeviceRow({ locator, device, position }: { locator: NodeLocator; device: MbmDevice; position: number }) {
  const { save, busy, error } = useSave();
  const drafts = usePropertyDrafts();
  const group = `${locator.kind}-${locator.nodeIndex}-device-${position}`;
  const pendingCount = Object.values(drafts.snapshot.projects[drafts.view?.meta.id ?? ""]?.edits ?? {}).filter((edit) => edit.group === group).length;
  const { form, set } = useDraftForm(group, { ...device });
  const signals = signalsOn(drafts.view, locator, position);
  const virtual = signals.filter((signal) => signal.virtual).length;
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const [signalMode, setSignalMode] = React.useState<"delete" | "unassign">("delete");
  const slaveRange = locator.kind === "rtu" ? { min: 1, max: 254 } : { min: 0, max: 255 };

  return (
    <TableRow>
      <TableCell className="font-mono text-fg-subtle">{position}</TableCell>
      <TableCell>
        <Input
          id={`${group}-name`}
          inlineDot
          aria-label="Device name"
          size="sm"
          className="w-40"
          value={form.name}
          maxLength={128}
          onChange={(e) => set("name", e.target.value)}
        />
      </TableCell>
      <TableCell>
        <Input
          id={`${group}-manufacturer`}
          inlineDot
          aria-label="Manufacturer"
          size="sm"
          className="w-32"
          value={form.manufacturer}
          maxLength={128}
          onChange={(e) => set("manufacturer", e.target.value)}
        />
      </TableCell>
      <TableCell>
        <Input
          id={`${group}-slave`}
          inlineDot
          aria-label="Slave"
          type="number"
          size="sm"
          className="w-20"
          value={form.slave}
          min={slaveRange.min}
          max={slaveRange.max}
          onChange={(e) => set("slave", Number(e.target.value))}
        />
      </TableCell>
      <TableCell>
        <Select
          id={`${group}-baseRegister`}
          inlineDot
          aria-label="Base register"
          size="sm"
          className="w-24"
          value={form.baseRegister}
          onValueChange={(value) => set("baseRegister", Number(value) as 0 | 1)}
          options={[{ value: "0", label: "0-based" }, { value: "1", label: "1-based" }]}
        />
      </TableCell>
      {locator.kind === "rtu" && (
        <TableCell>
          <Input
            id={`${group}-timeout`}
            inlineDot
            aria-label="Timeout"
            type="number"
            size="sm"
            className="w-24"
            value={form.timeout}
            min={DEVICE_TIMEOUT_RANGE.min}
            max={DEVICE_TIMEOUT_RANGE.max}
            onChange={(e) => set("timeout", Number(e.target.value))}
          />
        </TableCell>
      )}
      <TableCell>
        <PropertyCheckbox
          id={`${group}-enabled`}
          aria-label="Enabled"
          checked={form.enabled}
          onChange={(e) => set("enabled", e.target.checked)}
        />
        <ImmediatePropertyError id={`${group}-enabled`} />
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <Button size="sm" variant="ghost-destructive" disabled={busy} onClick={() => setConfirmRemove(true)}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          Remove
        </Button>
        {error && !confirmRemove && <p role="alert" className="text-xs text-error">{error}</p>}
        {confirmRemove && (
          <Modal
            title={`Remove device ${position}`}
            description={`${device.name || "This device"} is removed and later devices on this node are renumbered. Signals of later devices keep pointing at the same device.`}
            ctaLabel="Remove device"
            ctaDisabled={busy}
            width={540}
            onClose={() => setConfirmRemove(false)}
            onConfirm={() =>
              void save([
                { type: "removeDevice", locator, deviceIndex: position, signals: signalMode },
              ]).then((ok) => ok && setConfirmRemove(false))
            }
          >
            <div className="text-[12.5px] text-text-body">
              {signals.length === 0 ? (
                <p>No signals use this device.</p>
              ) : (
                <fieldset className="space-y-2">
                  <legend className="mb-2 font-bold">
                    {`${signals.length} ${signals.length === 1 ? "signal uses" : "signals use"} this device`}
                  </legend>
                  <label className="flex items-start gap-2">
                    <Radio
                      name={`${group}-signals`}
                      checked={signalMode === "delete"}
                      onChange={() => setSignalMode("delete")}
                    />
                    <span>Delete the device and its signals</span>
                  </label>
                  <label className="flex items-start gap-2">
                    <Radio
                      name={`${group}-signals`}
                      checked={signalMode === "unassign"}
                      onChange={() => setSignalMode("unassign")}
                    />
                    <span>
                      Delete only the device. Its signals are kept without a device and deactivated, to be
                      assigned to another device{virtual > 0 ? `; ${virtual} virtual ${virtual === 1 ? "signal is" : "signals are"} still deleted` : ""}.
                    </span>
                  </label>
                </fieldset>
              )}
              {pendingCount > 0 && (
                <p className="mt-3">{`${pendingCount} unsaved ${pendingCount === 1 ? "edit" : "edits"} on this device ${pendingCount === 1 ? "is" : "are"} discarded.`}</p>
              )}
              {error && <p role="alert" className="mt-3 text-sm text-error">{error}</p>}
            </div>
          </Modal>
        )}
      </TableCell>
    </TableRow>
  );
}
