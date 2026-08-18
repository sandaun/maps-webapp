import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiagnosticsScreen } from "./diagnostics-screen";

afterEach(() => vi.unstubAllGlobals());

describe("DiagnosticsScreen", () => {
  it("shows the honest empty state when there is no gateway session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ sessions: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    render(<DiagnosticsScreen />);

    await screen.findByText(/No gateway session is open/);
    expect(screen.getByRole("link", { name: "Connection" })).toHaveAttribute(
      "href",
      "/connection",
    );
    expect(screen.getByText(/demo project/)).toBeInTheDocument();
  });
});
