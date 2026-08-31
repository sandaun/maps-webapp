"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

export type SignalsTabId = "map" | "validation" | "import";

export function parseSignalsTab(raw: string | null | undefined): SignalsTabId {
  if (raw === "validation" || raw === "import") return raw;
  return "map";
}

export function signalsHref(tab: SignalsTabId, signal?: number): string {
  const params = new URLSearchParams();
  if (tab !== "map") params.set("tab", tab);
  if (signal !== undefined && Number.isInteger(signal)) params.set("signal", String(signal));
  const query = params.toString();
  return query ? `/signals?${query}` : "/signals";
}

export function useSignalsTab() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlTab = parseSignalsTab(searchParams.get("tab"));
  const urlSignal = searchParams.get("signal");
  const urlSignalId = urlSignal !== null && /^\d+$/.test(urlSignal) ? Number(urlSignal) : undefined;
  const [tab, setTabState] = React.useState<SignalsTabId>(urlTab);
  const [signalId, setSignalId] = React.useState<number | undefined>(urlSignalId);

  // Re-sync with the URL whenever the query string changes (back/forward, an
  // incoming link, or the router catching up with a setTab call). This is
  // React's documented "adjusting state during render" pattern rather than an
  // effect: it re-renders immediately, so the optimistic update done by setTab
  // survives and there is no intermediate frame showing the stale tab.
  // https://react.dev/learn/you-might-not-need-an-effect
  const [syncedFrom, setSyncedFrom] = React.useState({ tab: urlTab, signalId: urlSignalId });
  if (syncedFrom.tab !== urlTab || syncedFrom.signalId !== urlSignalId) {
    setSyncedFrom({ tab: urlTab, signalId: urlSignalId });
    setTabState(urlTab);
    setSignalId(urlSignalId);
  }

  const setTab = React.useCallback(
    (next: SignalsTabId, opts?: { signal?: number }) => {
      setTabState(next);
      setSignalId(opts?.signal);
      router.push(signalsHref(next, opts?.signal), { scroll: false });
    },
    [router],
  );

  return { tab, signalId, setTab };
}
