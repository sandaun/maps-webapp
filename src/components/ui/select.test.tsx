import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Select, type SelectOption } from "./select";

const MODES: SelectOption[] = [
  { value: "full", label: "Full scan" },
  { value: "addr", label: "Addresses only" },
  { value: "none", label: "Disabled" },
];
const DPTS: SelectOption[] = Array.from({ length: 12 }, (_, i) => ({ value: String(i), label: `dpt ${i}` }));

function Harness({ options = MODES, initial = "full", ...props }: Partial<React.ComponentProps<typeof Select>> & { initial?: string }) {
  const [value, setValue] = React.useState(initial);
  return <Select aria-label="Mode" value={value} options={options} onValueChange={setValue} {...props} />;
}

const trigger = () => screen.getByRole("combobox", { name: "Mode" });
const options = () => within(screen.getByRole("listbox")).getAllByRole("option");

describe("Select", () => {
  it("shows the selected label, or the placeholder when nothing matches", () => {
    const { unmount } = render(<Harness />);
    expect(trigger()).toHaveTextContent("Full scan");
    unmount();
    render(<Harness initial="missing" placeholder="Choose a mode…" />);
    expect(trigger()).toHaveTextContent("Choose a mode…");
  });

  it("opens on click with the selected option marked and picks another", () => {
    render(<Harness />);
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.click(options()[1]);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger()).toHaveTextContent("Addresses only");
    expect(trigger()).toHaveFocus();
  });

  it("moves with the arrows, wraps around, and Home/End/Enter pick", () => {
    render(<Harness />);
    trigger().focus();
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    expect(trigger()).toHaveAttribute("aria-activedescendant", options()[0].id);
    fireEvent.keyDown(trigger(), { key: "ArrowUp" });
    expect(trigger()).toHaveAttribute("aria-activedescendant", options()[2].id);
    fireEvent.keyDown(trigger(), { key: "Home" });
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    fireEvent.keyDown(trigger(), { key: "Enter" });
    expect(trigger()).toHaveTextContent("Addresses only");
    fireEvent.keyDown(trigger(), { key: "Enter" });
    fireEvent.keyDown(trigger(), { key: "End" });
    fireEvent.keyDown(trigger(), { key: "Enter" });
    expect(trigger()).toHaveTextContent("Disabled");
  });

  it("closes on Escape without changing the value or reaching an enclosing handler", () => {
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <Harness />
      </div>,
    );
    fireEvent.click(trigger());
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    fireEvent.keyDown(trigger(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger()).toHaveTextContent("Full scan");
    expect(outer.mock.calls.map(([event]) => event.key)).not.toContain("Escape");
  });

  it("adds a search box above 8 options, filters by label and counts matches", () => {
    const { unmount } = render(<Harness />);
    fireEvent.click(trigger());
    expect(screen.queryByRole("textbox", { name: "Search options" })).toBeNull();
    unmount();

    render(<Harness options={DPTS} initial="3" />);
    fireEvent.click(trigger());
    const search = screen.getByRole("textbox", { name: "Search options" });
    expect(search).toHaveFocus();
    expect(screen.getByText("12")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "1" } });
    expect(options().map((o) => o.textContent)).toEqual(["dpt 1", "dpt 10", "dpt 11"]);
    expect(screen.getByText("3/12")).toBeInTheDocument();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(trigger()).toHaveTextContent("dpt 10");
    fireEvent.click(trigger());
    fireEvent.change(screen.getByRole("textbox", { name: "Search options" }), { target: { value: "zzz" } });
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("does not open while disabled", () => {
    render(<Harness disabled />);
    fireEvent.click(trigger());
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
