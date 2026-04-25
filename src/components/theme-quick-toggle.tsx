"use client";

import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import type { ThemeMode } from "@/lib/theme";

const NEXT: Record<ThemeMode, ThemeMode> = {
  light: "dark",
  dark: "auto",
  auto: "light",
};

const LABEL: Record<ThemeMode, string> = {
  light: "Light theme",
  dark: "Dark theme",
  auto: "Auto theme (follows system)",
};

export function ThemeQuickToggle({ className }: { className?: string }) {
  const { mode, setMode } = useTheme();
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;
  const next = NEXT[mode];

  return (
    <button
      type="button"
      aria-label={`${LABEL[mode]}. Click to switch to ${LABEL[next].toLowerCase()}.`}
      title={LABEL[mode]}
      onClick={() => setMode(next)}
      className={cn(
        "inline-flex items-center justify-center size-8 rounded-md cursor-pointer",
        "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05]",
        "transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40",
        className,
      )}
    >
      <Icon className="size-[16px]" strokeWidth={1.75} />
    </button>
  );
}
