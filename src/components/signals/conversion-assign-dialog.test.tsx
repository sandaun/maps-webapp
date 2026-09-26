import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { projectFromXml, setConversions, updateSignal } from "@/gateway-families/knx-mbm";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import type { SignalConversionRefs } from "@/core/signals/conversion-refs";
import type { KnxFlags } from "@/protocols/knx";
import { ConversionAssignDialog } from "./conversion-assign-dialog";

const ref = (index: number, inverted = false) => ({ index, inverted });
const READ_WRITE: KnxFlags = { u: true, t: true, ri: false, w: true, r: true };
const EMPTY: SignalConversionRefs = { internal: { filters: [], operations: [] }, external: { filters: [], operations: [] } };

/** Filter "Valid" (No-limit, −50…150); operations "Fan %" (scale 0…1000 → 0…100), "Flat" (arith B = 0), a LUT. */
function project(signal1: { refs?: SignalConversionRefs; flags?: KnxFlags } = {}) {
  const doc = XmlDocument.parse(SYNTHETIC_KNX_MBM_XML);
  setConversions(doc, [
    { id: 0, description: "Valid", type: 0, params: ["1", "4", "-50", "150"] },
    { id: 0, description: "Fan %", type: 1, params: ["0", "1000", "0", "100"] },
    { id: 1, description: "Flat", type: 2, params: ["0", "0", "5", "0"] },
    { id: 0, description: "Mode table", type: 4, params: ["0", "0", "0", "0"] },
  ]);
  updateSignal(doc, 1, {
    ...(signal1.flags ? { knx: { flags: signal1.flags } } : {}),
    conversionRefs: signal1.refs ?? EMPTY,
  });
  return projectFromXml(doc);
}

const onApply = vi.fn();
const onClose = vi.fn();

function open(p = project()) {
  render(<ConversionAssignDialog signal={p.signals[1]} project={p} onClose={onClose} onApply={onApply} />);
  return p;
}
const slot = (lane: string, caption: RegExp) =>
  within(screen.getByRole("region", { name: lane })).getByRole("button", { name: caption });

beforeEach(() => {
  onApply.mockReset().mockResolvedValue(true);
  onClose.mockReset();
});

describe("ConversionAssignDialog", () => {
  it("shows one lane for a read-only signal and follows a Modbus value to KNX", () => {
    open(project({ refs: { internal: { filters: [], operations: [] }, external: { filters: [ref(0)], operations: [ref(0)] } } }));
    expect(screen.getByText("Read only")).toBeTruthy();
    expect(screen.getByText(/only send status to KNX/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Write · KNX → Modbus" })).toBeNull();
    // MAPS shows a single operation of the external half in the combo next to Modbus.
    expect(slot("Read · Modbus → KNX", /^Operation next to Modbus/).textContent).toContain("Fan %");
    fireEvent.change(screen.getByRole("textbox", { name: "Test Modbus value" }), { target: { value: "100" } });
    expect(screen.getByRole("status", { name: "Read · Modbus → KNX test result" }).textContent).toBe("KNX receives 10");
    fireEvent.change(screen.getByRole("textbox", { name: "Test Modbus value" }), { target: { value: "200" } });
    expect(screen.getByRole("status", { name: "Read · Modbus → KNX test result" }).textContent).toBe(
      "Discarded by “Valid”. Nothing is sent to KNX.",
    );
  });

  it("defines a read + write signal for one flow and shows the derived inverse", async () => {
    open(project({ flags: READ_WRITE }));
    expect(screen.getByRole("radio", { name: "Write (KNX → Modbus)" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(slot("Write · KNX → Modbus", /^Operation next to KNX/));
    fireEvent.click(screen.getByRole("option", { name: /Fan %/ }));
    expect(slot("Read · Modbus → KNX", /^Operation next to KNX/).textContent).toContain("0…100 → 0…1000");
    fireEvent.change(screen.getByRole("textbox", { name: "Test KNX value" }), { target: { value: "500" } });
    expect(screen.getByRole("status", { name: "Write · KNX → Modbus test result" }).textContent).toBe(
      "The Modbus register receives 50",
    );
    fireEvent.click(screen.getByRole("radio", { name: "Read (Modbus → KNX)" }));
    expect(slot("Write · KNX → Modbus", /^Operation next to KNX/).textContent).toContain("0…100 → 0…1000");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onApply).toHaveBeenCalledWith(
      [
        {
          type: "updateSignal",
          id: 1,
          patch: { conversions: { internalFilter: null, operations: [0], externalFilter: null, master: "external" } },
        },
      ],
      [{ type: "restoreSignalConversions", id: 1, refs: EMPTY }],
    );
  });

  it("blocks an operation without inverse on a read + write signal", () => {
    open(project({ flags: READ_WRITE }));
    fireEvent.click(slot("Write · KNX → Modbus", /^Operation next to KNX/));
    fireEvent.click(screen.getByRole("option", { name: /Flat/ }));
    expect(screen.getByRole("alert").textContent).toContain("“Flat” has no inverse (B · 10^A is 0)");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("lets LUT remaps run on read + write signals, as MAPS does", () => {
    open(project({ flags: READ_WRITE }));
    fireEvent.click(slot("Write · KNX → Modbus", /^Operation next to KNX/));
    fireEvent.click(screen.getByRole("option", { name: /Mode table/ }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
  });

  it("creates a new operation from the picker and adds it to the library on Apply", async () => {
    open(project({ refs: { internal: { filters: [], operations: [] }, external: { filters: [], operations: [ref(0)] } } }));
    fireEvent.click(slot("Read · Modbus → KNX", /^Operation next to KNX/));
    fireEvent.change(screen.getByRole("textbox", { name: "Search operations" }), { target: { value: "mode" } });
    expect(within(screen.getByRole("listbox", { name: "Operations" })).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Leave empty",
      "Mode table" + "Remap table 0",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "+ New operation…" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "Tenths" } });
    fireEvent.change(screen.getByRole("textbox", { name: "A · exponent" }), { target: { value: "-1" } });
    expect(screen.getByText("Calculates y = x · 0.1.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create and use" }));
    expect(screen.getByText("1 new entry joins the conversion library.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(onApply).toHaveBeenCalled());
    const [patches, inverses] = onApply.mock.calls[0];
    expect(patches).toEqual([
      { type: "addConversion", conversionType: 2, values: { description: "Tenths", params: [-1, 1, 0, 0] } },
      {
        type: "updateSignal",
        id: 1,
        patch: { conversions: { internalFilter: null, operations: [3, 0], externalFilter: null, master: "internal" } },
      },
    ]);
    expect(inverses.at(-1)).toEqual({ type: "removeConversion", list: "operations", index: 3 });
  });

  it("reports refs that point outside the library and blocks Apply until the slot changes", () => {
    open(project({ refs: { internal: { filters: [], operations: [] }, external: { filters: [ref(4)], operations: [] } } }));
    expect(screen.getByRole("alert").textContent).toContain("no longer in the project");
    fireEvent.click(slot("Read · Modbus → KNX", /^Modbus side · filter/));
    fireEvent.click(screen.getByRole("option", { name: "Leave empty" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
  });

  it("warns when the stored refs are not the MAPS layout, shows them and restores them on undo", async () => {
    // The fixture's read-only signal carries the operation on both halves.
    const p = projectFromXml(XmlDocument.parse(SYNTHETIC_KNX_MBM_XML));
    render(<ConversionAssignDialog signal={p.signals[1]} project={p} onClose={onClose} onApply={onApply} />);
    expect(screen.getByText(/not stored the way MAPS stores them/)).toBeTruthy();
    expect(screen.getByText("Read · Modbus → KNX: 0…1000 → 0…100")).toBeTruthy();
    fireEvent.click(slot("Read · Modbus → KNX", /^Operation next to KNX/));
    fireEvent.click(screen.getByRole("option", { name: "Leave empty" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(onApply).toHaveBeenCalled());
    expect(onApply.mock.calls[0][1]).toEqual([
      { type: "restoreSignalConversions", id: 1, refs: p.signals[1].conversions },
    ]);
  });

  it("never turns a new filter into an operation when the slot changes with the form open", () => {
    open(project({ flags: READ_WRITE }));
    fireEvent.click(slot("Write · KNX → Modbus", /^KNX side · filter/));
    fireEvent.click(screen.getByRole("button", { name: "+ New filter…" }));
    fireEvent.click(slot("Write · KNX → Modbus", /^Operation next to KNX/));
    // The operation slot gets its own picker: no filter form carried over.
    expect(screen.queryByText("NEW FILTER")).toBeNull();
    expect(screen.getByRole("button", { name: "+ New operation…" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "+ New operation…" }));
    fireEvent.click(screen.getByRole("button", { name: "Create and use" }));
    expect(slot("Write · KNX → Modbus", /^Operation next to KNX/).textContent).toContain("Operation_2");
    expect(slot("Write · KNX → Modbus", /^KNX side · filter/).textContent).toContain("+ Filter");
  });

  it("asks before losing a new entry that has been typed but not created", () => {
    open();
    fireEvent.click(slot("Read · Modbus → KNX", /^Operation next to KNX/));
    fireEvent.click(screen.getByRole("button", { name: "+ New operation…" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "Tenths" } });
    // Switching slot asks first.
    fireEvent.click(slot("Read · Modbus → KNX", /^Modbus side · filter/));
    expect(screen.getByText("Discard the new operation?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect((screen.getByRole("textbox", { name: "Description" }) as HTMLInputElement).value).toBe("Tenths");
    // Closing the dialog asks too (the footer Cancel, not the form's).
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" }).at(-1)!);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("blocks Apply while a typed new entry has not been created or cancelled", () => {
    open(project({ refs: { internal: { filters: [], operations: [] }, external: { filters: [ref(0)], operations: [] } } }));
    fireEvent.click(slot("Read · Modbus → KNX", /^Operation next to KNX/));
    fireEvent.click(screen.getByRole("option", { name: /Fan %/ }));
    fireEvent.click(slot("Read · Modbus → KNX", /^Operation next to Modbus/));
    fireEvent.click(screen.getByRole("button", { name: "+ New operation…" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "Tenths" } });
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(screen.getByText("Create or cancel the new operation first.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create and use" }));
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
  });

  it("asks before an existing choice or Leave empty discards a typed new entry", () => {
    open();
    fireEvent.click(slot("Read · Modbus → KNX", /^Operation next to KNX/));
    fireEvent.click(screen.getByRole("button", { name: "+ New operation…" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "Tenths" } });
    fireEvent.click(screen.getByRole("option", { name: /Fan %/ }));
    expect(screen.getByText("Discard the new operation?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect((screen.getByRole("textbox", { name: "Description" }) as HTMLInputElement).value).toBe("Tenths");
    expect(slot("Read · Modbus → KNX", /^Operation next to KNX/).textContent).toContain("+ Operation");
    fireEvent.click(screen.getByRole("option", { name: "Leave empty" }));
    expect(screen.getByText("Discard the new operation?")).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /Fan %/ }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(slot("Read · Modbus → KNX", /^Operation next to KNX/).textContent).toContain("Fan %");
    expect(screen.queryByRole("textbox", { name: "Description" })).toBeNull();
  });

  it("asks before discarding changes", () => {
    open();
    fireEvent.click(slot("Read · Modbus → KNX", /^Modbus side · filter/));
    fireEvent.click(screen.getByRole("option", { name: /Valid/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalled();
  });
});
