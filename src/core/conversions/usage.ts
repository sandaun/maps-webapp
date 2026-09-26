import type { SignalConversionRefs } from "@/core/signals/conversion-refs";
import type { ConversionList } from "./rules";

/** Signals whose refs (either half) point at this position of the filters / operations list. */
export function signalsUsingConversion<T extends { conversions: SignalConversionRefs }>(
  signals: readonly T[],
  list: ConversionList,
  index: number,
): T[] {
  const key = list === "filters" ? "filters" : "operations";
  return signals.filter(({ conversions }) =>
    [conversions.internal, conversions.external].some((half) => half[key].some((ref) => ref.index === index)),
  );
}
