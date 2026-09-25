"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    "value" | "defaultValue" | "onChange" | "onKeyDown" | "children" | "type"
  > {
  value: string | number;
  options: readonly SelectOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  /** md: 30 px field; sm: 28 px, for drawers and dense panels. */
  size?: "md" | "sm";
  /** cell: fills a grid cell as its inline editor. */
  variant?: "field" | "cell";
  /** Search box above the list; by default shown above 8 options. */
  searchable?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Runs first for keys on the field and the search box; preventDefault skips the built-in handling. */
  onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void;
}

/**
 * V13 dropdown (direction B): borderless grey field that turns white with a
 * blue ring while focused or open, and a listbox menu with keyboard support
 * (↑ ↓ Home End Enter Esc) and a search box above 8 options. The menu opens
 * upward when there is no room below and closes on outside scroll or resize.
 */
const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
  (
    {
      value,
      options,
      onValueChange,
      placeholder = "Select…",
      size = "md",
      variant = "field",
      searchable: searchableProp,
      defaultOpen = false,
      onOpenChange,
      onKeyDown,
      disabled,
      className,
      ...props
    },
    ref,
  ) => {
    const [open, setOpen] = React.useState(false);
    const [q, setQ] = React.useState("");
    const [active, setActive] = React.useState(-1);
    const [side, setSide] = React.useState<"top" | "bottom">("bottom");
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const contentRef = React.useRef<HTMLDivElement>(null);
    const searchRef = React.useRef<HTMLInputElement>(null);
    const listRef = React.useRef<HTMLDivElement>(null);
    const skipRefocus = React.useRef(false);
    const isOpen = React.useRef(false);
    React.useImperativeHandle(ref, () => triggerRef.current as HTMLButtonElement);
    const listId = React.useId();

    const current = String(value);
    const selected = options.find((o) => o.value === current);
    const searchable = searchableProp ?? options.length > 8;
    const needle = q.trim().toLowerCase();
    const list = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
    const sm = size === "sm";

    const openMenu = () => {
      if (disabled) return;
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        const below = window.innerHeight - rect.bottom;
        setSide(below < 300 && rect.top > below ? "top" : "bottom");
      }
      const index = options.findIndex((o) => o.value === current);
      setQ("");
      setActive(index < 0 ? 0 : index);
      skipRefocus.current = false;
      isOpen.current = true;
      setOpen(true);
      onOpenChange?.(true);
    };
    const close = ({ refocus = true } = {}) => {
      // Radix (Escape, outside click) and the key handlers can both close.
      if (!isOpen.current) return;
      isOpen.current = false;
      skipRefocus.current = !refocus;
      setOpen(false);
      setQ("");
      onOpenChange?.(false);
    };
    // Picking returns to the field (Radix does it for Escape); an outside click does not.
    const closeToField = () => {
      close();
      triggerRef.current?.focus({ preventScroll: true });
    };
    const pick = (next: string) => {
      onValueChange(next);
      closeToField();
    };

    // Latest close for the window listeners below.
    const closeRef = React.useRef(close);
    closeRef.current = close;
    const openRef = React.useRef(openMenu);
    openRef.current = openMenu;

    React.useEffect(() => {
      if (defaultOpen) openRef.current();
    }, [defaultOpen]);

    React.useEffect(() => {
      if (!open) return;
      const onScroll = (event: Event) => {
        if (contentRef.current?.contains(event.target as Node)) return;
        closeRef.current({ refocus: false });
      };
      const onResize = () => closeRef.current({ refocus: false });
      // From the next frame: a scroll that brought the field into view while
      // opening (focus, click) still dispatches its event after the menu opened.
      const frame = requestAnimationFrame(() => {
        window.addEventListener("scroll", onScroll, true);
        window.addEventListener("resize", onResize);
      });
      return () => {
        cancelAnimationFrame(frame);
        window.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("resize", onResize);
      };
    }, [open]);

    // Keep the active option inside the scrolled list.
    const scrollActive = React.useCallback(() => {
      const listEl = listRef.current;
      const el = listEl?.children[active] as HTMLElement | undefined;
      if (!listEl || !el) return;
      if (el.offsetTop < listEl.scrollTop) listEl.scrollTop = el.offsetTop - 4;
      else if (el.offsetTop + el.offsetHeight > listEl.scrollTop + listEl.clientHeight) {
        listEl.scrollTop = el.offsetTop + el.offsetHeight - listEl.clientHeight + 4;
      }
    }, [active]);
    React.useEffect(scrollActive, [scrollActive]);

    const moveKey = (event: React.KeyboardEvent<HTMLElement>, fromSearch: boolean) => {
      const n = list.length;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((a) => (n ? (a + 1) % n : -1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((a) => (n ? (a - 1 + n) % n : -1));
      } else if (event.key === "Home") {
        event.preventDefault();
        setActive(0);
      } else if (event.key === "End") {
        event.preventDefault();
        setActive(n - 1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        const option = list[active];
        if (option) pick(option.value);
      } else if (event.key === "Tab") {
        // The menu lives in a portal: from the search box, Tab returns to the field.
        if (fromSearch) event.preventDefault();
        close({ refocus: fromSearch });
      }
    };

    const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (!open) {
        if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
          event.preventDefault();
          openMenu();
        }
      } else if (!searchable) {
        moveKey(event, false);
      }
    };

    const optionId = (i: number) => `${listId}-${i}`;
    const activeId = open && list[active] ? optionId(active) : undefined;

    return (
      <PopoverPrimitive.Root open={open} onOpenChange={(next) => (next ? openMenu() : close())}>
        <PopoverPrimitive.Trigger asChild>
          <button
            {...props}
            ref={triggerRef}
            type="button"
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={searchable ? undefined : activeId}
            disabled={disabled}
            onKeyDown={onTriggerKeyDown}
            className={cn(
              "flex items-center gap-2 text-left leading-none outline-none",
              variant === "cell"
                ? "h-full w-full rounded-none border-0 bg-transparent px-2.5 text-[12px] text-text-body outline-2 outline-offset-[-1px] outline-hms-accent/35"
                : cn(
                    "w-full rounded-[6px] border transition-[border-color,background-color,box-shadow] duration-[120ms]",
                    sm ? "h-7 pl-[9px] pr-2 text-[12px]" : "h-[30px] px-[10px] text-[12.5px]",
                    disabled
                      ? "cursor-not-allowed border-transparent bg-[#F5F6F7] text-fg-subtle"
                      : open
                        ? "cursor-pointer border-hms-accent bg-white text-text-body shadow-[0_0_0_3px_rgba(18,104,179,.16)]"
                        : "cursor-pointer border-transparent bg-[#F1F3F5] text-text-body hover:bg-[#E9EDF0] focus:border-hms-accent focus:bg-white focus:shadow-[0_0_0_3px_rgba(18,104,179,.16)]",
                  ),
              className,
            )}
          >
            <span className="min-w-0 flex-1 truncate">{selected ? selected.label : placeholder}</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden
              className={cn(
                "shrink-0 transition-transform duration-150",
                disabled ? "text-[#C3CAD0]" : open ? "rotate-180 text-hms-accent" : "text-fg-muted",
              )}
            >
              <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            ref={contentRef}
            side={side}
            align="start"
            sideOffset={4}
            avoidCollisions={false}
            // The portal mounts the menu a render after `open`: focus and scroll it here.
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              if (searchable) searchRef.current?.focus({ preventScroll: true });
              scrollActive();
            }}
            // Radix closes on Escape from a document capture listener; stop it there
            // so an enclosing modal or grid editor does not handle it as well.
            onEscapeKeyDown={(event) => event.stopPropagation()}
            onCloseAutoFocus={(event) => {
              if (skipRefocus.current) event.preventDefault();
            }}
            className="z-[1000] box-border animate-[select-menu-in_.12s_ease-out] motion-reduce:animate-none rounded-[8px] border border-border bg-white p-1 shadow-[0_10px_28px_rgba(0,30,50,.12),0_2px_6px_rgba(0,30,50,.06)]"
            style={{
              width: "max-content",
              minWidth: "max(var(--radix-popover-trigger-width), 160px)",
              maxWidth: "max(var(--radix-popover-trigger-width), 320px)",
            }}
          >
            {searchable && (
              <div className="-mx-1 -mt-1 mb-1 flex h-[34px] items-center gap-[7px] border-b border-[#EEF0F2] px-[10px]">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0 text-fg-subtle">
                  <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <input
                  ref={searchRef}
                  value={q}
                  aria-label="Search options"
                  aria-controls={listId}
                  aria-activedescendant={activeId}
                  placeholder="Search…"
                  className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[12.5px] text-text-body outline-none placeholder:text-fg-subtle"
                  onChange={(event) => {
                    setQ(event.target.value);
                    setActive(0);
                  }}
                  onKeyDown={(event) => {
                    onKeyDown?.(event);
                    if (!event.defaultPrevented) moveKey(event, true);
                  }}
                />
                <span className="font-mono text-[10.5px] font-medium text-fg-subtle">
                  {q ? `${list.length}/${options.length}` : options.length}
                </span>
              </div>
            )}
            <div ref={listRef} id={listId} role="listbox" className="flex max-h-[248px] flex-col gap-px overflow-auto">
              {list.map((option, i) => {
                const isSelected = option.value === selected?.value;
                return (
                  <div
                    key={option.value}
                    id={optionId(i)}
                    role="option"
                    aria-selected={isSelected}
                    data-value={option.value}
                    className={cn(
                      "flex shrink-0 cursor-pointer items-center gap-[10px] rounded-[5px] px-2",
                      sm ? "min-h-7 text-[12px]" : "min-h-[30px] text-[12.5px]",
                      isSelected
                        ? "bg-[#EAF3FB] font-bold text-hms-accent"
                        : cn("text-text-body", i === active && "bg-[#F1F3F5]"),
                    )}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(option.value)}
                  >
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {isSelected && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden className="shrink-0 text-hms-accent">
                        <path d="M2.5 6.2l2.3 2.3 4.7-4.9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                );
              })}
              {list.length === 0 && (
                <div className="px-[10px] py-[14px] text-center text-[12px] text-fg-subtle">No matches</div>
              )}
            </div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    );
  },
);
Select.displayName = "Select";

export { Select };
