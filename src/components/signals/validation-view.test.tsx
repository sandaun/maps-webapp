import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ValidationIssue } from "@/core/validation/issue";
import { ValidationView } from "./validation-view";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const issues: ValidationIssue[] = [
  {
    code: "CONV-REF-MISSING",
    severity: "error",
    message: "Signal 2 uses filter 3, which is not in the conversion library.",
    ref: { screen: "signals", entity: "signal", id: 1, field: "conversions" },
  },
  {
    code: "CONV-RANGE",
    severity: "warning",
    message: "Filter “Valid” has Low (150) greater than High (-50).",
    ref: { screen: "configuration", entity: "project", id: "f0", field: "conversion" },
  },
  {
    code: "CONV-VIRTUAL",
    severity: "info",
    message: "Virtual signal 5 has conversions.",
    ref: { screen: "signals", entity: "signal", id: 4 },
  },
];

beforeEach(() => push.mockReset());

describe("ValidationView · conversion issues", () => {
  it("opens the signal's conversions editor and the library entry", () => {
    const onOpenConversions = vi.fn();
    const onGoToSignal = vi.fn();
    render(
      <ValidationView issues={issues} family="knx-mbm" onGoToSignal={onGoToSignal} onOpenConversions={onOpenConversions} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open conversions" }));
    expect(onOpenConversions).toHaveBeenCalledWith(1);
    expect(onGoToSignal).not.toHaveBeenCalled();
    expect(screen.getByText("Filter 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open conversion" }));
    expect(push).toHaveBeenCalledWith("/configuration?conversion=f0");
  });

  it("sends the virtual-signal note to the signal row: its editor cannot open", () => {
    const onOpenConversions = vi.fn();
    const onGoToSignal = vi.fn();
    render(
      <ValidationView
        issues={[issues[2]]}
        family="knx-mbm"
        onGoToSignal={onGoToSignal}
        onOpenConversions={onOpenConversions}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Go to signal" }));
    expect(onGoToSignal).toHaveBeenCalledWith(4);
    expect(onOpenConversions).not.toHaveBeenCalled();
  });
});
