import { fireEvent, screen, within } from "@testing-library/react";

/** Opens a `Select` and picks the option with this label, as a user would. */
export function chooseOption(combobox: HTMLElement, label: string) {
  fireEvent.click(combobox);
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: label }));
}

/** Opens a `Select`, reads its options and closes it again. */
export function readOptions(combobox: HTMLElement): { value: string; label: string }[] {
  fireEvent.click(combobox);
  const options = within(screen.getByRole("listbox"))
    .getAllByRole("option")
    .map((option) => ({ value: option.dataset.value ?? "", label: option.textContent ?? "" }));
  fireEvent.keyDown(combobox, { key: "Escape" });
  return options;
}
