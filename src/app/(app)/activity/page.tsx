"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { NotificationsList } from "@/components/notifications-list";

type SettlementRow = {
  counterpartyUserId: number;
  counterpartyName: string;
  currency: string;
  owedByMe: number;
  owedToMe: number;
  net: number;
  billIds: number[];
};

export default function ActivityPage() {
  const [settlement, setSettlement] = useState<SettlementRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api.settlement().then((res) => {
      if (res.data) {
        setSettlement(res.data);
        setLoadError(null);
      } else if (res.status === 401) {
        window.location.assign("/login");
      } else {
        setLoadError(res.error || "Failed to load");
      }
    });
  }, []);

  if (loadError && !settlement) {
    return (
      <div className="max-w-md space-y-4">
        <h1 className="text-[24px] font-bold tracking-[-0.022em]">
          Couldn&apos;t load activity
        </h1>
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Button onClick={() => window.location.reload()}>Retry</Button>
      </div>
    );
  }

  const outgoing = (settlement ?? []).filter((r) => r.net < 0);
  const incoming = (settlement ?? []).filter((r) => r.net > 0);

  return (
    <div className="space-y-10 max-w-2xl">
      <header className="space-y-1.5">
        <h1 className="text-[32px] font-bold leading-tight tracking-[-0.022em]">
          Activity
        </h1>
        <p className="text-[14px] text-muted-foreground">
          Everything happening across your subscriptions — money moving,
          people joining, prices changing.
        </p>
      </header>

      {/* Category 1: Action needed */}
      <section className="space-y-4">
        <CategoryHeader
          label="Action needed"
          count={outgoing.length}
          hint="Money you need to transfer"
        />
        {settlement === null ? (
          <SkeletonRows />
        ) : outgoing.length === 0 ? (
          <EmptyHint text="You don't owe anyone right now." />
        ) : (
          <PairList
            rows={outgoing}
            direction="owing"
            linkHref="/settlement"
          />
        )}
      </section>

      {/* Category 2: Incoming */}
      <section className="space-y-4">
        <CategoryHeader
          label="Incoming"
          count={incoming.length}
          hint="Money others owe you"
        />
        {settlement === null ? (
          <SkeletonRows />
        ) : incoming.length === 0 ? (
          <EmptyHint text="No one owes you right now." />
        ) : (
          <PairList
            rows={incoming}
            direction="owedToMe"
            linkHref="/settlement"
          />
        )}
      </section>

      {/* Category 3: Updates */}
      <section className="space-y-4">
        <CategoryHeader label="Updates" hint="Recent events" />
        <NotificationsList limit={50} showMarkAll />
      </section>
    </div>
  );
}

function CategoryHeader({
  label,
  count,
  hint,
}: {
  label: string;
  count?: number;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {label}
        </h2>
        {typeof count === "number" && count > 0 && (
          <span className="text-[11px] font-medium text-muted-foreground/60 tabular-nums">
            {count}
          </span>
        )}
      </div>
      {hint && (
        <p className="text-[12px] text-muted-foreground/80">{hint}</p>
      )}
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />
      ))}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <Card className="border-dashed bg-muted/30 shadow-none">
      <CardContent className="py-8 flex flex-col items-center gap-2 text-center">
        <div className="size-8 rounded-full bg-[var(--accent)] flex items-center justify-center">
          <Sparkles className="size-[14px] text-[var(--accent-foreground)]" />
        </div>
        <p className="text-[13px] text-muted-foreground">{text}</p>
      </CardContent>
    </Card>
  );
}

function PairList({
  rows,
  direction,
  linkHref,
}: {
  rows: SettlementRow[];
  direction: "owing" | "owedToMe";
  linkHref: string;
}) {
  return (
    <div className="space-y-2.5">
      {rows.map((row) => {
        const key = `${row.counterpartyUserId}-${row.currency}`;
        const netAbs = Math.abs(row.net);
        const iOwe = direction === "owing";
        return (
          <Link key={key} href={linkHref} className="block group">
            <Card
              size="sm"
              className="transition-all duration-150 group-hover:ring-[rgba(0,0,0,0.14)] dark:group-hover:ring-white/[0.12] dark:group-hover:bg-white/[0.03]"
            >
              <CardContent className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <UserAvatar name={row.counterpartyName} size="md" />
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">
                      {row.counterpartyName}
                    </p>
                    <p className="text-[13px] text-muted-foreground">
                      {iOwe ? "You owe" : "They owe you"} · {row.currency}
                    </p>
                  </div>
                </div>
                <p
                  className={cn(
                    "text-[16px] font-semibold tabular-nums tracking-[-0.015em] shrink-0",
                    iOwe
                      ? "text-[var(--brand)]"
                      : "text-[#0d8a2d] dark:text-[#22c55e]"
                  )}
                >
                  {formatMoney(netAbs, row.currency)}
                </p>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
