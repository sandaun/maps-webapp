"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Check, Download, Upload, X } from "lucide-react";
import { ApiError, exportProjectUrl } from "@/lib/api";
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

/** Export and deploy the current project, with server checks and confirmation. */
const DEPLOY_UNAVAILABLE = "Deploy is unavailable in this installation.";

export function DeployScreen() {
  return <ScreenGate>{(view) => <DeployContent {...view} />}</ScreenGate>;
}

function DeployContent({ meta }: { meta: { id: string; name: string } }) {
  return (
    <div className="space-y-4">
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
        if (!cancelled) setStatusError(err instanceof Error ? err.message : "Could not check deployment requirements");
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
      // The confirmation showed the warnings: the user accepted them.
      const confirmed = status?.warnings.map((warning) => warning.id) ?? [];
      const deployResult = await deployGatewayProject(session.id, meta.id, confirmed);
      setResult(deployResult);
      setPhase("done");
    } catch (err) {
      setDeployError(err instanceof ApiError && err.status === 403
        ? DEPLOY_UNAVAILABLE
        : err instanceof Error ? err.message : "Deploy failed");
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
                <Badge variant="success">Ready to deploy</Badge>
              ) : (
                <Badge variant="warning">Cannot deploy</Badge>
              ))}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-fg-muted">
            Send the current project to the connected gateway. This replaces the configuration
            currently running on the gateway.
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

          {status?.checks.some((check) => check.id === "capability" && !check.ok) && (
            <p role="alert" className="text-sm text-error">{DEPLOY_UNAVAILABLE}</p>
          )}
          {status && (
            <ul aria-label="Deploy requirements" className="space-y-1.5">
              {status.checks.filter((check) => check.id !== "capability").map((check) => (
                <li key={check.id} className="flex items-start gap-2 text-[13px]">
                  {check.ok ? (
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                  ) : (
                    <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-error" aria-hidden />
                  )}
                  <span className="text-text-body">
                    {check.id === "session-appid" && check.ok
                      ? "Connected gateway is compatible with this project"
                      : check.id === "family" && !check.ok
                        ? "This gateway type is not supported for deployment"
                        : check.detail}
                    {check.id === "password" && !check.ok && (
                      <> <Link href="/configuration?section=security" className="font-medium text-hms-accent hover:underline">Set password</Link></>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {status && status.warnings.length > 0 && (
            <ul aria-label="Deploy warnings" className="space-y-1.5">
              {status.warnings.map((warning) => (
                <li key={warning.id} className="flex items-start gap-2 text-[13px]">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-text" aria-hidden />
                  <span className="text-text-body">{warning.message}</span>
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
                  : "Resolve the deployment requirements shown above"
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
              {/* MAPS appends "Do you want to continue?" to each warning before sending. */}
              {status?.warnings.map((warning) => (
                <p key={warning.id} className="text-sm font-medium text-text-body">
                  {warning.message} Do you want to continue?
                </p>
              ))}
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
                Deployed “{meta.name}” — the gateway accepted the upload.
              </p>
              <p className="text-sm text-fg-muted">
                Tip: use “Receive” in the header afterwards to verify the
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
