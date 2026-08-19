"use client";

import * as React from "react";
import { Trash2, X } from "lucide-react";
import type { MeMbsProject, MeMbsSignal } from "@/gateway-families/me-mbs/model";
import { describeSpec, GENERAL_SPECS, GROUP_SPECS } from "@/protocols/me";
import { MAX_ADDRESS, READ_WRITE } from "@/protocols/modbus/slave";
import { FORMAT_LABELS } from "@/protocols/modbus/master/types";
import type { SignalPatchInput } from "@/lib/project-types";
import { useSave } from "@/lib/use-save";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

const ACCESS_LABELS: Record<number, string> = {
  [READ_WRITE.READ]: "Read",
  [READ_WRITE.TRIGGER]: "Trigger (one-shot write)",
  [READ_WRITE.READWRITE]: "Read–write",
};

/**
 * 372px right-hand edit drawer for one ME–MBS signal. Edits what the family
 * `xml-ops` supports: description, the ME endpoint (controller/group/spec/
 * status) and the Modbus Slave endpoint (address/format/access/length).
 */
export function MeMbsSignalDrawer({
  signal,
  project,
  onClose,
  onRemoved,
}: {
  signal: MeMbsSignal;
  project: MeMbsProject;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const { save, busy, error } = useSave();
  const [confirmRemove, setConfirmRemove] = React.useState(false);

  const [description, setDescription] = React.useState(signal.description);
  const [g50Index, setG50Index] = React.useState(signal.me.g50Index);
  const [groupIndex, setGroupIndex] = React.useState(signal.me.groupIndex);
  const [isStatus, setIsStatus] = React.useState(signal.me.isStatus);
  const [spec, setSpec] = React.useState(signal.me.signalSpecIndex);
  const [address, setAddress] = React.useState(String(signal.modbus.address));
  const [lenBits, setLenBits] = React.useState(signal.modbus.lenBits);
  const [format, setFormat] = React.useState(signal.modbus.format);
  const [readWrite, setReadWrite] = React.useState<number>(signal.modbus.readWrite);
  const [formError, setFormError] = React.useState<string | null>(null);

  const controller = project.me.controllers[g50Index];
  const groups = controller?.groups.filter((g) => g.enabled) ?? [];
  const general = groupIndex < 0;
  const specOptions = general ? GENERAL_SPECS : GROUP_SPECS;
  const selectedGroup = controller?.groups.find((g) => g.index === groupIndex);
  const specInfo = describeSpec(spec, {
    general,
    fanSpeeds: selectedGroup?.fanSpeeds ?? 4,
    temperatureMode: project.me.temperatureMode,
  });

  async function handleSave() {
    setFormError(null);
    const register = Number(address);
    if (!Number.isInteger(register) || register < 0 || register > MAX_ADDRESS) {
      setFormError(`Invalid register address — 0–${MAX_ADDRESS}`);
      return;
    }
    const patch: SignalPatchInput = {
      description,
      me: { g50Index, groupIndex, isStatus, signalSpecIndex: spec },
      modbus: { address: register, lenBits, format, readWrite: readWrite as 0 | 1 | 2 },
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

        <section className="space-y-3" aria-label="Mitsubishi Electric side">
          <h3 className="font-mono text-[10.5px] font-medium uppercase tracking-wider text-fg-muted">
            Mitsubishi Electric side
          </h3>
          <Field label="Controller" htmlFor="sig-controller">
            <Select
              id="sig-controller"
              value={g50Index}
              onChange={(e) => {
                setG50Index(Number(e.target.value));
                setGroupIndex(-1);
              }}
            >
              {project.me.controllers.map((c, i) => (
                <option key={i} value={i}>
                  Controller {i + 1}
                  {c.description ? ` — ${c.description}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Group" htmlFor="sig-group">
            <Select
              id="sig-group"
              value={groupIndex}
              onChange={(e) => setGroupIndex(Number(e.target.value))}
            >
              <option value={-1}>Controller-wide (general)</option>
              {groups.map((g) => (
                <option key={g.index} value={g.index}>
                  Group {g.index + 1}
                  {g.description ? ` — ${g.description}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="AC parameter"
            hint={specInfo ? specInfo.allowedValues : "Unknown spec — check the documentation"}
            htmlFor="sig-spec"
          >
            <Select id="sig-spec" value={spec} onChange={(e) => setSpec(Number(e.target.value))}>
              {specInfo === undefined && <option value={spec}>Unknown ({spec})</option>}
              {Object.values(specOptions).map((info) => (
                <option key={info.spec} value={info.spec}>
                  {info.spec} ·{" "}
                  {describeSpec(info.spec, {
                    general,
                    fanSpeeds: selectedGroup?.fanSpeeds ?? 4,
                    temperatureMode: project.me.temperatureMode,
                  })?.description ?? info.description}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isStatus} onChange={(e) => setIsStatus(e.target.checked)} />
            Status signal
            <span className="text-[11px] text-fg-subtle">Read from the AC bus (off = command)</span>
          </label>
        </section>

        <section className="space-y-3" aria-label="Modbus side">
          <h3 className="font-mono text-[10.5px] font-medium uppercase tracking-wider text-fg-muted">
            Modbus Slave side
          </h3>
          <div className="grid grid-cols-2 gap-3">
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
            <Field label="Access" htmlFor="sig-access">
              <Select
                id="sig-access"
                value={readWrite}
                onChange={(e) => setReadWrite(Number(e.target.value))}
              >
                {Object.entries(ACCESS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {value} · {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Length (bits)" htmlFor="sig-lenbits">
              <Select id="sig-lenbits" value={lenBits} onChange={(e) => setLenBits(Number(e.target.value))}>
                {[16, 32].map((len) => (
                  <option key={len} value={len}>
                    {len}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Format" htmlFor="sig-format">
              <Select id="sig-format" value={format} onChange={(e) => setFormat(Number(e.target.value))}>
                <option value={0}>{FORMAT_LABELS[0]}</option>
                <option value={1}>{FORMAT_LABELS[1]}</option>
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
