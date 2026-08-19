"use client";

import type { MeMbsProject } from "@/gateway-families/me-mbs/model";
import { GROUP_TYPE_LABELS } from "@/protocols/me";
import { ADDRESS_MODES, SLAVE_ADDRESS_MODES } from "@/protocols/modbus/slave";
import type { ProjectView } from "@/lib/project-types";
import { ScreenIssues } from "@/components/screens/screen-gate";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const MEDIA_LABELS: Record<number, string> = { 0: "RTU", 1: "TCP", 2: "RTU + TCP" };

/**
 * ME–MBS "devices": the Modbus Slave side has no nodes/devices (the gateway
 * is the server), so this screen shows the ME controller/group topology plus
 * a Modbus Slave summary. Read-only for now: controller/group edits are
 * supported by the patch API but not wired into this screen yet.
 */
export function MeMbsDevicesView({
  view,
}: {
  view: Extract<ProjectView, { family: "me-mbs" }>;
}) {
  const { project } = view;
  return (
    <div className="max-w-5xl space-y-4">
      <ScreenIssues issues={view.issues} screen="devices" />
      <p className="text-sm text-fg-muted">
        Mitsubishi Electric controllers and their groups, and the Modbus Slave configuration.
        Editing controllers and groups is not wired into this screen yet — the view is read-only.
      </p>

      <MbsSummaryCard project={project} />

      {project.me.controllers.map((controller, ci) => (
        <ControllerCard key={ci} controller={controller} index={ci} />
      ))}
    </div>
  );
}

function MbsSummaryCard({ project }: { project: MeMbsProject }) {
  const { mbs } = project;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Modbus Slave</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          <Row label="Media" value={MEDIA_LABELS[mbs.media] ?? String(mbs.media)} />
          <Row label="Byte order" value={mbs.byteOrder === 0 ? "Big endian" : `Code ${mbs.byteOrder}`} />
          <Row label="Address mode" value={mbs.addressMode === ADDRESS_MODES.FIXED ? "Fixed" : mbs.addressMode === ADDRESS_MODES.CUSTOM ? "Custom" : "V4 compatibility"} />
          <Row label="Slave address mode" value={mbs.slaveAddressMode === SLAVE_ADDRESS_MODES.SINGLE ? "Single" : "Multiple"} />
          <Row label="RTU slave id" value={String(mbs.rtu.slaveNumber)} />
          <Row
            label="RTU link"
            value={`${mbs.rtu.baudrate} baud, ${mbs.rtu.dataBits}${"NOE"[mbs.rtu.parity] ?? "?"}${mbs.rtu.stopBits}`}
          />
          <Row label="TCP port" value={String(mbs.tcp.port)} />
          <Row label="Comm. error timeout" value={`${mbs.commErrorTout} s`} />
        </dl>
        {mbs.slaves.length > 0 && (
          <div className="space-y-1">
            <h3 className="font-mono text-[10.5px] font-medium uppercase tracking-wider text-fg-muted">
              Virtual slaves ({mbs.slaves.length})
            </h3>
            <ul className="flex flex-wrap gap-1.5">
              {mbs.slaves.map((slave) => (
                <li key={slave.address}>
                  <Badge variant="muted">
                    {slave.address}
                    {slave.description ? ` · ${slave.description}` : ""}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ControllerCard({
  controller,
  index,
}: {
  controller: MeMbsProject["me"]["controllers"][number];
  index: number;
}) {
  const enabledGroups = controller.groups.filter((g) => g.enabled);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Controller {index + 1}
          {controller.description ? `— ${controller.description}` : ""}
          <Badge variant={controller.enabled ? "success" : "muted"}>
            {controller.enabled ? "Enabled" : "Disabled"}
          </Badge>
          <Badge variant="muted">
            {enabledGroups.length} / {controller.groups.length} groups enabled
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          <Row label="IP" value={controller.ip ? `${controller.ip}:${controller.port}` : "—"} />
          <Row label="Model" value={CONTROLLER_MODEL_LABELS[controller.model] ?? String(controller.model)} />
        </dl>
        {enabledGroups.length === 0 ? (
          <p className="text-sm text-fg-muted">No enabled groups.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Group</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Fan speeds</TableHead>
                <TableHead>Dual setpoint</TableHead>
                <TableHead>URC</TableHead>
                <TableHead>Capacity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {enabledGroups.map((group) => (
                <TableRow key={group.index}>
                  <TableCell className="font-mono text-fg-subtle">{group.index + 1}</TableCell>
                  <TableCell>{group.description || "—"}</TableCell>
                  <TableCell>{GROUP_TYPE_LABELS[group.type] ?? `Type ${group.type}`}</TableCell>
                  <TableCell className="font-mono">{group.fanSpeeds}</TableCell>
                  <TableCell>{group.dualSetPoint ? "Yes" : "No"}</TableCell>
                  <TableCell>{group.urc ? "Yes" : "No"}</TableCell>
                  <TableCell className="font-mono">{group.capacity >= 0 ? group.capacity : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

const CONTROLLER_MODEL_LABELS: Record<number, string> = {
  0: "AG-150",
  1: "EB-50GU",
  2: "AE-200",
  3: "AE-C400E",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="font-mono text-xs font-medium text-text-body">{value}</dd>
    </div>
  );
}
