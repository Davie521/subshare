import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SubscriptionTag } from "@/lib/api-client";

/**
 * Compact chip for a single subscription tag. Private tags get a lock icon;
 * public tags are icon-free. Uses `rounded-md` (6px) per design system.
 */
export function TagChip({
  tag,
  className,
}: {
  tag: SubscriptionTag;
  className?: string;
}) {
  const isPrivate = tag.visibility === "private";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        isPrivate
          ? "border-border bg-muted/60 text-muted-foreground"
          : "border-transparent bg-accent text-accent-foreground",
        className
      )}
      title={isPrivate ? `${tag.label} · private` : tag.label}
    >
      {isPrivate && <Lock className="h-2.5 w-2.5" aria-hidden="true" />}
      <span className="truncate max-w-[10ch]">{tag.label}</span>
    </span>
  );
}

/**
 * Render a list of tag chips with overflow handling. `max` caps how many
 * chips are actually rendered; surplus becomes a `+N` chip.
 */
export function TagChipList({
  tags,
  max,
  className,
}: {
  tags: SubscriptionTag[];
  max?: number;
  className?: string;
}) {
  if (!tags?.length) return null;
  const shown = max ? tags.slice(0, max) : tags;
  const overflow = max ? tags.length - max : 0;
  return (
    <div className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {shown.map((t, i) => (
        <TagChip key={`${t.label}-${i}`} tag={t} />
      ))}
      {overflow > 0 && (
        <span className="inline-flex items-center rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground">
          +{overflow}
        </span>
      )}
    </div>
  );
}
