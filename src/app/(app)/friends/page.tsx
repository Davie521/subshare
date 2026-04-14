"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, ArrowRight } from "lucide-react";
import { api } from "@/lib/api-client";
import { UserAvatar } from "@/components/user-avatar";
import { BrandIcon } from "@/components/brand-icon";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

type SharedSub = {
  id: number;
  name: string;
  price: number;
  currency: string;
  memberCount: number;
  myShare: number;
};

type FriendNet = { currency: string; net: number };

type Friend = {
  userId: number;
  displayName: string;
  email?: string;
  since: string;
  sharedSubs: SharedSub[];
  nets: FriendNet[];
};

function relativeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays < 1) return "today";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function FriendsPage() {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api.friends().then((res) => {
      if (res.data) {
        setFriends(res.data);
        setLoadError(null);
      } else if (res.status === 401) {
        window.location.assign("/login");
      } else {
        setLoadError(res.error || "Failed to load");
      }
    });
  }, []);

  const totals = useMemo(() => {
    if (!friends) return null;
    const uniqSubIds = new Set<number>();
    let openBalances = 0;
    for (const f of friends) {
      f.sharedSubs.forEach((s) => uniqSubIds.add(s.id));
      openBalances += f.nets.filter((n) => n.net !== 0).length;
    }
    return {
      friends: friends.length,
      subs: uniqSubIds.size,
      openBalances,
    };
  }, [friends]);

  if (loadError && !friends) {
    return (
      <div className="max-w-md space-y-4">
        <h1 className="text-[24px] font-bold tracking-[-0.022em]">
          Couldn&apos;t load friends
        </h1>
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Button onClick={() => window.location.reload()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <header className="space-y-1.5">
        <h1 className="text-[32px] font-bold leading-tight tracking-[-0.022em]">
          Friends
        </h1>
        <p className="text-[14px] text-muted-foreground max-w-xl">
          Everyone you&apos;ve shared a subscription with. Balances are
          computed from your local bills — nothing leaves your account.
        </p>
      </header>

      {/* Summary strip */}
      {totals && friends && friends.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          <StatMini label="Friends" value={totals.friends} />
          <StatMini label="Shared subscriptions" value={totals.subs} />
          <StatMini
            label="Open balances"
            value={totals.openBalances}
            tone={totals.openBalances > 0 ? "warn" : "neutral"}
            hint={
              totals.openBalances > 0
                ? "Head to Settlement to clear"
                : "All clear"
            }
            href={totals.openBalances > 0 ? "/settlement" : undefined}
          />
        </div>
      )}

      {friends === null ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-52 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      ) : friends.length === 0 ? (
        <Card className="border-dashed bg-muted/30 shadow-none">
          <CardContent className="py-16 flex flex-col items-center gap-2.5 text-center">
            <div className="size-10 rounded-full bg-[var(--accent)] flex items-center justify-center">
              <Users className="size-[18px] text-[var(--accent-foreground)]" />
            </div>
            <p className="text-sm font-medium">No friends yet</p>
            <p className="text-[13px] text-muted-foreground max-w-[30ch]">
              Adding someone to a shared subscription connects you here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {friends.map((f) => (
            <li key={f.userId} className="h-full">
              <FriendCard friend={f} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatMini({
  label,
  value,
  hint,
  tone = "neutral",
  href,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "neutral" | "warn";
  href?: string;
}) {
  const inner = (
    <Card
      className={cn(
        "h-full transition-colors",
        href && "hover:border-[var(--brand)]/40 cursor-pointer"
      )}
    >
      <CardContent className="space-y-2.5">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </p>
        <p className="text-[28px] font-bold tracking-[-0.022em] tabular-nums leading-none">
          {value}
        </p>
        {hint && (
          <p
            className={cn(
              "text-[12px]",
              tone === "warn"
                ? "text-[#dd5b00] dark:text-[#f59e0b]"
                : "text-muted-foreground"
            )}
          >
            {hint}
          </p>
        )}
      </CardContent>
    </Card>
  );
  if (href) return <Link href={href}>{inner}</Link>;
  return inner;
}

function FriendCard({ friend }: { friend: Friend }) {
  const hasBalance = friend.nets.some((n) => n.net !== 0);
  return (
    <Card className="h-full">
      <CardContent className="h-full flex flex-col gap-4">
        {/* Header row */}
        <div className="flex items-center gap-3">
          <UserAvatar name={friend.displayName} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">
              {friend.displayName}
            </p>
            {friend.email ? (
              <p className="text-[13px] text-muted-foreground truncate">
                {friend.email}
              </p>
            ) : (
              <p className="text-[13px] text-muted-foreground">Hidden email</p>
            )}
          </div>
          <p className="text-[12px] text-muted-foreground shrink-0">
            since {relativeDate(friend.since)}
          </p>
        </div>

        {/* Balance rows per currency */}
        {hasBalance ? (
          <div className="rounded-md border bg-muted/30 divide-y">
            {friend.nets.map((n) => {
              const iOwe = n.net < 0;
              const even = n.net === 0;
              const abs = Math.abs(n.net);
              return (
                <div
                  key={n.currency}
                  className="flex items-center justify-between px-3 py-2 text-[13px] tabular-nums"
                >
                  <span className="text-muted-foreground">
                    {even
                      ? "Even"
                      : iOwe
                      ? `You owe ${friend.displayName}`
                      : `${friend.displayName} owes you`}{" "}
                    · {n.currency}
                  </span>
                  <span
                    className={cn(
                      "font-semibold",
                      even && "text-muted-foreground",
                      !even && iOwe && "text-[var(--brand)]",
                      !even && !iOwe && "text-[#0d8a2d] dark:text-[#22c55e]"
                    )}
                  >
                    {even ? "—" : formatMoney(abs, n.currency)}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-md border border-dashed bg-muted/20 px-3 py-2 text-[12px] text-muted-foreground">
            No open balance
          </div>
        )}

        {/* Shared subs */}
        <div className="space-y-1.5 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">
            Shared ({friend.sharedSubs.length})
          </p>
          {friend.sharedSubs.length > 0 ? (
            <ul className="space-y-0.5">
              {friend.sharedSubs.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/subscriptions/${s.id}`}
                    className="group flex items-center justify-between gap-3 py-1.5 px-1 rounded-md hover:bg-foreground/[0.03] dark:hover:bg-white/[0.03] transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <BrandIcon name={s.name} size={20} />
                      <p className="text-sm font-medium truncate">{s.name}</p>
                      <Badge variant="secondary" className="text-[10px] px-1.5">
                        {s.memberCount}
                      </Badge>
                    </div>
                    <p className="text-[13px] font-medium tabular-nums whitespace-nowrap text-muted-foreground group-hover:text-foreground">
                      {formatMoney(s.myShare, s.currency)}
                      <span className="text-muted-foreground/70 font-normal text-xs ml-0.5">
                        /mo
                      </span>
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              No active shared subscriptions.
            </p>
          )}
        </div>

        {hasBalance && (
          <div className="pt-1">
            <Link
              href="/settlement"
              className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--brand)] hover:underline"
            >
              Settle up
              <ArrowRight className="size-3" />
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
