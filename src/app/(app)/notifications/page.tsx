"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Bell, Check, DollarSign, UserMinus, UserPlus, Wallet, CheckCheck, Sparkles } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

type Notification = {
  id: number;
  type: string;
  subscriptionId: number | null;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
};

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const delta = Math.max(0, now - then);
  const s = Math.floor(delta / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function Icon({ type }: { type: string }) {
  const base = "size-[16px]";
  switch (type) {
    case "added_to_sub":
      return <UserPlus className={base} strokeWidth={1.75} />;
    case "removed_from_sub":
      return <UserMinus className={base} strokeWidth={1.75} />;
    case "price_changed":
      return <DollarSign className={base} strokeWidth={1.75} />;
    case "payer_changed":
      return <Wallet className={base} strokeWidth={1.75} />;
    default:
      return <Bell className={base} strokeWidth={1.75} />;
  }
}

function renderMessage(n: Notification): { title: string; detail?: string } {
  const p = n.payload as Record<string, unknown>;
  const currency = (p.share_currency as string) || (p.currency as string) || "CNY";
  switch (n.type) {
    case "added_to_sub": {
      const proRated =
        typeof p.this_cycle_prorated === "number"
          ? formatMoney(p.this_cycle_prorated, currency)
          : null;
      const share =
        typeof p.share === "number" ? formatMoney(p.share, currency) : null;
      const actor = (p.actor_name as string) ?? "Someone";
      const subName = (p.sub_name as string) ?? "a subscription";
      return {
        title: `${actor} added you to ${subName}`,
        detail: share
          ? `${share}/mo · first cycle ${proRated ?? "—"} · next bill ${p.next_billing_date ?? ""}`
          : undefined,
      };
    }
    case "price_changed": {
      const subName = (p.sub_name as string) ?? "A subscription";
      const oldShare =
        typeof p.old_share === "number" ? formatMoney(p.old_share, currency) : "—";
      const newShare =
        typeof p.new_share === "number" ? formatMoney(p.new_share, currency) : "—";
      const delta =
        typeof p.delta === "number"
          ? (p.delta >= 0 ? "+" : "") + formatMoney(p.delta, currency)
          : "";
      return {
        title: `${subName} price changed`,
        detail: `Your share ${oldShare} → ${newShare} (${delta}) · effective ${p.effective_from ?? ""}`,
      };
    }
    case "payer_changed": {
      const subName = (p.sub_name as string) ?? "A subscription";
      return {
        title: `${subName} payer changed`,
        detail: `${p.old_payer_name ?? "Previous"} → ${p.new_payer_name ?? "New"}`,
      };
    }
    case "removed_from_sub": {
      const actor = (p.actor_name as string) ?? "Someone";
      const subName = (p.sub_name as string) ?? "a subscription";
      return { title: `${actor} removed you from ${subName}` };
    }
    default:
      return { title: n.type };
  }
}

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  async function load() {
    const res = await api.notifications(200);
    if (res.data) {
      setItems(res.data.items as Notification[]);
      setLoadError(null);
    } else if (res.status === 401) {
      window.location.assign("/login");
    } else {
      setLoadError(res.error || "Failed to load");
    }
  }

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const unreadCount = useMemo(
    () => (items ? items.filter((n) => n.readAt === null).length : 0),
    [items]
  );

  async function onItemClick(n: Notification) {
    if (!n.readAt) {
      // Optimistic
      setItems((prev) =>
        prev ? prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) : prev
      );
      await api.markNotificationRead(n.id);
    }
  }

  async function onMarkAll() {
    if (markingAll || unreadCount === 0) return;
    setMarkingAll(true);
    setItems((prev) =>
      prev ? prev.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })) : prev
    );
    await api.markAllNotificationsRead();
    setMarkingAll(false);
  }

  if (loadError && !items) {
    return (
      <div className="max-w-md space-y-4">
        <h1 className="text-[24px] font-bold tracking-[-0.022em]">
          Couldn&apos;t load notifications
        </h1>
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Button onClick={() => window.location.reload()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <header className="flex items-end justify-between gap-4">
        <div className="space-y-1.5">
          <p className="text-[13px] font-medium text-muted-foreground">Activity</p>
          <h1 className="text-[32px] font-bold leading-tight tracking-[-0.022em]">
            Notifications
          </h1>
        </div>
        {items && unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={onMarkAll}
            disabled={markingAll}
            className="cursor-pointer gap-1.5 shrink-0"
          >
            <CheckCheck className="size-3.5" />
            Mark all read
          </Button>
        )}
      </header>

      {items === null ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card className="border-dashed bg-muted/30 shadow-none">
          <CardContent className="py-14 flex flex-col items-center gap-2.5 text-center">
            <div className="size-9 rounded-full bg-[var(--accent)] flex items-center justify-center">
              <Sparkles className="size-[16px] text-[var(--accent-foreground)]" />
            </div>
            <p className="text-sm font-medium">All caught up</p>
            <p className="text-[13px] text-muted-foreground">
              New activity will show up here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-1.5">
          {items.map((n) => {
            const { title, detail } = renderMessage(n);
            const unread = n.readAt === null;
            const body = (
              <div
                className={cn(
                  "group flex gap-3 px-3.5 py-3 rounded-lg border transition-colors cursor-pointer",
                  unread
                    ? "bg-foreground/[0.02] border-[rgba(0,0,0,0.08)] dark:border-white/[0.08]"
                    : "bg-transparent border-transparent hover:bg-foreground/[0.025] dark:hover:bg-white/[0.03]"
                )}
              >
                <div
                  className={cn(
                    "mt-0.5 shrink-0 size-8 rounded-full flex items-center justify-center",
                    unread
                      ? "bg-[var(--brand)]/10 text-[var(--brand)]"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  <Icon type={n.type} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <p className={cn("text-sm truncate", unread ? "font-semibold" : "font-medium")}>
                      {title}
                    </p>
                    {unread && (
                      <span
                        className="shrink-0 size-1.5 rounded-full"
                        style={{ backgroundColor: "var(--brand)" }}
                      />
                    )}
                  </div>
                  {detail && (
                    <p className="text-[13px] text-muted-foreground mt-0.5 tabular-nums">
                      {detail}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground/70 mt-1">
                    {relativeTime(n.createdAt)}
                  </p>
                </div>
                {unread && (
                  <button
                    type="button"
                    title="Mark as read"
                    aria-label="Mark as read"
                    className="shrink-0 size-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] cursor-pointer"
                    onClick={async (e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      await onItemClick(n);
                    }}
                  >
                    <Check className="size-3.5" />
                  </button>
                )}
              </div>
            );
            return (
              <li key={n.id}>
                {n.subscriptionId ? (
                  <Link
                    href={`/subscriptions/${n.subscriptionId}`}
                    onClick={() => onItemClick(n)}
                  >
                    {body}
                  </Link>
                ) : (
                  <div onClick={() => onItemClick(n)}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
