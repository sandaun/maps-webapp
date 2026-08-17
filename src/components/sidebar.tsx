"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_SECTIONS } from "@/lib/nav";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 flex w-[228px] flex-col bg-hms-blue text-white">
      <div className="px-4 pt-5 pb-4">
        <div className="font-display text-lg font-medium tracking-wide">MAPS</div>
        <div className="font-display text-[10px] tracking-[0.18em] text-white/60">
          · INTESIS CLOUD
        </div>
      </div>

      <div className="mx-3 mb-3 rounded-md bg-white/5 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-white/50">Gateway</div>
        <div className="mt-0.5 text-xs text-white/80">No gateway connected</div>
      </div>

      <nav className="flex-1 space-y-0.5 px-2" aria-label="Main">
        {NAV_SECTIONS.map((section) => {
          const active = pathname.startsWith(section.href);
          const Icon = section.icon;
          return (
            <Link
              key={section.href}
              href={section.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-2.5 rounded-r px-3 py-2 text-[13px] transition-colors",
                active
                  ? "bg-white/10 font-medium text-white before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-hms-pop"
                  : "text-white/70 hover:bg-white/5 hover:text-white",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {section.label}
            </Link>
          );
        })}
      </nav>

      <div className="mx-3 mb-4 rounded-md bg-white/5 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-white/50">Session</div>
        <Badge variant="warning" className="mt-1">
          Demo mode
        </Badge>
      </div>
    </aside>
  );
}
