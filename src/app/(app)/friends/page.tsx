"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users } from "lucide-react";
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
    <div className="space-y-6 max-w-2xl">
      <header className="space-y-1.5">
        <h1 className="text-[32px] font-bold leading-tight tracking-[-0.022em]">
          Friends
        </h1>
        <p className="text-[14px] text-muted-foreground max-w-md">
          Everyone you&apos;ve shared a subscription with. Balances are
          computed from your local bills — nothing leaves your account.
        </p>
      </header>

      {friends === null ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      ) : friends.length === 0 ? (
        <Card className="border-dashed bg-muted/30 shadow-none">
          <CardContent className="py-14 flex flex-col items-center gap-2.5 text-center">
            <div className="size-9 rounded-full bg-[var(--accent)] flex items-center justify-center">
              <Users className="size-[16px] text-[var(--accent-foreground)]" />
            </div>
            <p className="text-sm font-medium">No friends yet</p>
            <p className="text-[13px] text-muted-foreground max-w-[28ch]">
              Adding someone to a shared subscription connects you here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {friends.map((f) => (
            <li key={f.userId}>
              <FriendCard friend={f} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FriendCard({ friend }: { friend: Friend }) {
  const hasBalance = friend.nets.length > 0;
  return (
    <Card>
      <CardContent className="space-y-4">
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

        {/* Balance row(s) */}
        {hasBalance && (
          <div className="rounded-md bg-muted/50 px-3 py-2 space-y-1">
            {friend.nets.map((n) => {
              const iOwe = n.net < 0;
              const abs = Math.abs(n.net);
              return (
                <div
                  key={n.currency}
                  className="flex items-center justify-between text-[13px] tabular-nums"
                >
                  <span className="text-muted-foreground">
                    {iOwe
                      ? `You owe ${friend.displayName}`
                      : `${friend.displayName} owes you`}{" "}
                    · {n.currency}
                  </span>
                  <span
                    className={cn(
                      "font-semibold",
                      iOwe
                        ? "text-[var(--brand)]"
                        : "text-[#0d8a2d] dark:text-[#22c55e]"
                    )}
                  >
                    {formatMoney(abs, n.currency)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Shared subs */}
        {friend.sharedSubs.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">
              Shared ({friend.sharedSubs.length})
            </p>
            <ul className="space-y-1">
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
                    <p className="text-[13px] font-medium tabular-nums whitespace-nowrap text-muted-foreground">
                      {formatMoney(s.myShare, s.currency)}
                      <span className="text-muted-foreground/70 font-normal text-xs ml-0.5">
                        /mo
                      </span>
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            No active shared subscriptions.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
