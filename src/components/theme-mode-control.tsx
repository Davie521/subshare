"use client";

import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import type { ThemeMode } from "@/lib/theme";

const OPTIONS: Array<{ value: ThemeMode; label: string; Icon: typeof Sun }> = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "auto", label: "Auto", Icon: Monitor },
];

export function ThemeModeControl() {
  const { mode, setMode } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        "inline-flex rounded-md border border-border bg-muted/40 p-0.5",
        "shadow-xs",
      )}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setMode(value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-[13px] font-medium",
              "transition-colors cursor-pointer",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
