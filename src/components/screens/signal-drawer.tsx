"use client";

import * as React from "react";
import { Trash2, X } from "lucide-react";
import type { KnxMbmProject, KnxMbmSignal } from "@/gateway-families/knx-mbm/model";
import { formatGroupAddress, isValidGroupAddress, parseGroupAddress } from "@/protocols/knx/address";
import { formatDpt, isValidDpt, parseDpt } from "@/protocols/knx/dpt";
import { applyFlagChange, type KnxFlags } from "@/protocols/knx/flags";
import {
  BYTE_ORDER_LABELS,
  FORMAT_LABELS,
  LEN_BITS,
  MAX_ADDRESS,
  portForTcpNode,
  READ_FUNCTIONS,
  WRITE_FUNCTIONS,
} from "@/protocols/modbus/master";
import type { SignalPatchInput } from "@/lib/project-types";
import { useSave } from "@/lib/use-save";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

const FLAG_LABELS: Record<keyof KnxFlags, string> = {
  u: "U — Update on start-up",
  t: "T — Transmit",
  ri: "Ri — Read on init",
  w: "W — Writable",
  r: "R — Readable",
};

const READ_LABELS: Record<number, string> = {
  1: "1 · Read coils",
  2: "2 · Read discrete inputs",
  3: "3 · Read holding registers",
  4: "4 · Read input registers",
};

const WRITE_LABELS: Record<number, string> = {
  5: "5 · Write single coil",
  6: "6 · Write single register",
  15: "15 · Write multiple coils",
  16: "16 · Write multiple registers",
};

/**
 * 372px right-hand edit drawer for one signal, per the design reference
 * (border-left, white, subtle left shadow). Saves via updateSignal patches.
 */
export function SignalDrawer({
  signal,
  project,
  onClose,
  onRemoved,
}: {
  signal: KnxMbmSignal;
  project: KnxMbmProject;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const { save, busy, error } = useSave();
  const [confirmRemove, setConfirmRemove] = React.useState(false);

  const [description, setDescription] = React.useState(signal.description);
  const [groupAddress, setGroupAddress] = React.useState(
    signal.knx.groupAddress > 0 ? formatGroupAddress(signal.knx.groupAddress) : "",
  );
  const [dpt, setDpt] = React.useState(formatDpt(signal.knx.dpt));
  const [flags, setFlags] = React.useState<KnxFlags>({ ...signal.knx.flags });
  const [port, setPort] = React.useState(signal.modbus.port);
  const [deviceIndex, setDeviceIndex] = React.useState(signal.modbus.deviceIndex);
  const [isBroadcast, setIsBroadcast] = React.useState(signal.modbus.isBroadcast);
  const [readFunc, setReadFunc] = React.useState(signal.modbus.readFunc);
  const [writeFunc, setWriteFunc] = React.useState(signal.modbus.writeFunc);
  const [address, setAddress] = React.useState(String(signal.modbus.address));
  const [lenBits, setLenBits] = React.useState(signal.modbus.lenBits);
  const [format, setFormat] = React.useState(signal.modbus.format);
  const [byteOrder, setByteOrder] = React.useState(signal.modbus.byteOrder);
  const [formError, setFormError] = React.useState<string | null>(null);

  const { mbm } = project;
  const nodeOptions: { port: number; label: string }[] = [
    ...mbm.rtuNodes.map((node, i) => ({
      port: i,
      label: `RTU ${i + 1} — ${node.baudrate} baud, port ${node.physicalPort === 0 ? "A" : "B"}`,
    })),
    ...mbm.tcpNodes.map((node, i) => ({
      port: portForTcpNode(mbm, i),
      label: `TCP ${i + 1} — ${node.ip}:${node.port}`,
    })),
  ];

  const selectedNode =
    port < mbm.rtuNodes.length ? mbm.rtuNodes[port] : mbm.tcpNodes[port - mbm.rtuNodes.length];
  const deviceOptions = selectedNode?.devices ?? [];

  async function handleSave() {
    setFormError(null);
    const ga = parseGroupAddress(groupAddress);
    if (ga === undefined || !isValidGroupAddress(ga, { extended: project.knx.extendedAddresses })) {
      setFormError(
        `Invalid group address — expected main/middle/sub (max ${project.knx.extendedAddresses ? "31/7/255" : "15/7/255"})`,
      );
      return;
    }
    const dptValue = parseDpt(dpt);
    if (dptValue === undefined || !isValidDpt(dptValue)) {
      setFormError("Invalid DPT — expected e.g. 9.001 or 1.x (common families only)");
      return;
    }
    const register = Number(address);
    if (!Number.isInteger(register) || register < 0 || register > MAX_ADDRESS) {
      setFormError(`Invalid register address — 0–${MAX_ADDRESS}`);
      return;
    }
    const patch: SignalPatchInput = {
      description,
      knx: { groupAddress: ga, dpt: dptValue, flags },
      modbus: {
        port,
        deviceIndex: isBroadcast ? -1 : deviceIndex,
        isBroadcast,
        readFunc,
        writeFunc,
        address: register,
        lenBits,
        format,
        byteOrder,
      },
    };
    if (await save([{ type: "updateSignal", id: signal.id, patch }])) onClose();
  }

  async function handleRemove() {
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    if (await save([{ type: "removeSignal", id: signal.id }])) onRemoved();
  }

  return (
    <aside
      aria-label={`Edit signal ${signal.id}`}
      className="flex w-[372px] shrink-0 flex-col border-l border-border bg-white shadow-[-8px_0_24px_rgba(4,61,93,0.06)]"
    >
      <div className="flex items-start gap-2 border-b border-border px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10.5px] tracking-[0.07em] text-fg-subtle">
            SIGNAL {signal.id}
          </div>
          <div className="mt-0.5 truncate font-display text-base font-medium leading-tight text-hms-blue">
            {signal.description || "(no description)"}
          </div>
        </div>
        <Button size="icon" variant="ghost" aria-label="Close drawer" onClick={onClose}>
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <Field label="Description" htmlFor="sig-desc">
          <Input
            id="sig-desc"
            value={description}
            maxLength={128}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <section className="space-y-3" aria-label="KNX side">
          <h3 className="font-mono text-[10.5px] font-medium uppercase tracking-wider text-fg-muted">
            KNX side
          </h3>
          <Field label="Group address" hint="main/middle/sub, e.g. 1/0/3" htmlFor="sig-ga">
            <Input
              id="sig-ga"
              value={groupAddress}
              className="font-mono"
              onChange={(e) => setGroupAddress(e.target.value)}
            />
          </Field>
          <Field label="DPT" hint="e.g. 1.001, 9.001 or 1.x" htmlFor="sig-dpt">
            <Input
              id="sig-dpt"
              value={dpt}
              className="font-mono"
              onChange={(e) => setDpt(e.target.value)}
            />
          </Field>
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-text-body">Flags</legend>
            {(Object.keys(FLAG_LABELS) as (keyof KnxFlags)[]).map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={flags[key]}
                  onChange={() => setFlags((prev) => applyFlagChange({ ...prev, [key]: !prev[key] }, key))}
                />
                {FLAG_LABELS[key]}
              </label>
            ))}
          </fieldset>
        </section>

        <section className="space-y-3" aria-label="Modbus side">
          <h3 className="font-mono text-[10.5px] font-medium uppercase tracking-wider text-fg-muted">
            Modbus side
          </h3>
          <Field label="Node" htmlFor="sig-node">
            <Select
              id="sig-node"
              value={port}
              onChange={(e) => {
                setPort(Number(e.target.value));
                setDeviceIndex(-1);
              }}
            >
              <option value={-1}>Not set</option>
              {nodeOptions.map((opt) => (
                <option key={opt.port} value={opt.port}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Device" htmlFor="sig-device">
            <Select
              id="sig-device"
              value={isBroadcast ? -1 : deviceIndex}
              disabled={isBroadcast || deviceOptions.length === 0}
              onChange={(e) => setDeviceIndex(Number(e.target.value))}
            >
              <option value={-1}>Not set</option>
              {deviceOptions.map((device) => (
                <option key={device.index} value={device.index}>
                  {device.name} (slave {device.slave})
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isBroadcast} onChange={(e) => setIsBroadcast(e.target.checked)} />
            Broadcast (all devices on the node)
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Read function" htmlFor="sig-read">
              <Select id="sig-read" value={readFunc} onChange={(e) => setReadFunc(Number(e.target.value))}>
                <option value={-1}>None</option>
                {READ_FUNCTIONS.map((fn) => (
                  <option key={fn} value={fn}>
                    {READ_LABELS[fn]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Write function" htmlFor="sig-write">
              <Select id="sig-write" value={writeFunc} onChange={(e) => setWriteFunc(Number(e.target.value))}>
                <option value={-1}>None</option>
                {WRITE_FUNCTIONS.map((fn) => (
                  <option key={fn} value={fn}>
                    {WRITE_LABELS[fn]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Register address" htmlFor="sig-register">
              <Input
                id="sig-register"
                type="number"
                className="font-mono"
                value={address}
                min={0}
                max={MAX_ADDRESS}
                onChange={(e) => setAddress(e.target.value)}
              />
            </Field>
            <Field label="Length (bits)" htmlFor="sig-lenbits">
              <Select id="sig-lenbits" value={lenBits} onChange={(e) => setLenBits(Number(e.target.value))}>
                {LEN_BITS.map((len) => (
                  <option key={len} value={len}>
                    {len}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Format" htmlFor="sig-format">
              <Select id="sig-format" value={format} onChange={(e) => setFormat(Number(e.target.value))}>
                {Object.entries(FORMAT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Byte order" htmlFor="sig-byteorder">
              <Select
                id="sig-byteorder"
                value={byteOrder}
                onChange={(e) => setByteOrder(Number(e.target.value))}
              >
                {Object.entries(BYTE_ORDER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </section>
      </div>

      <div className="space-y-2 border-t border-border px-4 py-3">
        {(formError || error) && (
          <p role="alert" className="text-sm text-error">
            {formError ?? error}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <Button
            size="sm"
            variant={confirmRemove ? "destructive" : "ghost"}
            disabled={busy}
            onClick={() => void handleRemove()}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            {confirmRemove ? "Confirm remove" : "Remove signal"}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void handleSave()}>
            Save signal
          </Button>
        </div>
      </div>
    </aside>
  );
}
