import { getAttr, XmlDocument, type XmlElement } from "@/core/project-format";
import {
  refsFromSelection,
  type ConversionRwMode,
  type ConversionSelection,
  type SignalConversionRefs,
} from "@/core/signals/conversion-refs";

/**
 * The family-independent half of assigning conversions to a signal: every
 * position must exist in the project's filters / operations lists (the XBL
 * generator reads `filters[index]` for each ref, `CreateConversionList`).
 * Each family finds the signal, refuses the rows MAPS locks (virtual ones)
 * and passes the conversion direction of its internal object.
 */

export interface LibrarySizes {
  filterCount: number;
  operationCount: number;
}

/** Sizes of the two lists signal refs point into (`IntesisConversion.cs:233-247`). */
export function librarySizes(doc: XmlDocument): LibrarySizes {
  const types = (doc.find(["IBOX", "Conversions"])?.children ?? [])
    .filter((c): c is XmlElement => c.kind === "element" && c.tag === "Conversion")
    .map((el) => getAttr(el, "Type"));
  const filterCount = types.filter((type) => type === "0").length;
  return { filterCount, operationCount: types.length - filterCount };
}

/** Both halves' refs for a selection on signal `id`, as `frmSelectConversion` would save them. */
export function checkedSelectionRefs(
  id: number,
  selection: ConversionSelection,
  rwMode: ConversionRwMode,
  sizes: LibrarySizes,
): { refs: SignalConversionRefs } | { error: string } {
  const filters = [selection.internalFilter, selection.externalFilter].filter((f): f is number => f !== null);
  if (filters.some((index) => index >= sizes.filterCount) || selection.operations.some((index) => index >= sizes.operationCount)) {
    return { error: `Signal ${id + 1} uses a conversion that is not in the project.` };
  }
  return { refs: refsFromSelection(selection, rwMode) };
}

/**
 * Refs of both halves exactly as given, for undoing an assignment: the
 * previous refs may be ones `frmSelectConversion` would not write (imported
 * files), so they cannot go through a selection. Same range check.
 */
export function checkedRestoredRefs(
  id: number,
  refs: SignalConversionRefs,
  sizes: LibrarySizes,
): { refs: SignalConversionRefs } | { error: string } {
  const halves = [refs.internal, refs.external];
  if (
    halves.some(
      (half) =>
        half.filters.some((ref) => ref.index >= sizes.filterCount) ||
        half.operations.some((ref) => ref.index >= sizes.operationCount),
    )
  ) {
    return { error: `Signal ${id + 1} uses a conversion that is not in the project.` };
  }
  return { refs };
}
