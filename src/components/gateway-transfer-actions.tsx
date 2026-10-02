"use client";

import * as React from "react";
import { Download, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { TransferProgressBar } from "@/components/session-log";
import { useCurrentProject } from "@/lib/current-project";
import { receiveGatewayProject } from "@/lib/gateway-api";
import { useGatewaySession } from "@/lib/gateway-session";
import { usePendingPropertyChanges, useSaveInProgress } from "@/lib/property-drafts";
import { useSessionEvents } from "@/lib/use-session-events";
import { useWorkspaceChrome } from "@/lib/workspace-chrome";

const BUTTON_CLASS = "h-[34px] rounded-[4px] px-[15px] text-[13px] font-medium";

export function GatewayTransferActions() {
  const router = useRouter();
  const { view, loading, mutating, setProjectId } = useCurrentProject();
  const { session, loading: sessionLoading } = useGatewaySession();
  const { dirtyCount, bumpDirty } = useWorkspaceChrome();
  const pendingProperties = usePendingPropertyChanges();
  const saving = useSaveInProgress();
  const { progress, status } = useSessionEvents(session?.id ?? null);
  const [confirmation, setConfirmation] = React.useState<string | null>(null);
  const [receiving, setReceiving] = React.useState(false);
  const [message, setMessage] = React.useState<{ text: string; error: boolean } | null>(null);
  const inFlight = React.useRef(false);
  const [previousProgress, setPreviousProgress] = React.useState<typeof progress>(null);

  const connected = session?.connected === true && status?.connected !== false;
  const busy = receiving || session?.busy === true || status?.busy === true;
  const disabled = sessionLoading || loading || !connected || busy || !!mutating || saving;
  const pending = dirtyCount + pendingProperties;
  const reason = !connected
    ? "Connect to a gateway first"
    : busy
      ? "Wait for the current gateway operation to finish"
      : mutating || saving || loading
        ? "Wait for the project to finish saving or loading"
        : undefined;

  async function receive(expectedSessionId: string) {
    // Recheck after confirmation: it may have been open during a disconnect,
    // another gateway operation or a switch to a different gateway.
    if (disabled || !session || session.id !== expectedSessionId || inFlight.current) return;
    inFlight.current = true;
    setPreviousProgress(progress);
    setConfirmation(null);
    setReceiving(true);
    setMessage(null);
    try {
      const meta = await receiveGatewayProject(expectedSessionId);
      setProjectId(meta.id);
      bumpDirty(-dirtyCount);
      setMessage({ text: `Received “${meta.name}” — it is now the current project.`, error: false });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Receive failed", error: true });
    } finally {
      inFlight.current = false;
      setReceiving(false);
    }
  }

  return (
    <div className="relative flex shrink-0 items-center gap-2" role="group" aria-label="Gateway transfer">
      <Button
        variant="secondary"
        className={BUTTON_CLASS}
        disabled={disabled}
        title={reason ?? `Receive project from ${session?.host}`}
        onClick={() => {
          if (!session) return;
          if (pending > 0) setConfirmation(session.id);
          else void receive(session.id);
        }}
      >
        <Download className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        {receiving ? "Receiving…" : "Receive"}
      </Button>
      <Button
        className={BUTTON_CLASS}
        disabled={disabled || !view}
        title={reason ?? (!view ? "Open a project first" : "Review and deploy the current project")}
        onClick={() => router.push("/deploy")}
      >
        <Upload className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        Deploy
      </Button>

      {confirmation && (
        <Modal
          title="Receive project from gateway?"
          description="Receiving opens the gateway configuration as a new current project."
          ctaLabel="Receive project"
          ctaDisabled={disabled || session?.id !== confirmation}
          onConfirm={() => void receive(confirmation)}
          onClose={() => setConfirmation(null)}
        >
          <p className="text-sm text-text-body">
            You have {pending} pending {pending === 1 ? "change" : "changes"} in the current project.
            Your local project and its drafts will stay available in Projects, but these changes
            will not be included in the project received from the gateway.
          </p>
        </Modal>
      )}

      {(receiving || message) && (
        <div
          role={message?.error ? "alert" : "status"}
          className="absolute right-0 top-[calc(100%+12px)] z-40 w-[360px] max-w-[calc(100vw-32px)] rounded-lg border border-border bg-white p-4 shadow-lg"
        >
          <div className="flex items-start gap-3">
            <p className={`flex-1 text-sm ${message?.error ? "text-error" : receiving ? "text-text-body" : "text-success"}`}>
              {receiving ? "Receiving project from gateway…" : message?.text}
            </p>
            {!receiving && (
              <button type="button" aria-label="Dismiss receive result" onClick={() => setMessage(null)}>
                <X className="size-4 text-fg-muted" aria-hidden />
              </button>
            )}
          </div>
          {receiving && progress && progress !== previousProgress && (
            <div className="mt-3"><TransferProgressBar progress={progress} /></div>
          )}
        </div>
      )}
    </div>
  );
}
