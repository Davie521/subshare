"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users, Search, ArrowUpRight } from "lucide-react";
import { api } from "@/lib/api-client";
import { UserAvatar } from "@/components/user-avatar";
import { BrandIcon } from "@/components/brand-icon";
import { cn } from "@/lib/utils";

type SharedSub = {
  id: number;
  name: string;
  price: number;
  currency: string;
  memberCount: number;
  myShare: number;
  logo: string | null;
};

type Friend = {
  userId: number;
  displayName: string;
  email?: string;
  since: string;
  sharedSubs: SharedSub[];
  nets: { currency: string; net: number }[];
  agreedCurrency: string | null;
};

const CURRENCY_OPTIONS = [
  "CNY",
  "USD",
  "HKD",
  "CAD",
  "EUR",
  "GBP",
  "JPY",
] as const;

function relativeSince(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays < 1) return "today";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
  });
}

export default function FriendsPage() {
  const router = useRouter();
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [preferredCurrency, setPreferredCurrency] = useState("CNY");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const loadFriends = useCallback(async () => {
    try {
      const res = await api.friends();
      if (res.data) {
        setFriends(res.data);
        setLoadError(null);
      } else if (res.status === 401) {
        router.push("/login");
      } else {
        setLoadError(res.error || "Failed to load");
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Network error");
    }
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    // loadFriends is async; state updates happen in later microtasks.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFriends();
    api.me()
      .then((r) => {
        if (cancelled) return;
        if (r.data) setPreferredCurrency(r.data.preferredCurrency);
      })
      .catch(() => {
        // Preferred-currency is non-critical; fall back to the default.
      });
    return () => {
      cancelled = true;
    };
  }, [loadFriends]);

  async function onCurrencyChange(friendId: number, currency: string | null) {
    // Optimistic update.
    setFriends((prev) =>
      prev
        ? prev.map((f) =>
            f.userId === friendId ? { ...f, agreedCurrency: currency } : f
          )
        : prev
    );
    await api.setFriendCurrency(friendId, currency);
  }

  const filtered = useMemo(() => {
    if (!friends) return null;
    const q = query.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter(
      (f) =>
        f.displayName.toLowerCase().includes(q) ||
        (f.email?.toLowerCase().includes(q) ?? false) ||
        f.sharedSubs.some((s) => s.name.toLowerCase().includes(q))
    );
  }, [friends, query]);

  if (loadError && !friends) {
    return (
      <div className="max-w-md space-y-4">
        <h1 className="text-[24px] font-bold tracking-[-0.022em]">
          Couldn&apos;t load friends
        </h1>
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Button onClick={() => router.refresh()}>Retry</Button>
      </div>
    );
  }

  const showSearch = (friends?.length ?? 0) > 4;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="text-[32px] font-bold leading-tight tracking-[-0.022em]">
            Friends
          </h1>
          <p className="text-[14px] text-muted-foreground max-w-xl">
            People you co-subscribe with. Anyone you add to a shared
            subscription shows up here automatically.
          </p>
        </div>
        {friends && friends.length > 0 && (
          <span className="text-[12px] font-medium text-muted-foreground tabular-nums">
            {friends.length} {friends.length === 1 ? "friend" : "friends"}
          </span>
        )}
      </header>

      {showSearch && (
        <div className="relative max-w-sm">
          <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or subscription"
            className="pl-9"
          />
        </div>
      )}

      {friends === null ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-44 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      ) : friends.length === 0 ? (
        <EmptyState />
      ) : filtered && filtered.length === 0 ? (
        <Card className="border-dashed bg-muted/30 shadow-none">
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              No friends match &ldquo;{query}&rdquo;.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {filtered!.map((f) => (
            <li key={f.userId} className="h-full">
              <FriendCard
                friend={f}
                preferredCurrency={preferredCurrency}
                onCurrencyChange={onCurrencyChange}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="border-dashed bg-muted/30 shadow-none">
      <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
        <div className="size-11 rounded-full bg-[var(--accent)] flex items-center justify-center">
          <Users className="size-[18px] text-[var(--accent-foreground)]" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold">No friends yet</p>
          <p className="text-[13px] text-muted-foreground max-w-[34ch]">
            Add someone to a shared subscription and they&apos;ll appear here.
          </p>
        </div>
        <Link href="/subscriptions">
          <Button size="sm" className="mt-1">
            Go to subscriptions
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

function FriendCard({
  friend,
  preferredCurrency,
  onCurrencyChange,
}: {
  friend: Friend;
  preferredCurrency: string;
  onCurrencyChange: (friendId: number, currency: string | null) => void;
}) {
  const subs = friend.sharedSubs;
  const effectiveCurrency = friend.agreedCurrency ?? preferredCurrency;
  return (
    <Card className="h-full transition-colors hover:border-[var(--brand)]/30">
      <CardContent className="h-full flex flex-col gap-5">
        {/* Identity row */}
        <div className="flex items-start gap-3.5">
          <UserAvatar name={friend.displayName} size="xl" />
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-[15px] font-semibold truncate leading-tight">
              {friend.displayName}
            </p>
            <p className="text-[13px] text-muted-foreground truncate mt-0.5">
              {friend.email ?? "Email hidden"}
            </p>
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70 mt-2">
              Connected {relativeSince(friend.since)}
            </p>
          </div>
        </div>

        {/* Settle-in currency */}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">
              Settle in
            </p>
            {friend.agreedCurrency === null && (
              <p className="text-[11px] text-muted-foreground tabular-nums">
                using default
              </p>
            )}
          </div>
          <select
            value={friend.agreedCurrency ?? ""}
            onChange={(e) =>
              onCurrencyChange(friend.userId, e.target.value || null)
            }
            className={cn(
              "h-8 w-full rounded-md border border-input bg-background px-2.5 text-[13px] font-medium",
              "shadow-xs transition-colors cursor-pointer",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40 focus-visible:ring-offset-1"
            )}
          >
            <option value="">
              Default · {preferredCurrency}
            </option>
            {CURRENCY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">
            Settlement totals with {friend.displayName} will show in{" "}
            <span className="font-medium text-foreground">
              {effectiveCurrency}
            </span>
            .
          </p>
        </div>

        {/* Shared subscriptions */}
        <div className="flex-1 space-y-2.5">
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">
              Sharing
            </p>
            <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
              {subs.length} {subs.length === 1 ? "sub" : "subs"}
            </span>
          </div>

          {subs.length > 0 ? (
            <div className="rounded-lg border bg-muted/20 divide-y divide-border/60 overflow-hidden">
              {subs.slice(0, 4).map((s) => (
                <Link
                  key={s.id}
                  href={`/subscriptions/${s.id}`}
                  className={cn(
                    "group flex items-center gap-2.5 px-3 py-2.5",
                    "hover:bg-foreground/[0.02] dark:hover:bg-white/[0.02]",
                    "transition-colors cursor-pointer"
                  )}
                >
                  <BrandIcon name={s.logo || s.name} size={20} />
                  <span className="text-[13px] font-medium truncate flex-1">
                    {s.name}
                  </span>
                  <ArrowUpRight className="size-3.5 text-muted-foreground/60 group-hover:text-[var(--brand)] transition-colors" />
                </Link>
              ))}
              {subs.length > 4 && (
                <div className="px-3 py-2 text-[12px] text-muted-foreground bg-muted/20">
                  +{subs.length - 4} more
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed bg-muted/10 px-3 py-4 text-center text-[12px] text-muted-foreground">
              No active shared subscriptions
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
