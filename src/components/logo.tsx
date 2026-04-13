import { cn } from "@/lib/utils";

/**
 * SubShare mark — two overlapping rounded cards.
 * Semantic: one subscription, shared between members. The back card sits
 * below and left, the front card above and right, with a small indigo
 * "shared zone" where they intersect (the crucial overlap).
 *
 * Sizes sensibly at 16/24/32/48 px. Uses CSS `color` for mono-tint rendering
 * when desired, or default fill for the brand-split treatment.
 */
export function LogoMark({
  size = 28,
  className,
  variant = "brand",
}: {
  size?: number;
  className?: string;
  variant?: "brand" | "mono";
}) {
  if (variant === "mono") {
    // Single-color version — useful on indigo backgrounds or tight contexts
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-hidden="true"
      >
        <rect
          x="3.5"
          y="7.5"
          width="17"
          height="17"
          rx="4.5"
          stroke="currentColor"
          strokeWidth="2"
          opacity="0.55"
        />
        <rect
          x="11.5"
          y="7.5"
          width="17"
          height="17"
          rx="4.5"
          fill="currentColor"
        />
      </svg>
    );
  }

  // Brand variant — subtle tinted back card, solid indigo front card
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Back card — tinted, represents the "other member" */}
      <rect
        x="3"
        y="7"
        width="18"
        height="18"
        rx="5"
        fill="var(--brand)"
        opacity="0.22"
      />
      {/* Front card — solid brand, represents "your share" */}
      <rect
        x="11"
        y="7"
        width="18"
        height="18"
        rx="5"
        fill="var(--brand)"
      />
      {/* Subtle highlight edge on front card */}
      <rect
        x="11.5"
        y="7.5"
        width="17"
        height="17"
        rx="4.5"
        stroke="white"
        strokeOpacity="0.12"
        strokeWidth="1"
      />
    </svg>
  );
}

/**
 * Full wordmark — logo + "SubShare" text.
 * Use in navigation headers. Text scales with `size` prop.
 */
export function Logo({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark size={size} />
      <span
        className="font-semibold tracking-[-0.015em]"
        style={{ fontSize: size * 0.6, lineHeight: 1 }}
      >
        SubShare
      </span>
    </span>
  );
}
