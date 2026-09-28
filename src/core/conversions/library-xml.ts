import {
  element,
  getAttr,
  getText,
  setAttr,
  setText,
  text,
  XmlDocument,
  type XmlElement,
} from "@/core/project-format";
import { formatConversionIds } from "@/core/signals/conversion-refs";
import { parseConversionIds } from "@/core/xbl/conversions";
import {
  CONVERSION_TYPE,
  conversionErrors,
  conversionListOf,
  defaultConversion,
  formatConversionNumber,
  isEditableConversionType,
  type ConversionField,
  type ConversionList,
} from "./rules";

/**
 * The conversion library of a project (`<IBOX><Conversions>`), edited as the
 * MAPS Conversions Manager does. It is shared by every family: the library
 * lives in the IBOX, and signals point at it by position in the filters or
 * operations list. What stays with each family is which rows hold refs
 * (`removeConversion`'s `signals`) and how a selection becomes refs (the
 * conversion direction, virtual rows): see `./selection.ts`.
 * Moved from `src/gateway-families/knx-mbm/xml-ops.ts`.
 */

const INDENT_UNIT = "  ";

/** A library entry as the project XML holds it (params as written). */
export interface LibraryConversion {
  id: number;
  description: string;
  /** 0 FILTER, 1 SCALE, 2 ARITH, 3 LOGICAL, 4 LUT_REMAP. */
  type: number;
  params: [string, string, string, string];
}

/**
 * Replace the project's conversion list like `IntesisXML.GetConversionsNode`:
 * all filters, then all operations, each as `<Conversion Id Description Type
 * Param1..4 />` (`CreateConversionXMLNode`, IntesisXML.cs:496-507).
 */
export function setConversions(doc: XmlDocument, conversions: LibraryConversion[]): void {
  const ibox = mustFind(doc, ["IBOX"]);
  let container = doc.find(["IBOX", "Conversions"]);
  if (!container) {
    container = element("Conversions");
    appendChildIndented(ibox, container, 2);
  }
  container.children = [];
  container.emptyForm = "self";
  const ordered = [
    ...conversions.filter((conv) => conv.type === 0),
    ...conversions.filter((conv) => conv.type !== 0),
  ];
  for (const conv of ordered) appendChildIndented(container, conversionElement(conv), 3);
}

/** A conversion of the library, addressed as signal refs address it: list + position. */
export interface ConversionLocator {
  list: ConversionList;
  index: number;
}

/** Editable fields of a library entry; params are written as invariant-culture numbers. */
export interface ConversionPatch {
  description?: string;
  /** Operations only: switch between scale and arithmetic (`rb_scale` / `rb_arithmetic`). */
  type?: typeof CONVERSION_TYPE.SCALE | typeof CONVERSION_TYPE.ARITH;
  param1?: number;
  param2?: number;
  param3?: number;
  param4?: number;
}

export class ConversionEditError extends Error {
  constructor(
    readonly status: 409 | 422,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Append a filter, scale or arithmetic operation like the Conversions
 * Manager's add buttons: at the end of its list, numbered with the size of the
 * list the manager shows (`b_addFilter_Click` / `b_addConversion_Click`,
 * frmConversions.cs:531-625). `values` fills it (a duplicate); otherwise it
 * gets the MAPS defaults. Filters stay before the operations, as MAPS writes
 * them (`GetConversionsNode`, IntesisXML.cs:423-437). Returns the position.
 */
export function addConversion(
  doc: XmlDocument,
  type: typeof CONVERSION_TYPE.FILTER | typeof CONVERSION_TYPE.SCALE | typeof CONVERSION_TYPE.ARITH,
  values?: { description: string; params: [number, number, number, number] },
): number {
  const container = conversionsContainer(doc);
  const entries = conversionElements(container);
  const list = conversionListOf(type);
  const listed = entries.filter((el) => conversionListOf(conversionType(el)) === list);
  // The manager lists operations without the LUT remaps and logical ones (frmGateway.cs:579).
  const shown = listed.filter((el) => isEditableConversionType(conversionType(el))).length;
  const base = defaultConversion(type, shown);
  const conversion = values
    ? { ...base, description: values.description, params: values.params.map(formatConversionNumber) as LibraryConversion["params"] }
    : base;
  if (values) {
    const errors = conversionErrors(conversion);
    const message = Object.values(errors)[0];
    if (message) throw new ConversionEditError(422, message);
  }
  const el = conversionElement(conversion);
  const lastFilter = entries.filter((entry) => conversionType(entry) === CONVERSION_TYPE.FILTER).at(-1);
  if (list === "filters" && entries.length > (lastFilter ? entries.indexOf(lastFilter) + 1 : 0)) {
    insertBeforeIndented(container, el, entries[lastFilter ? entries.indexOf(lastFilter) + 1 : 0]);
  } else {
    appendChildIndented(container, el, 3);
  }
  return listed.length;
}

/**
 * Edit a filter, scale or arithmetic operation like `SaveCurrentFilterSelection`
 * / `SaveCurrentOperationSelection` (frmConversions.cs:582-705): an arithmetic
 * operation always stores Param4 = 0. The edited fields must pass the
 * manager's rules (`conversionErrors`); LUT remaps and logical operations are
 * read-only.
 */
export function updateConversion(doc: XmlDocument, locator: ConversionLocator, patch: ConversionPatch): void {
  const el = conversionAt(doc, locator);
  const type = conversionType(el);
  if (!isEditableConversionType(type)) throw new ConversionEditError(409, SYSTEM_CONVERSION_MESSAGE);
  if (patch.type !== undefined && locator.list === "filters")
    throw new ConversionEditError(422, "A filter cannot become an operation.");

  const current = readConversionElement(el);
  const params = [...current.params] as LibraryConversion["params"];
  const touched = new Set<ConversionField>();
  (["param1", "param2", "param3", "param4"] as const).forEach((key, i) => {
    const value = patch[key];
    if (value !== undefined) {
      params[i] = formatConversionNumber(value);
      touched.add(key);
    }
  });
  if (patch.description !== undefined) touched.add("description");
  if (patch.type !== undefined) touched.add("type");
  const next = {
    type: patch.type ?? type,
    description: patch.description ?? current.description,
    params,
  };
  const message = Object.values(conversionErrors(next, touched))[0];
  if (message) throw new ConversionEditError(422, message);
  if (next.type === CONVERSION_TYPE.ARITH) next.params[3] = "0";

  setAttr(el, "Description", next.description);
  setAttr(el, "Type", String(next.type));
  next.params.forEach((param, i) => setAttr(el, `Param${i + 1}`, param));
}

/**
 * Remove a filter, scale or arithmetic operation and keep every signal on the
 * conversions it had. DEVIATION: MAPS only drops the refs that fall out of
 * range (`UpdateConversionIndexes`, ExternalMbm.cs:1544-1564), so the signals
 * of the later entries silently move to the next one. Here the refs to the
 * removed entry go away and the later ones shift down, on both halves of
 * every signal. `signals` are the rows of BOTH sides of the family — every
 * one, enabled or not — since each keeps its own `IdxFilters` /
 * `IdxOperations`. Returns the ids of the signals that used it.
 */
export function removeConversion(
  doc: XmlDocument,
  locator: ConversionLocator,
  signals: readonly XmlElement[],
): number[] {
  const el = conversionAt(doc, locator);
  if (!isEditableConversionType(conversionType(el))) throw new ConversionEditError(409, SYSTEM_CONVERSION_MESSAGE);
  const container = el.parent!;
  removeElement(el);
  // An empty list is written as `<Conversions />`, as `setConversions` does.
  if (!conversionElements(container).length) {
    container.children = [];
    container.emptyForm = "self";
  }
  const affected = new Set<number>();
  const tag = locator.list === "filters" ? "IdxFilters" : "IdxOperations";
  for (const signal of signals) {
    const refsEl = signal.children.find((c): c is XmlElement => c.kind === "element" && c.tag === tag);
    if (!refsEl) continue;
    const refs = parseConversionIds(getText(refsEl));
    if (!refs.some((ref) => ref.index >= locator.index)) continue;
    if (refs.some((ref) => ref.index === locator.index)) affected.add(Number(getAttr(signal, "ID")));
    const next = refs
      .filter((ref) => ref.index !== locator.index)
      .map((ref) => (ref.index > locator.index ? { ...ref, index: ref.index - 1 } : ref));
    setText(refsEl, formatConversionIds(next));
  }
  return [...affected].sort((a, b) => a - b);
}

const SYSTEM_CONVERSION_MESSAGE =
  "LUT remaps and logical operations are created by the template: they cannot be edited or removed.";

function conversionsContainer(doc: XmlDocument): XmlElement {
  const existing = doc.find(["IBOX", "Conversions"]);
  if (existing) return existing;
  const container = element("Conversions");
  container.emptyForm = "self";
  appendChildIndented(mustFind(doc, ["IBOX"]), container, 2);
  return container;
}

function conversionElements(container: XmlElement): XmlElement[] {
  return container.children.filter((c): c is XmlElement => c.kind === "element" && c.tag === "Conversion");
}

function conversionType(el: XmlElement): number {
  const type = Number(getAttr(el, "Type"));
  return Number.isFinite(type) ? type : CONVERSION_TYPE.FILTER;
}

function conversionAt(doc: XmlDocument, locator: ConversionLocator): XmlElement {
  const container = doc.find(["IBOX", "Conversions"]);
  const el = (container ? conversionElements(container) : []).filter(
    (entry) => conversionListOf(conversionType(entry)) === locator.list,
  )[locator.index];
  if (!el) throw new ConversionEditError(422, `There is no ${locator.list === "filters" ? "filter" : "operation"} ${locator.index}.`);
  return el;
}

function readConversionElement(el: XmlElement): { description: string; params: LibraryConversion["params"] } {
  return {
    description: getAttr(el, "Description") ?? "",
    params: [getAttr(el, "Param1") ?? "", getAttr(el, "Param2") ?? "", getAttr(el, "Param3") ?? "", getAttr(el, "Param4") ?? ""],
  };
}

/** `CreateConversionXMLNode` (IntesisXML.cs:494-505). */
function conversionElement(conv: LibraryConversion): XmlElement {
  return element("Conversion", [
    ["Id", String(conv.id)],
    ["Description", conv.description],
    ["Type", String(conv.type)],
    ["Param1", conv.params[0]],
    ["Param2", conv.params[1]],
    ["Param3", conv.params[2]],
    ["Param4", conv.params[3]],
  ]);
}

// --- helpers ---------------------------------------------------------------

function mustFind(doc: XmlDocument, path: Parameters<XmlDocument["find"]>[0]): XmlElement {
  const el = doc.find(path);
  if (!el) throw new Error(`Expected XML element missing at ${JSON.stringify(path)}`);
  return el;
}

function removeElement(el: XmlElement): boolean {
  // Also drop the whitespace text node that precedes the element, so the
  // document stays cleanly indented.
  const parent = el.parent;
  if (!parent) return false;
  const index = parent.children.indexOf(el);
  if (index < 0) return false;
  const before = parent.children[index - 1];
  if (before && before.kind === "text" && /^\s*$/.test(before.text)) {
    parent.children.splice(index - 1, 2);
  } else {
    parent.children.splice(index, 1);
  }
  el.parent = undefined;
  return true;
}

/** Insert `child` right before its sibling `ref`, with the same indentation as `ref`. */
function insertBeforeIndented(parent: XmlElement, child: XmlElement, ref: XmlElement): void {
  const index = parent.children.indexOf(ref);
  const before = parent.children[index - 1];
  const indent = before && before.kind === "text" && /^\s*$/.test(before.text) ? before.text : "";
  child.parent = parent;
  parent.children.splice(index, 0, child, text(indent));
}

/**
 * Append a child matching the surrounding indentation: inserts before the
 * closing-tag whitespace with one extra indent level.
 */
function appendChildIndented(parent: XmlElement, child: XmlElement, childLevel: number): void {
  // .ibmaps is always written with CRLF line endings.
  const lineEnding = "\r\n";
  const last = parent.children[parent.children.length - 1];
  child.parent = parent;
  if (last && last.kind === "text" && /^\s*$/.test(last.text)) {
    const indent = `${lineEnding}${INDENT_UNIT.repeat(childLevel)}`;
    parent.children.splice(parent.children.length - 1, 0, text(indent), child);
  } else if (parent.children.length === 0) {
    const base = `${lineEnding}${INDENT_UNIT.repeat(Math.max(0, childLevel - 1))}`;
    parent.children = [text(`${base}${INDENT_UNIT}`), child, text(base)];
    parent.emptyForm = undefined;
  } else {
    // Compact XML (no whitespace between tags): append without indentation,
    // keeping every existing child.
    parent.children.push(child);
  }
}
