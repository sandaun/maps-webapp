"use client";

import { Ban, Download } from "lucide-react";
import { exportProjectUrl } from "@/lib/api";
import { ScreenGate } from "@/components/screens/screen-gate";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Deploy screen: export the project file and inspect round-trip capability.
 * Deploying a modified project stays disabled until the `knxMbmXblVerified`
 * capability exists (byte-exact XBL verification against a real KNX–MBM
 * fixture, which is not available yet).
 */
export function DeployScreen() {
  return <ScreenGate>{(view) => <DeployContent {...view} />}</ScreenGate>;
}

function DeployContent({
  meta,
  hasCompleteBlob,
}: {
  meta: { id: string; name: string };
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

      <Card>
        <CardHeader>
          <CardTitle>Deploy to gateway</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-fg-muted">
            Deploying a modified project requires regenerating the binary XBL configuration. That
            path is blocked until the <code>knxMbmXblVerified</code> capability exists: a
            byte-exact verification of the generated XBL against a real KNX–MBM fixture, which is
            not available yet. Until then, no modified project can be sent to a gateway from this
            app.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled
              className="inline-flex h-7 cursor-not-allowed items-center justify-center gap-2 rounded bg-hms-muted px-3 text-xs font-medium text-fg-subtle"
              title="Blocked: knxMbmXblVerified capability not available"
            >
              <Ban className="h-3.5 w-3.5" aria-hidden />
              Deploy modified project (blocked)
            </button>
            <Badge variant="warning">Read-only towards gateways</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
