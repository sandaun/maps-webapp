import type { SignalPatchInput } from "@/lib/project-types";
import type { GridColumn } from "./types";

const DESC_MAX = 128;

export function projectColumns<R>(access: {
  id: (row: R) => number;
  description: (row: R) => string;
  active: (row: R) => boolean;
  descriptionEditable?: boolean;
}): GridColumn<R>[] {
  const descriptionEditable = access.descriptionEditable ?? true;
  return [
    {
      id: "select",
      group: "project",
      header: "",
      width: 36,
      resizable: false,
      frozen: true,
      kind: "none",
      getText: () => "",
    },
    {
      id: "id",
      group: "project",
      header: "#",
      width: 44,
      resizable: false,
      frozen: true,
      kind: "none",
      mono: true,
      getText: (row) => String(access.id(row)),
    },
    {
      id: "description",
      group: "project",
      header: "Description",
      width: 280,
      minWidth: 140,
      maxWidth: 520,
      frozen: true,
      kind: descriptionEditable ? "text" : "none",
      bulkLabel: descriptionEditable ? "Description" : undefined,
      getText: (row) => access.description(row) || "—",
      getEditorValue: (row) => access.description(row),
      parse: descriptionEditable
        ? (_row, raw) => {
            const description = raw.slice(0, DESC_MAX);
            return { patch: { description } };
          }
        : undefined,
      inverseFromText: descriptionEditable
        ? (row): SignalPatchInput => ({ description: access.description(row) })
        : undefined,
    },
    {
      id: "active",
      group: "project",
      header: "ON",
      width: 52,
      resizable: false,
      frozen: true,
      kind: "switch",
      bulkLabel: "Active",
      getText: (row) => (access.active(row) ? "On" : "Off"),
      getChecked: (row) => access.active(row),
      getEditorValue: (row) => (access.active(row) ? "true" : "false"),
      parse: (_row, raw) => ({ patch: { active: raw === "true" || raw === "On" } }),
      toPatchFromSwitch: (_row, checked) => ({ active: checked }),
      inverseFromSwitch: (row) => ({ active: access.active(row) }),
      inverseFromText: (row) => ({ active: access.active(row) }),
    },
  ];
}
