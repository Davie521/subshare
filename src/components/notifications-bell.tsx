"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";

/**
 * Compact bell button that surfaces the unread-notification count. Clicking
 * it navigates to /notifications. Poll-based refresh every 60s while the
 * tab is visible — no websocket, no dep.
 */
export function NotificationsBell({ className }: { className?: string }) {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const res = await api.notifications(1);
      if (cancelled) return;
      if (res.data) setUnread(res.data.unreadCount);
    }

    load();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 60_000);

    const onVis = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const label = unread > 0 ? `Notifications (${unread} unread)` : "Notifications";
  const displayCount = unread > 99 ? "99+" : String(unread);

  return (
    <Link
      href="/notifications"
      aria-label={label}
      className={cn(
        "relative inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground hover:bg-foreground/[0.04] cursor-pointer",
        className
      )}
    >
      <Bell className="size-[18px]" strokeWidth={1.75} />
      {unread > 0 && (
        <span
          className="absolute top-1.5 right-1.5 inline-flex min-w-[16px] h-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums leading-none text-white ring-2 ring-background"
          style={{ backgroundColor: "var(--brand)" }}
        >
          {displayCount}
        </span>
      )}
    </Link>
  );
}
