"use client";

import * as React from "react";
import { FileUp, FlaskConical } from "lucide-react";
import { loadDemoProject, openProjectFile } from "@/lib/api";
import { useCurrentProject } from "@/lib/current-project";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * "No project" empty state. Loading the demo is always an explicit, labelled
 * user action — never automatic.
 */
export function NoProjectState() {
  const { setProjectId } = useCurrentProject();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function handleDemo() {
    setBusy(true);
    setError(null);
    try {
      const meta = await loadDemoProject();
      setProjectId(meta.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the demo project");
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const meta = await openProjectFile(file);
      setProjectId(meta.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open the file");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>No project loaded</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-fg-muted">
          Load the labelled demo project or open a local <code>.ibmaps</code> file to start
          configuring.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={handleDemo} disabled={busy}>
            <FlaskConical className="h-3.5 w-3.5" aria-hidden />
            Load demo project
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            <FileUp className="h-3.5 w-3.5" aria-hidden />
            Open .ibmaps file
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".ibmaps,.bin,application/xml,text/xml"
            className="hidden"
            aria-label="Open project file"
            onChange={handleFile}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
