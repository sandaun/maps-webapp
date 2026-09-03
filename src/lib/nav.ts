import {
  Activity,
  Cable,
  LayoutDashboard,
  List,
  Network,
  Rocket,
  Settings,
  type LucideIcon,
} from "lucide-react";
import type { FamilyId } from "./project-types";

export interface NavSection {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_SECTIONS: NavSection[] = [
  { href: "/connection", label: "Connection", icon: Cable },
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/configuration", label: "Configuration", icon: Settings },
  { href: "/devices", label: "Modbus devices", icon: Network },
  { href: "/signals", label: "Signals", icon: List },
  { href: "/diagnostics", label: "Diagnostics", icon: Activity },
  { href: "/deploy", label: "Deploy", icon: Rocket },
];

/** The /devices screen lists AC units on me-mbs projects, Modbus nodes elsewhere. */
const DEVICES_LABELS: Record<FamilyId, string> = {
  "knx-mbm": "Modbus devices",
  "me-mbs": "AC units",
};

export function navLabelFor(section: NavSection, family?: FamilyId): string {
  return section.href === "/devices" && family ? DEVICES_LABELS[family] : section.label;
}

export function sectionLabelForPath(pathname: string, family?: FamilyId): string {
  const section = NAV_SECTIONS.find((s) => pathname.startsWith(s.href));
  return section ? navLabelFor(section, family) : "Connection";
}
