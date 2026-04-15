"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import {
  Bell,
  Check,
  DollarSign,
  UserMinus,
  UserPlus,
  Wallet,
  Sparkles,
  ArrowUpRight,
  ArrowDownLeft,
} from "lucide-react";
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

function Icon({
  type,
  payload,
}: {
  type: string;
  payload: Record<string, unknown>;
}) {
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
    case "settlement_due":
      return payload.direction === "incoming" ? (
        <ArrowDownLeft className={base} strokeWidth={1.75} />
      ) : (
        <ArrowUpRight className={base} strokeWidth={1.75} />
      );
    default:
      return <Bell className={base} strokeWidth={1.75} />;
  }
}

function renderMessage(n: Notification): { title: string; detail?: string } {
  const p = n.payload as Record<string, unknown>;
  const currency =
    (p.share_currency as string) || (p.currency as string) || "CNY";
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
          ? `${share}/mo · first cycle ${proRated ?? "—"} · next bill ${
              p.next_billing_date ?? ""
            }`
          : undefined,
      };
    }
    case "price_changed": {
      const subName = (p.sub_name as string) ?? "A subscription";
      const oldShare =
        typeof p.old_share === "number"
          ? formatMoney(p.old_share, currency)
          : "—";
      const newShare =
        typeof p.new_share === "number"
          ? formatMoney(p.new_share, currency)
          : "—";
      const delta =
        typeof p.delta === "number"
          ? (p.delta >= 0 ? "+" : "") + formatMoney(p.delta, currency)
          : "";
      return {
        title: `${subName} price changed`,
        detail: `Your share ${oldShare} → ${newShare} (${delta}) · effective ${
          p.effective_from ?? ""
        }`,
      };
    }
    case "payer_changed": {
      const subName = (p.sub_name as string) ?? "A subscription";
      return {
        title: `${subName} payer changed`,
        detail: `${p.old_payer_name ?? "Previous"} → ${
          p.new_payer_name ?? "New"
        }`,
      };
    }
    case "removed_from_sub": {
      const actor = (p.actor_name as string) ?? "Someone";
      const subName = (p.sub_name as string) ?? "a subscription";
      return { title: `${actor} removed you from ${subName}` };
    }
    case "settlement_due": {
      const direction =
        (p.direction as string) === "incoming" ? "incoming" : "outgoing";
      const counterparty =
        (p.counterpartyName as string) ?? "Someone";
      const cur = (p.currency as string) || "CNY";
      const amount =
        typeof p.amount === "number" ? formatMoney(p.amount, cur) : "—";
      const billCount = typeof p.billCount === "number" ? p.billCount : 0;
      const oldest = (p.oldestBillingDate as string) ?? "";
      const oldestStr = oldest
        ? new Date(oldest).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })
        : null;
      const title =
        direction === "outgoing"
          ? `You owe ${counterparty} ${amount}`
          : `${counterparty} owes you ${amount}`;
      const detail = `${billCount} ${
        billCount === 1 ? "bill" : "bills"
      }${oldestStr ? ` · since ${oldestStr}` : ""}`;
      return { title, detail };
    }
    default:
      return { title: n.type };
  }
}

/**
 * Shared notification list. Used on Dashboard (compact, limit=10, no header)
 * and could be re-used elsewhere. Handles fetch, mark-one-read, mark-all-read.
 *
 * When `unreadOnly` is set, marking an item read removes it from view —
 * older queued items take its slot.
 */
export function NotificationsList({
  limit = 50,
  unreadOnly = false,
  maxVisible,
}: {
  limit?: number;
  /** Deprecated — kept for backward compat, has no effect. */
  showMarkAll?: boolean;
  unreadOnly?: boolean;
  maxVisible?: number;
}) {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    const res = await api.notifications(limit);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleItems = useMemo(() => {
    if (!items) return null;
    const filtered = unreadOnly
      ? items.filter((n) => n.readAt === null)
      : items;
    return typeof maxVisible === "number"
      ? filtered.slice(0, maxVisible)
      : filtered;
  }, [items, unreadOnly, maxVisible]);

  async function onItemClick(n: Notification) {
    if (!n.readAt) {
      setItems((prev) =>
        prev
          ? prev.map((x) =>
              x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x
            )
          : prev
      );
      await api.markNotificationRead(n.id);
    }
  }

  if (loadError && !items) {
    return (
      <p className="text-sm text-muted-foreground">
        Couldn&apos;t load notifications — {loadError}
      </p>
    );
  }

  if (items === null) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (!visibleItems || visibleItems.length === 0) {
    return (
      <Card className="border-dashed bg-muted/30 shadow-none">
        <CardContent className="py-10 flex flex-col items-center gap-2 text-center">
          <div className="size-8 rounded-full bg-[var(--accent)] flex items-center justify-center">
            <Sparkles className="size-[14px] text-[var(--accent-foreground)]" />
          </div>
          <p className="text-sm font-medium">All caught up</p>
          <p className="text-[13px] text-muted-foreground">
            New activity will show up here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div>
      <ul className="-mx-1">
        {visibleItems.map((n) => {
          const { title, detail } = renderMessage(n);
          const unread = n.readAt === null;
          const body = (
            <div
              className={cn(
                "group relative flex gap-3 px-3.5 py-2.5 transition-colors cursor-pointer",
                "hover:bg-foreground/[0.025] dark:hover:bg-white/[0.03]"
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
                <Icon type={n.type} payload={n.payload} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <p
                    className={cn(
                      "text-sm truncate leading-tight",
                      unread ? "font-semibold" : "font-medium"
                    )}
                  >
                    {title}
                  </p>
                  {unread && (
                    <span
                      className="shrink-0 size-1.5 rounded-full"
                      style={{ backgroundColor: "var(--brand)" }}
                    />
                  )}
                  <span className="ml-auto text-[11px] text-muted-foreground/70 shrink-0 tabular-nums">
                    {relativeTime(n.createdAt)}
                  </span>
                </div>
                {detail && (
                  <p className="text-[12.5px] text-muted-foreground mt-1 tabular-nums leading-snug">
                    {detail}
                  </p>
                )}
              </div>
              {unread && (
                <button
                  type="button"
                  title="Mark as read"
                  aria-label="Mark as read"
                  className="shrink-0 self-start size-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
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
          const href =
            n.type === "settlement_due"
              ? "/settlement"
              : n.subscriptionId
              ? `/subscriptions/${n.subscriptionId}`
              : null;
          return (
            <li key={n.id}>
              {href ? (
                <Link href={href} onClick={() => onItemClick(n)}>
                  {body}
                </Link>
              ) : (
                <div onClick={() => onItemClick(n)}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
