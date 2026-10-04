"use client";

import * as React from "react";
import { request } from "@/lib/api";
import {
  DEFAULT_AI_SETTINGS,
  MODELS,
  PROVIDERS,
  TASKS,
  type AISettings,
  type AIProvider,
  type AITask,
} from "@/core/modbus-ai/model";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type SettingsResponse = {
  settings: AISettings;
  available: Record<AIProvider, boolean>;
};
const labels = {
  extraction: "PDF extraction",
  diagnosis: "Live diagnosis",
  review: "Review with AI",
};
const providerLabels: Record<AIProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic (Claude)",
  kimi: "Moonshot (Kimi)",
};

export function SettingsScreen() {
  const [settings, setSettings] = React.useState(DEFAULT_AI_SETTINGS);
  const [available, setAvailable] = React.useState<Record<AIProvider, boolean>>(
    { openai: false, anthropic: false, kimi: false },
  );
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    let disposed = false;
    void request<SettingsResponse>("/api/modbus-ai/settings")
      .then((next) => {
        if (!disposed) {
          setSettings(next.settings);
          setAvailable(next.available);
        }
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  function change(task: AITask, patch: Partial<AISettings[AITask]>) {
    setSettings((old) => ({ ...old, [task]: { ...old[task], ...patch } }));
    setDirty(true);
    setSaved(false);
  }
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const next = await request<SettingsResponse>("/api/modbus-ai/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      setSettings(next.settings);
      setAvailable(next.available);
      setDirty(false);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save settings");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-2xl text-hms-blue">Settings</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Options for this MAPS workspace, shared by all projects.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading settings…</p>
      ) : (
        <section className="space-y-5 rounded border border-border bg-white p-5">
          <div>
            <h2 className="font-medium">AI providers and models</h2>
            <p className="mt-1 text-sm text-fg-muted">
              Keys are configured on the server in .env.local. This screen only
              shows their availability.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {PROVIDERS.map((provider) => (
              <div
                key={provider}
                className="space-y-2 rounded border border-border p-3"
              >
                <p className="text-sm font-semibold text-hms-blue">
                  {providerLabels[provider]}
                </p>
                <span
                  className={cn(
                    "inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold",
                    available[provider]
                      ? "border-success-border bg-success-bg text-success"
                      : "border-warning-border bg-warning-bg text-warning-text",
                  )}
                >
                  {available[provider] ? "Key configured" : "Key needed"}
                </span>
              </div>
            ))}
          </div>
          {TASKS.map((task) => (
            <fieldset
              key={task}
              className="space-y-3 border-t border-border pt-4"
              disabled={busy}
            >
              <legend className="px-1 text-sm font-medium">
                {labels[task]}
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span>Provider</span>
                  <Select
                    aria-label={`${labels[task]} provider`}
                    value={settings[task].provider}
                    options={PROVIDERS.map((provider) => ({
                      value: provider,
                      label: providerLabels[provider],
                    }))}
                    onValueChange={(value) => {
                      const provider = value as AIProvider;
                      const model =
                        provider === "openai"
                          ? DEFAULT_AI_SETTINGS[task].model
                          : MODELS[provider][0];
                      change(task, {
                        provider,
                        model,
                        effort:
                          provider === "openai"
                            ? DEFAULT_AI_SETTINGS[task].effort
                            : "low",
                      });
                    }}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span>Model</span>
                  <Select
                    aria-label={`${labels[task]} model`}
                    value={settings[task].model}
                    options={MODELS[settings[task].provider].map((model) => ({
                      value: model,
                      label: model,
                    }))}
                    onValueChange={(model) =>
                      change(task, {
                        model,
                        effort: model === "gpt-6-luna" ? "none" : "low",
                      })
                    }
                  />
                </label>
              </div>
              <details>
                <summary className="cursor-pointer text-sm text-fg-muted">
                  Advanced
                </summary>
                <div className="mt-2 max-w-xs">
                  <Select
                    aria-label={`${labels[task]} reasoning`}
                    value={settings[task].effort}
                    onValueChange={(effort) =>
                      change(task, {
                        effort: effort as AISettings[AITask]["effort"],
                      })
                    }
                    options={(settings[task].model === "kimi-k3"
                      ? ["low", "high", "max"]
                      : settings[task].model === "gpt-6-luna"
                        ? ["none", "low", "medium", "high", "max"]
                        : ["low", "medium", "high", "max"]
                    ).map((value) => ({ value, label: value }))}
                  />
                </div>
              </details>
            </fieldset>
          ))}
          <div className="flex items-center gap-3">
            <Button disabled={!dirty || busy} onClick={() => void save()}>
              Save settings
            </Button>
            {saved && (
              <p role="status" className="text-sm">
                Settings saved.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
