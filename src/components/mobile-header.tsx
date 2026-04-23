"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";

const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/subscriptions": "Subscriptions",
  "/subscriptions/new": "New subscription",
  "/settlement": "Settlement",
  "/friends": "Friends",
  "/settings": "Settings",
  "/settings/circles": "Member templates",
};

function titleFor(pathname: string): string | null {
  if (TITLES[pathname]) return TITLES[pathname];
  // Dynamic routes inherit their section's title via longest-prefix match
  // (e.g. /subscriptions/[id] → "Subscriptions", /settings/circles/[id] → "Member templates").
  let best: string | null = null;
  let bestLen = 0;
  for (const [prefix, title] of Object.entries(TITLES)) {
    if (pathname.startsWith(prefix + "/") && prefix.length > bestLen) {
      best = title;
      bestLen = prefix.length;
    }
  }
  return best;
}

export function MobileHeader() {
  const pathname = usePathname();
  const title = titleFor(pathname);

  return (
    <header className="lg:hidden flex items-center justify-between h-14 px-4 border-b bg-background/90 backdrop-blur-md sticky top-0 z-40">
      <Link href="/dashboard" className="cursor-pointer transition-opacity hover:opacity-80 flex items-center">
        <Logo size={22} />
      </Link>
      {title && (
        <h1 className="text-[14px] font-semibold tracking-[-0.005em] truncate absolute left-1/2 -translate-x-1/2 max-w-[55%] text-center">
          {title}
        </h1>
      )}
    </header>
  );
}
