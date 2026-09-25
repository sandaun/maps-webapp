import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input, type InputProps } from "./input";

function Numeric({ initial = "180", ...props }: InputProps & { initial?: string }) {
  const [value, setValue] = React.useState(initial);
  return <Input aria-label="Timeout" type="number" value={value} onChange={(e) => setValue(e.target.value)} {...props} />;
}

const field = () => screen.getByRole("textbox", { name: "Timeout" });

describe("Input", () => {
  it("renders numbers as text without native arrows and steps with ↑ ↓, Shift ×10", () => {
    render(<Numeric />);
    expect(field()).toHaveAttribute("type", "text");
    expect(field()).toHaveAttribute("inputmode", "decimal");
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    expect(field()).toHaveValue("181");
    fireEvent.keyDown(field(), { key: "ArrowDown", shiftKey: true });
    expect(field()).toHaveValue("171");
  });

  it("steps in the last decimal place and stops at min and max", () => {
    const { unmount } = render(<Numeric initial="0.5" />);
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    expect(field()).toHaveValue("0.6");
    unmount();
    render(<Numeric initial="250" min={1} max={255} />);
    fireEvent.keyDown(field(), { key: "ArrowUp", shiftKey: true });
    expect(field()).toHaveValue("255");
    fireEvent.change(field(), { target: { value: "1" } });
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(field()).toHaveValue("1");
  });

  it("ignores characters that cannot form a number and never steps on the wheel", () => {
    render(<Numeric />);
    fireEvent.change(field(), { target: { value: "18a" } });
    expect(field()).toHaveValue("180");
    fireEvent.change(field(), { target: { value: "-1.5" } });
    expect(field()).toHaveValue("-1.5");
    field().focus();
    fireEvent.wheel(field(), { deltaY: -100 });
    expect(field()).toHaveValue("-1.5");
  });

  it("shows the unit inside the field and marks errors with a red border", () => {
    render(<Numeric unit="s" aria-invalid />);
    expect(screen.getByText("s")).toBeInTheDocument();
    expect(field()).toHaveClass("border-error");
    expect(field()).not.toHaveClass("focus:border-hms-accent");
  });

  it("lets a password be shown and hidden again", () => {
    render(<Input aria-label="Password" type="password" defaultValue="secret" />);
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password).toHaveAttribute("type", "password");
  });
});
