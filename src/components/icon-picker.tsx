"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { Search, X, RotateCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { BrandIcon } from "@/components/brand-icon";
import {
  POPULAR_SERVICES,
  CATEGORIES,
  type ServiceTemplate,
} from "@/lib/popular-services";
import { cn } from "@/lib/utils";

/**
 * Fullscreen (mobile) / dialog (desktop) modal for picking a brand icon
 * on an existing subscription. Distinct from the creation-flow
 * ServicePicker: no "Add custom subscription" affordance; adds a
 * Reset option that clears the logo (render will fall back to the
 * sub's name).
 */
export function IconPicker({
  currentLogo,
  onSelect,
  onReset,
  onClose,
}: {
  currentLogo: string | null;
  onSelect: (serviceName: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Stash onClose in a ref so the effect below doesn't re-bind a window
  // listener on every parent render. Parents typically pass an inline
  // `onClose={() => ...}`, so without this the keydown/listener pair
  // would churn once per keystroke in the search input.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Close on Escape for keyboard users; trap Tab inside the dialog so keyboard
  // users can't walk back into the underlying page while the modal is open.
  // Restore focus to the previously-focused element on unmount.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const getFocusable = (): HTMLElement[] => {
      const root = dialogRef.current;
      if (!root) return [];
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute("data-focus-guard"));
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = getFocusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Restore focus to whatever was focused before the modal opened.
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, []);

  const filtered = useMemo(() => {
    let list = POPULAR_SERVICES;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q)
      );
    }
    if (activeCategory) {
      list = list.filter((s) => s.category === activeCategory);
    }
    return list;
  }, [search, activeCategory]);

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/40 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Change subscription icon"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Card className="w-full max-w-2xl my-8">
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[18px] font-semibold tracking-tight">
              Change icon
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer text-muted-foreground hover:text-foreground rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              aria-label="Close"
            >
              <X className="size-5" />
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search services..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className="cursor-pointer rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            >
              <Badge
                variant={activeCategory === null ? "default" : "secondary"}
                className="whitespace-nowrap cursor-pointer px-2.5 py-1"
              >
                All
              </Badge>
            </button>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() =>
                  setActiveCategory(activeCategory === cat ? null : cat)
                }
                className="cursor-pointer rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              >
                <Badge
                  variant={activeCategory === cat ? "default" : "secondary"}
                  className="whitespace-nowrap cursor-pointer px-2.5 py-1"
                >
                  {cat}
                </Badge>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 max-h-[60vh] overflow-y-auto">
            {filtered.map((service) => {
              const isCurrent = service.name === currentLogo;
              return (
                <button
                  key={`${service.name}-${service.category}`}
                  type="button"
                  onClick={() => onSelect(service.name)}
                  className="cursor-pointer text-left rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                  aria-label={`Use ${service.name} icon`}
                  aria-pressed={service.name === currentLogo}
                >
                  <Card
                    className={cn(
                      "hover:bg-muted/50 transition-colors duration-150 cursor-pointer h-full",
                      isCurrent && "ring-2 ring-[var(--brand)]"
                    )}
                  >
                    <CardContent className="pt-3 pb-3 px-3 flex items-center gap-2.5">
                      <BrandIcon name={service.name} size={24} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {service.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {service.category}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </button>
              );
            })}
          </div>

          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              No match for &quot;{search}&quot;
            </p>
          )}

          <div className="pt-2 border-t flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onReset}
              disabled={currentLogo === null}
              className="cursor-pointer gap-1.5"
              aria-label="Reset to default (letter)"
            >
              <RotateCcw className="size-3.5" />
              Reset to default
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="cursor-pointer"
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export type { ServiceTemplate };
