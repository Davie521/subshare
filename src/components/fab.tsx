"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";

/**
 * Floating Action Button — bottom-right persistent CTA.
 * Primary brand indigo, 56px, offset 24px from edges.
 * Hidden on routes where "new subscription" has no semantic purpose:
 * /subscriptions/new (self-reference), /settlement, /settings.
 */
export function Fab() {
  const pathname = usePathname();
  if (pathname.startsWith("/subscriptions/new")) return null;
  if (pathname.startsWith("/settlement")) return null;
  if (pathname.startsWith("/settings")) return null;

  return (
    <Link
      href="/subscriptions/new"
      aria-label="New subscription"
      className="
        fixed z-40 cursor-pointer
        bottom-20 right-4 lg:bottom-8 lg:right-8
        flex items-center justify-center
        size-14 rounded-full
        bg-[var(--brand)] text-white
        shadow-[0_8px_24px_rgba(94,106,210,0.35),0_2px_6px_rgba(94,106,210,0.2)]
        hover:bg-[var(--brand-accent)]
        hover:shadow-[0_12px_28px_rgba(94,106,210,0.45),0_4px_10px_rgba(94,106,210,0.25)]
        active:translate-y-px active:scale-[0.97]
        transition-all duration-200 ease-out
        focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--brand)]/30
      "
    >
      <Plus className="size-6" strokeWidth={2.25} />
    </Link>
  );
}
