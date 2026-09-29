"use client";

import * as React from "react";
import { isNewProjectPasswordValid, PROJECT_PASSWORD_INPUT_HINT, PROJECT_PASSWORD_MAX_LENGTH } from "@/core/validation/project-password";
import { usePatch } from "@/lib/current-project";
import { PROJECT_REPLACED_EVENT } from "@/lib/project-events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldRow, GroupCard, SectionHeader } from "./configuration-blocks";

/** Secret inputs stay here, outside persisted property drafts and undo. */
export function PasswordSection({ passwordValid }: { passwordValid: boolean }) {
  const patch = usePatch();
  const [password, setPassword] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    const clear = () => {
      setPassword("");
      setConfirmation("");
      setSaved(false);
      setError(null);
    };
    window.addEventListener(PROJECT_REPLACED_EVENT, clear);
    return () => window.removeEventListener(PROJECT_REPLACED_EVENT, clear);
  }, []);

  const invalid = password.length > 0 && !isNewProjectPasswordValid(password);
  const mismatch = confirmation.length > 0 && password !== confirmation;
  const canSave = isNewProjectPasswordValid(password) && password === confirmation && !saving;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await patch([{ type: "setProjectPassword", password }]);
      setPassword("");
      setConfirmation("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the project password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SectionHeader title="Security" desc="Set the gateway password that this project will apply on the next deploy." />
      <GroupCard label="Project password" tag={passwordValid ? "Configured" : "Required before deploy"} tagTone={passwordValid ? "info" : "warning"}>
        <p className="py-3 text-[12px] text-fg-muted">
          The current password is never displayed. Saving here updates the project; deploy it to change the gateway password.
        </p>
        <form onSubmit={save}>
          <FieldRow label="New password" hint={PROJECT_PASSWORD_INPUT_HINT}>
            <Input
              aria-label="New password"
              aria-invalid={invalid}
              aria-describedby={invalid ? "password-invalid" : undefined}
              type="password"
              autoComplete="new-password"
              maxLength={PROJECT_PASSWORD_MAX_LENGTH}
              value={password}
              disabled={saving}
              onChange={(e) => { setPassword(e.target.value); setSaved(false); setError(null); }}
              className="max-w-[260px]"
            />
            {invalid && <p id="password-invalid" role="alert" className="mt-2 text-xs text-error">{PROJECT_PASSWORD_INPUT_HINT}</p>}
          </FieldRow>
          <FieldRow label="Confirm password">
            <Input
              aria-label="Confirm password"
              aria-invalid={mismatch}
              aria-describedby={mismatch ? "password-mismatch" : undefined}
              type="password"
              autoComplete="new-password"
              maxLength={PROJECT_PASSWORD_MAX_LENGTH}
              value={confirmation}
              disabled={saving}
              onChange={(e) => { setConfirmation(e.target.value); setSaved(false); setError(null); }}
              className="max-w-[260px]"
            />
            {mismatch && <p id="password-mismatch" role="alert" className="mt-2 text-xs text-error">Passwords do not match.</p>}
          </FieldRow>
          <div className="mt-4 flex items-center gap-3">
            <Button type="submit" size="sm" disabled={!canSave}>{saving ? "Saving…" : "Save password"}</Button>
            {saved && <p role="status" className="text-xs text-success">Password saved to the project.</p>}
          </div>
          {error && <p role="alert" className="mt-3 text-xs text-error">{error}</p>}
        </form>
      </GroupCard>
    </>
  );
}
