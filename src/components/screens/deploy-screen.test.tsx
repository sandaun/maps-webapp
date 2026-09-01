import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { projectFromXml as knxProjectFromXml } from "@/gateway-families/knx-mbm";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { projectFromXml as meProjectFromXml } from "@/gateway-families/me-mbs";
import { SYNTHETIC_ME_MBS_XML } from "@/gateway-families/me-mbs/fixtures/synthetic-project";
import type { ProjectView } from "@/lib/project-types";
import { DeployScreen } from "./deploy-screen";

/**
 * Deploy screen states (Pas 2.6 / 3.4): both families share the same gated
 * card — the deploy action is enabled only when the server-reported gates all
 * pass, behind an explicit confirmation step; a missing capability keeps the
 * honest disabled explanation. Network access is mocked (`fetch`).
 */

const knxView: ProjectView = {
  meta: {
    id: "demo",
    name: "Demo project (synthetic)",
    description: "",
    source: "demo",
    family: "knx-mbm",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  family: "knx-mbm",
  project: knxProjectFromXml(XmlDocument.parse(SYNTHETIC_KNX_MBM_XML)),
  issues: [],
  hasCompleteBlob: false,
};

const meMbsView: ProjectView = {
  meta: {
    id: "p1",
    name: "ME project",
    description: "",
    source: "gateway",
    family: "me-mbs",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  family: "me-mbs",
  project: meProjectFromXml(XmlDocument.parse(SYNTHETIC_ME_MBS_XML)),
  issues: [],
  hasCompleteBlob: true,
};

let currentView: ProjectView = knxView;

vi.mock("@/lib/current-project", () => ({
  useCurrentProject: () => ({
    projectId: currentView.meta.id,
    loading: false,
    view: currentView,
    error: null,
    setProjectId: vi.fn(),
    refresh: vi.fn(),
    applyPatches: vi.fn(),
  }),
  usePatch: () => vi.fn(),
}));

const SESSION = {
  id: "sess-1",
  host: "192.168.2.130",
  port: 23,
  connected: true,
  encrypted: true,
  busy: false,
  connectedAt: "2026-08-19T10:00:00.000Z",
  gateway: { appId: 64, bootloader: false, noApp: false },
};

const KNX_SESSION = { ...SESSION, gateway: { appId: 4, bootloader: false, noApp: false } };

type GateId = "family" | "capability" | "session-appid";

function gatesStatus(
  family: "knx-mbm" | "me-mbs" = "me-mbs",
  overrides: Partial<Record<GateId, boolean>> = {},
) {
  const ok = (id: GateId) => overrides[id] ?? true;
  const capabilityKey = family === "knx-mbm" ? "knxMbmXblVerified" : "meMbsXblVerified";
  return {
    deployable: (["family", "capability", "session-appid"] as GateId[]).every((id) => ok(id)),
    checks: [
      {
        id: "family",
        ok: ok("family"),
        detail:
          family === "knx-mbm"
            ? "KNX ↔ Modbus Master project"
            : "Mitsubishi Electric AC ↔ Modbus Slave project",
      },
      {
        id: "capability",
        ok: ok("capability"),
        detail: ok("capability")
          ? `XBL generator byte-exact verified (${capabilityKey})`
          : `Missing verified XBL capability (${capabilityKey})`,
      },
      {
        id: "session-appid",
        ok: ok("session-appid"),
        detail:
          family === "knx-mbm"
            ? "Gateway reports AppId 4 (KNX–MBM unit)"
            : "Gateway reports AppId 64 (ME unit)",
      },
    ],
  };
}

/** Mock fetch for the session list + deploy status (+ optional deploy POST). */
function stubFetch(opts: {
  sessions?: unknown[];
  status?: unknown;
  deployResult?: unknown;
}): Record<string, unknown>[] {
  const posts: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/gateway/sessions") {
      return jsonResponse({ sessions: opts.sessions ?? [] });
    }
    if (url.includes("/deploy?projectId=")) {
      return jsonResponse({ status: opts.status ?? gatesStatus("me-mbs") });
    }
    if (url.endsWith("/deploy") && init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return jsonResponse({
        result: opts.deployResult ?? {
          projectId: "p1",
          sessionId: "sess-1",
          bytes: 9000,
          xblBytes: 8205,
          zipBytes: 795,
          appId: 64,
          swVersion: "1.2.31.0",
        },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  return posts;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  currentView = knxView;
  vi.unstubAllGlobals();
});

describe("DeployScreen (knx-mbm)", () => {
  it("enables deploy when all gates pass and asks for explicit confirmation", async () => {
    stubFetch({ sessions: [KNX_SESSION], status: gatesStatus("knx-mbm") });
    render(<DeployScreen />);

    const button = await screen.findByRole("button", { name: "Deploy to gateway" });
    await screen.findByText("All gates pass");
    expect(button).toBeEnabled();
    expect(screen.getByText(/byte-exact verified \(knxMbmXblVerified\)/)).toBeInTheDocument();

    fireEvent.click(button);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("writes configuration to the gateway at 192.168.2.130");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps deploy disabled when the capability gate fails, with the honest explanation", async () => {
    stubFetch({
      sessions: [KNX_SESSION],
      status: gatesStatus("knx-mbm", { capability: false }),
    });
    render(<DeployScreen />);

    const button = await screen.findByRole("button", { name: "Deploy to gateway" });
    await screen.findByText("Blocked by a gate");
    expect(button).toBeDisabled();
    expect(screen.getByText(/Missing verified XBL capability \(knxMbmXblVerified\)/)).toBeInTheDocument();
  });

  it("keeps deploy disabled without a gateway session", async () => {
    stubFetch({ sessions: [] });
    render(<DeployScreen />);

    expect(await screen.findByText(/No gateway session is open/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deploy to gateway" })).toBeDisabled();
  });

  it("deploys on confirm and shows the result summary with the verify hint", async () => {
    const posts = stubFetch({
      sessions: [KNX_SESSION],
      status: gatesStatus("knx-mbm"),
      deployResult: {
        projectId: "demo",
        sessionId: "sess-1",
        bytes: 5000,
        xblBytes: 3976,
        zipBytes: 1024,
        appId: 4,
        swVersion: "1.2.33.0",
      },
    });
    render(<DeployScreen />);

    fireEvent.click(await screen.findByRole("button", { name: "Deploy to gateway" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm deploy" }));

    expect(await screen.findByText(/the gateway accepted the upload/)).toBeInTheDocument();
    expect(screen.getByText(/Receive from gateway/)).toBeInTheDocument();
    expect(posts).toEqual([{ projectId: "demo" }]);
  });

  it("offers the export download and explains the missing gateway blob", async () => {
    stubFetch({ sessions: [] });
    render(<DeployScreen />);

    expect(screen.getByRole("link", { name: /Export .ibmaps/ })).toHaveAttribute(
      "href",
      "/api/projects/demo/export",
    );
    expect(screen.getByText("No gateway blob")).toBeInTheDocument();
  });
});

describe("DeployScreen (me-mbs)", () => {
  beforeEach(() => {
    currentView = meMbsView;
  });

  it("keeps deploy disabled without a gateway session", async () => {
    stubFetch({ sessions: [] });
    render(<DeployScreen />);

    expect(await screen.findByText(/No gateway session is open/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deploy to gateway" })).toBeDisabled();
  });

  it("enables deploy when all gates pass and asks for explicit confirmation", async () => {
    stubFetch({ sessions: [SESSION] });
    render(<DeployScreen />);

    const button = await screen.findByRole("button", { name: "Deploy to gateway" });
    await screen.findByText("All gates pass");
    expect(button).toBeEnabled();
    expect(screen.getByText(/byte-exact verified \(meMbsXblVerified\)/)).toBeInTheDocument();

    fireEvent.click(button);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("writes configuration to the gateway at 192.168.2.130");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps deploy disabled when a gate fails and shows which one", async () => {
    stubFetch({ sessions: [SESSION], status: gatesStatus("me-mbs", { capability: false }) });
    render(<DeployScreen />);

    const button = await screen.findByRole("button", { name: "Deploy to gateway" });
    await screen.findByText("Blocked by a gate");
    expect(button).toBeDisabled();
    expect(screen.getByText(/Missing verified XBL capability/)).toBeInTheDocument();
  });

  it("deploys on confirm and shows the result summary with the verify hint", async () => {
    const posts = stubFetch({ sessions: [SESSION] });
    render(<DeployScreen />);

    fireEvent.click(await screen.findByRole("button", { name: "Deploy to gateway" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm deploy" }));

    expect(await screen.findByText(/the gateway accepted the upload/)).toBeInTheDocument();
    expect(screen.getByText(/Receive from gateway/)).toBeInTheDocument();
    expect(posts).toEqual([{ projectId: "p1" }]);
  });
});
