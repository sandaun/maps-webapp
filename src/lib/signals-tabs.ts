"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

export type SignalsTabId = "map" | "validation" | "import";

export function parseSignalsTab(raw: string | null | undefined): SignalsTabId {
  if (raw === "validation" || raw === "import") return raw;
  return "map";
}

/** A library entry the signal map is filtered by: its list and position ("f0", "o2"). */
export interface ConversionFilterRef {
  list: "filters" | "operations";
  index: number;
}

export function parseConversionFilter(raw: string | null | undefined): ConversionFilterRef | undefined {
  const match = raw?.match(/^([fo])(\d+)$/);
  return match ? { list: match[1] === "f" ? "filters" : "operations", index: Number(match[2]) } : undefined;
}

export function signalsHref(
  tab: SignalsTabId,
  signal?: number,
  extra?: {
    /** Only the signals that use this library entry. */
    conversion?: ConversionFilterRef;
    /** Open the conversions editor of `signal`. */
    editConversions?: boolean;
  },
): string {
  const params = new URLSearchParams();
  if (tab !== "map") params.set("tab", tab);
  if (signal !== undefined && Number.isInteger(signal)) params.set("signal", String(signal));
  if (extra?.conversion) params.set("conversion", `${extra.conversion.list === "filters" ? "f" : "o"}${extra.conversion.index}`);
  if (extra?.editConversions && signal !== undefined) params.set("edit", "conversions");
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
    (next: SignalsTabId, opts?: { signal?: number; editConversions?: boolean }) => {
      setTabState(next);
      setSignalId(opts?.signal);
      router.push(signalsHref(next, opts?.signal, { editConversions: opts?.editConversions }), { scroll: false });
    },
    [router],
  );
  const editConversions = searchParams.get("edit") === "conversions" && urlSignalId !== undefined;

  return { tab, signalId, setTab, editConversions };
}
