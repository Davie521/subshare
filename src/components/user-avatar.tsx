import { cn } from "@/lib/utils";

/**
 * Minimal default avatar — a soft neutral circle with the first letter of
 * the user's display name. Honours docs/DESIGN.md's rule that brand indigo is
 * the only chromatic accent; avatars stay in the warm-neutral / white-
 * opacity scale so they never compete with real colour signals (money).
 *
 * The one deviation: an optional `tone` prop lets callers opt-into a
 * brand-tinted variant (self-identification, payer badge, etc.) while
 * the default is always quiet.
 */

export type AvatarTone = "neutral" | "brand" | "muted";

const SIZE_STYLES: Record<
  "sm" | "md" | "lg" | "xl",
  { box: string; text: string }
> = {
  sm: { box: "size-7", text: "text-[11px]" },
  md: { box: "size-9", text: "text-[13px]" },
  lg: { box: "size-10", text: "text-[14px]" },
  xl: { box: "size-12", text: "text-[16px]" },
};

const TONE_STYLES: Record<AvatarTone, string> = {
  // Warm paper in light, low-opacity white in dark. Foreground glyph.
  neutral:
    "bg-[rgba(0,0,0,0.05)] text-foreground dark:bg-white/[0.06] dark:text-foreground ring-1 ring-inset ring-[rgba(0,0,0,0.06)] dark:ring-white/[0.06]",
  // Brand tint — reserved for "you" indicators and payer badges
  brand:
    "bg-[var(--brand)]/12 text-[var(--brand)] dark:bg-[var(--brand)]/18 dark:text-[var(--brand-accent)] ring-1 ring-inset ring-[var(--brand)]/15",
  // Extra quiet — for secondary listings
  muted:
    "bg-muted/60 text-muted-foreground ring-1 ring-inset ring-[rgba(0,0,0,0.04)] dark:ring-white/[0.04]",
};

export function UserAvatar({
  name,
  size = "md",
  tone = "neutral",
  className,
}: {
  name: string;
  size?: "sm" | "md" | "lg" | "xl";
  tone?: AvatarTone;
  className?: string;
}) {
  const letter = name.trim().charAt(0).toUpperCase() || "?";
  const s = SIZE_STYLES[size];
  return (
    <span
      aria-hidden
      className={cn(
        "shrink-0 inline-flex items-center justify-center rounded-full font-semibold tracking-[-0.01em] tabular-nums",
        s.box,
        s.text,
        TONE_STYLES[tone],
        className
      )}
    >
      {letter}
    </span>
  );
}
