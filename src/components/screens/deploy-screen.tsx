"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Download, Upload, X } from "lucide-react";
import { exportProjectUrl } from "@/lib/api";
import {
  deployGatewayProject,
  getDeployStatus,
  listGatewaySessions,
  type DeployResult,
  type DeployStatus,
  type GatewaySessionStatus,
} from "@/lib/gateway-api";
import { useSessionEvents } from "@/lib/use-session-events";
import { ScreenGate } from "@/components/screens/screen-gate";
import { SessionLog, TransferProgressBar } from "@/components/session-log";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Deploy screen: export the project file, inspect round-trip capability and —
 * when every server-side gate passes for the project's family — deploy to a
 * connected gateway (SENDCMPLT, a WRITE operation). Both supported families
 * (knx-mbm, me-mbs) share the same gated card; the gate details come from the
 * server, so a family without its verified capability (or an unsupported
 * family) keeps the honest disabled explanation (docs/plans/knx-mbm-mvp.md,
 * Pas 2.6 / 3.4).
 */
export function DeployScreen() {
  return <ScreenGate>{(view) => <DeployContent {...view} />}</ScreenGate>;
}

function DeployContent({
  meta,
  hasCompleteBlob,
}: {
  meta: { id: string; name: string };
  family: "knx-mbm" | "me-mbs";
  hasCompleteBlob: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Export project file</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-fg-muted">
              Download <span className="font-medium text-text-body">{meta.name}</span> as an
              Intesis MAPS <code>.ibmaps</code> file that the desktop tool can open.
            </p>
            <a
              href={exportProjectUrl(meta.id)}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
              download
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Export .ibmaps
            </a>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Round-trip capability</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              {hasCompleteBlob ? (
                <Badge variant="success">Gateway blob available</Badge>
              ) : (
                <Badge variant="muted">No gateway blob</Badge>
              )}
            </div>
            <p className="text-sm text-fg-muted">
              {hasCompleteBlob
                ? "This project was received from a gateway and its original “complete” blob (XBL + project ZIP) is kept server-side, so an unmodified round-trip back to the gateway would be possible."
                : "This project has no stored gateway blob. Only the .ibmaps XML is available, so it cannot be sent back to a gateway unmodified."}
            </p>
          </CardContent>
        </Card>
      </div>

      <GatedDeployCard meta={meta} />
    </div>
  );
}

type DeployPhase = "idle" | "confirm" | "deploying" | "done" | "failed";

/**
 * Gated deploy for both supported families: server-reported gate list,
 * explicit confirmation and SSE progress. The card is identical per family;
 * the family-specific details (capability key, expected AppId) come from the
 * server's gate checks.
 */
function GatedDeployCard({ meta }: { meta: { id: string; name: string } }) {
  const [session, setSession] = React.useState<GatewaySessionStatus | null>(null);
  const [status, setStatus] = React.useState<DeployStatus | null>(null);
  const [statusError, setStatusError] = React.useState<string | null>(null);
  const [phase, setPhase] = React.useState<DeployPhase>("idle");
  const [result, setResult] = React.useState<DeployResult | null>(null);
  const [deployError, setDeployError] = React.useState<string | null>(null);

  const { log, progress } = useSessionEvents(session?.id ?? null);

  React.useEffect(() => {
    let cancelled = false;
    listGatewaySessions()
      .then(async (sessions) => {
        const first = sessions.find((s) => s.connected) ?? sessions[0] ?? null;
        if (cancelled || !first) return;
        setSession(first);
        const gateStatus = await getDeployStatus(first.id, meta.id);
        if (!cancelled) setStatus(gateStatus);
      })
      .catch((err: unknown) => {
        if (!cancelled) setStatusError(err instanceof Error ? err.message : "Gate check failed");
      });
    return () => {
      cancelled = true;
    };
  }, [meta.id]);

  async function handleConfirm() {
    if (!session) return;
    setPhase("deploying");
    setDeployError(null);
    setResult(null);
    try {
      const deployResult = await deployGatewayProject(session.id, meta.id);
      setResult(deployResult);
      setPhase("done");
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : "Deploy failed");
      setPhase("failed");
    }
  }

  const deployable = status?.deployable === true && session?.connected === true;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Deploy to gateway
            {status &&
              (deployable ? (
                <Badge variant="success">All gates pass</Badge>
              ) : (
                <Badge variant="warning">Blocked by a gate</Badge>
              ))}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-fg-muted">
            Deploying regenerates the binary XBL configuration from the current project (byte-exact
            verified generator) and writes it to the gateway with SENDCMPLT. The gateway applies it
            immediately.
          </p>

          {!session && !statusError && (
            <p className="text-sm text-fg-muted">
              No gateway session is open. Connect to the gateway from the{" "}
              <Link href="/connection" className="font-medium text-hms-accent hover:underline">
                Connection
              </Link>{" "}
              screen first.
            </p>
          )}
          {statusError && (
            <p role="alert" className="text-sm text-error">
              {statusError}
            </p>
          )}

          {status && (
            <ul aria-label="Deploy gates" className="space-y-1.5">
              {status.checks.map((check) => (
                <li key={check.id} className="flex items-start gap-2 text-[13px]">
                  {check.ok ? (
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                  ) : (
                    <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-error" aria-hidden />
                  )}
                  <span className="text-text-body">{check.detail}</span>
                </li>
              ))}
            </ul>
          )}

          {phase === "deploying" && progress && <TransferProgressBar progress={progress} />}

          {phase !== "confirm" && phase !== "deploying" && (
            <Button
              size="sm"
              onClick={() => setPhase("confirm")}
              disabled={!deployable}
              title={
                deployable
                  ? `Deploy to ${session.host}`
                  : "Blocked: a deploy gate does not pass (see above)"
              }
            >
              <Upload className="h-3.5 w-3.5" aria-hidden />
              Deploy to gateway
            </Button>
          )}

          {phase === "confirm" && session && (
            <div
              role="alertdialog"
              aria-label="Confirm deploy"
              className="space-y-3 rounded-lg border border-warning bg-hms-muted px-4 py-3"
            >
              <p className="text-sm text-text-body">
                This writes configuration to the gateway at{" "}
                <span className="font-mono font-medium">{session.host}</span>. The running
                configuration is replaced immediately.
              </p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="destructive" onClick={handleConfirm}>
                  Confirm deploy
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setPhase("idle")}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {phase === "done" && result && (
            <div className="space-y-1.5">
              <p className="text-sm text-success">
                Deployed “{meta.name}” ({result.bytes} bytes; XBL {result.xblBytes} B, ZIP{" "}
                {result.zipBytes} B, SW {result.swVersion}) — the gateway accepted the upload.
              </p>
              <p className="text-sm text-fg-muted">
                Tip: use “Receive from gateway” on the Connection screen afterwards to verify the
                gateway now runs the new configuration.
              </p>
            </div>
          )}
          {phase === "failed" && deployError && (
            <p role="alert" className="text-sm text-error">
              {deployError}
            </p>
          )}
        </CardContent>
      </Card>

      {(phase === "deploying" || phase === "done" || phase === "failed") && (
        <Card>
          <CardHeader>
            <CardTitle>Activity log</CardTitle>
          </CardHeader>
          <CardContent>
            <SessionLog log={log} emptyHint="No activity yet." />
          </CardContent>
        </Card>
      )}
    </>
  );
}
