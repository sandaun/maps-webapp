import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { CurrentProjectProvider, useCurrentProject } from "@/lib/current-project";
import { PROJECT_PATCHED_EVENT, PROJECT_REPLACED_EVENT } from "@/lib/project-events";
import { PropertyDraftProvider } from "@/lib/property-drafts";
import type { FamilyId, ProjectPatchInput, ProjectView } from "@/lib/project-types";
import { familyById } from "@/server/projects/families";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { SYNTHETIC_ME_MBS_XML } from "@/gateway-families/me-mbs/fixtures/synthetic-project";
import { SYNTHETIC_MBS_KNX_XML } from "@/gateway-families/mbs-knx/fixtures/synthetic-project";
import { ConfigurationScreen } from "./configuration-screen";

const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), search: "section=security" }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()), getProjectView: mocks.get, patchProject: mocks.patch,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

function TestApp() {
  return <CurrentProjectProvider><PropertyDraftProvider><SwitchProject /><ConfigurationScreen /></PropertyDraftProvider></CurrentProjectProvider>;
}

let rerenderConfiguration: (() => void) | undefined;

function SwitchProject() {
  const { setProjectId } = useCurrentProject();
  return <button onClick={() => setProjectId("other")}>Switch project</button>;
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); mocks.search = "section=security"; });

async function setup(family: FamilyId, fixture: string) {
  const doc = XmlDocument.parse(fixture);
  doc.setAttr(["IBOX"], "Pwd", "old-test");
  let revision = 1;
  const view = (id: string) => ({
    family, meta: { id, family, name: "Test", description: "", source: "file", updatedAt: "", revision },
    project: familyById(family).fromXml(doc), issues: [], hasCompleteBlob: false, passwordValid: true,
  }) as ProjectView;
  mocks.get.mockImplementation(async (id: string) => view(id));
  mocks.patch.mockImplementation(async (id: string, patches: ProjectPatchInput[]) => {
    familyById(family).applyPatches(doc, patches);
    revision++;
    return view(id);
  });
  const mounted = render(<TestApp />);
  rerenderConfiguration = () => mounted.rerender(<TestApp />);
  await screen.findByLabelText("New password");
  return doc;
}

const fill = (password: string, confirmation = password) => {
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: confirmation } });
};

describe.each([
  ["knx-mbm", SYNTHETIC_KNX_MBM_XML], ["me-mbs", SYNTHETIC_ME_MBS_XML], ["mbs-knx", SYNTHETIC_MBS_KNX_XML],
] as const)("Configuration password (%s)", (family, fixture) => {
  it("opens from the deploy link, saves once with revision, and clears inputs without publishing or persisting secrets", async () => {
    const doc = await setup(family, fixture);
    const events: unknown[] = [];
    const listener = (event: Event) => events.push((event as CustomEvent).detail);
    window.addEventListener(PROJECT_PATCHED_EVENT, listener);
    try {
      expect(screen.getByLabelText("New password")).toHaveValue("");
      expect(screen.getByLabelText("Confirm password")).toHaveValue("");
      expect(screen.getByLabelText("New password")).toHaveAttribute("type", "password");
      expect(screen.getByLabelText("New password")).toHaveAttribute("maxlength", "8");
      expect(document.body).not.toHaveTextContent("old-test");
      fill(" New123 ");
      fireEvent.click(screen.getByRole("button", { name: "Save password" }));
      await screen.findByText("Password saved to the project.");
      expect(mocks.patch).toHaveBeenCalledExactlyOnceWith("demo", [{ type: "setProjectPassword", password: " New123 " }], 1);
      expect(doc.getAttr(["IBOX"], "Pwd")).toBe(" New123 ");
      expect(screen.getByLabelText("New password")).toHaveValue("");
      expect(screen.getByLabelText("Confirm password")).toHaveValue("");
      expect(JSON.stringify(events)).not.toContain("New123");
      expect(JSON.stringify(localStorage)).not.toContain("New123");
      expect(JSON.stringify(sessionStorage)).not.toContain("New123");
    } finally {
      window.removeEventListener(PROJECT_PATCHED_EVENT, listener);
    }
  });
});

it("requires matching printable ASCII input and keeps fields for a failed save", async () => {
  await setup("knx-mbm", SYNTHETIC_KNX_MBM_XML);
  const save = screen.getByRole("button", { name: "Save password" });
  expect(save).toBeDisabled();
  fill("test", "other");
  expect(save).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match");
  fill("café");
  expect(save).toBeDisabled();
  fill("test123");
  mocks.patch.mockRejectedValueOnce(new Error("Could not save"));
  fireEvent.click(save);
  await screen.findByText("Could not save");
  expect(screen.getByLabelText("New password")).toHaveValue("test123");
  expect(save).toBeEnabled();
});

it("discards secret inputs on section changes, project changes, and external replacement", async () => {
  await setup("knx-mbm", SYNTHETIC_KNX_MBM_XML);
  fill("secret1");
  fireEvent.click(screen.getByRole("button", { name: "General" }));
  fireEvent.click(screen.getByRole("button", { name: "Security" }));
  expect(screen.getByLabelText("New password")).toHaveValue("");
  fill("secret2");
  act(() => { window.dispatchEvent(new CustomEvent(PROJECT_REPLACED_EVENT)); });
  expect(screen.getByLabelText("New password")).toHaveValue("");
  fill("secret3");
  fireEvent.click(screen.getByRole("button", { name: "Switch project" }));
  await waitFor(() => expect(mocks.get).toHaveBeenCalledWith("other"));
  expect(await screen.findByLabelText("New password")).toHaveValue("");
  expect(mocks.patch).not.toHaveBeenCalled();
});

it("follows a section query change while Configuration remains mounted", async () => {
  await setup("knx-mbm", SYNTHETIC_KNX_MBM_XML);
  fill("secret1");
  mocks.search = "section=network";
  rerenderConfiguration?.();
  expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  mocks.search = "section=security";
  rerenderConfiguration?.();
  expect(await screen.findByLabelText("New password")).toHaveValue("");
});
