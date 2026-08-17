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

export function sectionLabelForPath(pathname: string): string {
  const section = NAV_SECTIONS.find((s) => pathname.startsWith(s.href));
  return section?.label ?? "Connection";
}
