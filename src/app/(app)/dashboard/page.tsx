"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, TrendingUp, Sparkles } from "lucide-react";
import { BrandIcon } from "@/components/brand-icon";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";

type Dashboard = {
  monthlyTotal: number;
  pendingBills: Array<{
    id: number;
    subscriptionName: string;
    amount: number;
    currency: string;
  }>;
  subscriptions: Array<{
    name: string;
    price: number;
    currency: string;
    memberCount: number;
  }>;
};

type SettlementSummaryRow = {
  counterpartyUserId: number;
  counterpartyName: string;
  currency: string;
  owedByMe: number;
  owedToMe: number;
  net: number;
  billIds: number[];
};

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [settlement, setSettlement] = useState<SettlementSummaryRow[] | null>(
    null
  );
  const [loading, setLoading] = useState(true);

  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.dashboard(), api.settlement()]).then(([d, s]) => {
      if (d.status === 401) {
        router.push("/login");
        return;
      }
      if (d.data) {
        setData(d.data);
        setLoadError(null);
      } else {
        setLoadError(d.error || "Failed to load");
      }
      if (s.data) setSettlement(s.data);
      setLoading(false);
    });
  }, [router]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5) return "Still up";
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  if (loadError && !data) {
    return (
      <div className="space-y-6 max-w-md">
        <div className="space-y-1.5">
          <h1 className="text-[24px] font-bold tracking-[-0.022em]">
            Couldn&apos;t load dashboard
          </h1>
          <p className="text-sm text-muted-foreground">{loadError}</p>
        </div>
        <Button onClick={() => window.location.reload()}>Retry</Button>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="space-y-10">
        <div className="space-y-3">
          <div className="h-4 w-36 bg-muted rounded animate-pulse" />
          <div className="h-10 w-64 bg-muted rounded-md animate-pulse" />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="h-36 bg-muted rounded-xl animate-pulse" />
          <div className="h-36 bg-muted rounded-xl animate-pulse" />
          <div className="h-36 bg-muted rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  const outstandingPairs = (settlement ?? []).filter((r) => r.net !== 0);

  const personalSubs = data.subscriptions.filter((s) => s.memberCount === 1);
  const sharedSubs = data.subscriptions.filter((s) => s.memberCount > 1);
  const sharedSavings = sharedSubs.reduce(
    (acc, s) => acc + (s.price - Math.floor(s.price / s.memberCount)),
    0
  );

  return (
    <div className="space-y-10">
      {/* Header */}
      <header className="space-y-1.5">
        <p className="text-[13px] font-medium text-muted-foreground">
          {greeting}
        </p>
        <h1 className="text-[32px] font-bold leading-tight tracking-[-0.022em]">
          Dashboard
        </h1>
      </header>

      {/* Stats row */}
      <div className="grid gap-4 md:grid-cols-3">
        <SpendingCard
          total={data.monthlyTotal}
          savings={sharedSavings}
          subscriptionCount={data.subscriptions.length}
        />
        <StatCard
          label="Subscriptions"
          value={String(data.subscriptions.length)}
          sub={
            sharedSubs.length > 0
              ? `${sharedSubs.length} shared`
              : "No shared yet"
          }
        />
        <StatCard
          label="Settlement"
          value={String(outstandingPairs.length)}
          sub={
            outstandingPairs.length === 0
              ? "All settled"
              : outstandingPairs.length === 1
              ? "1 open balance"
              : `${outstandingPairs.length} open balances`
          }
          tone={outstandingPairs.length > 0 ? "warn" : "neutral"}
        />
      </div>

      {/* Two-column layout on desktop */}
      <div className="grid gap-8 lg:grid-cols-5">
        {/* Settlement — wider */}
        <section className="space-y-4 lg:col-span-3">
          <div className="flex items-center justify-between">
            <SectionHeader title="Settlement" count={outstandingPairs.length} />
            {outstandingPairs.length > 0 && (
              <Link
                href="/settlement"
                className="text-[13px] font-medium text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors cursor-pointer"
              >
                All <ArrowRight className="size-3" />
              </Link>
            )}
          </div>

          {outstandingPairs.length === 0 ? (
            <Card className="border-dashed bg-muted/30 shadow-none">
              <CardContent className="py-12 flex flex-col items-center gap-2.5 text-center">
                <div className="size-9 rounded-full bg-[var(--accent)] flex items-center justify-center">
                  <Sparkles className="size-[16px] text-[var(--accent-foreground)]" />
                </div>
                <p className="text-sm font-medium">All settled</p>
                <p className="text-[13px] text-muted-foreground">
                  No outstanding balances with anyone.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2.5">
              {outstandingPairs.slice(0, 4).map((row) => {
                const key = `${row.counterpartyUserId}-${row.currency}`;
                const iOwe = row.net < 0;
                const netAbs = Math.abs(row.net);
                return (
                  <Link key={key} href="/settlement" className="block group">
                    <Card
                      size="sm"
                      className="transition-all duration-150 group-hover:ring-[rgba(0,0,0,0.14)] dark:group-hover:ring-white/[0.12] dark:group-hover:bg-white/[0.03]"
                    >
                      <CardContent className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className="size-9 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 text-white"
                            style={{
                              backgroundColor: iOwe
                                ? "var(--brand)"
                                : "#1aae39",
                            }}
                            aria-hidden
                          >
                            {row.counterpartyName.trim().charAt(0).toUpperCase() || "?"}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-sm truncate">
                              {row.counterpartyName}
                            </p>
                            <p className="text-[13px] text-muted-foreground">
                              {iOwe ? "You owe" : "They owe you"} · {row.currency}
                            </p>
                          </div>
                        </div>
                        <p className="text-[16px] font-semibold tabular-nums tracking-[-0.015em] shrink-0">
                          {formatMoney(netAbs, row.currency)}
                        </p>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* Subscriptions breakdown — narrower */}
        <section className="space-y-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <SectionHeader
              title="Subscriptions"
              count={data.subscriptions.length}
            />
            <Link
              href="/subscriptions"
              className="text-[13px] font-medium text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors cursor-pointer"
            >
              All <ArrowRight className="size-3" />
            </Link>
          </div>

          {data.subscriptions.length === 0 ? (
            <Card className="border-dashed bg-muted/30 shadow-none">
              <CardContent className="py-12 text-center space-y-1">
                <p className="text-sm font-medium">No subscriptions yet</p>
                <p className="text-[13px] text-muted-foreground">
                  Tap the + to add one.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {personalSubs.slice(0, 4).map((sub) => (
                <SubRow key={`p-${sub.name}`} sub={sub} />
              ))}

              {sharedSubs.length > 0 && personalSubs.length > 0 && (
                <div className="pt-3 pb-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
                    Shared
                  </p>
                </div>
              )}

              {sharedSubs.slice(0, 4).map((sub) => (
                <SubRow key={`s-${sub.name}`} sub={sub} shared />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/* -------------------- local components -------------------- */

function SpendingCard({
  total,
  savings,
  subscriptionCount,
}: {
  total: number;
  savings: number;
  subscriptionCount: number;
}) {
  return (
    <Card className="relative overflow-hidden md:col-span-1 ring-[var(--brand)]/20 dark:ring-[var(--brand)]/30">
      {/* Subtle brand accent stripe */}
      <div className="absolute inset-y-0 left-0 w-[3px] bg-[var(--brand)]" />
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            This month
          </p>
          <TrendingUp className="size-[14px] text-[var(--brand)]" />
        </div>
        <p className="text-[32px] font-bold tracking-[-0.022em] tabular-nums leading-none">
          {formatMoney(total)}
        </p>
        <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          {savings > 0 ? (
            <>
              <span className="inline-flex items-center rounded-full bg-[#1aae39]/10 text-[#1aae39] dark:bg-[#10b981]/15 dark:text-[#10b981] px-1.5 py-[1px] font-semibold text-[10px]">
                −{formatMoney(savings)}
              </span>
              <span>saved by sharing</span>
            </>
          ) : (
            <span>across {subscriptionCount} subscriptions</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "warn";
}) {
  return (
    <Card>
      <CardContent className="space-y-3">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </p>
        <p className="text-[32px] font-bold tracking-[-0.022em] tabular-nums leading-none">
          {value}
        </p>
        <p
          className={
            tone === "warn"
              ? "text-[12px] text-[#dd5b00] dark:text-[#f59e0b]"
              : "text-[12px] text-muted-foreground"
          }
        >
          {sub}
        </p>
      </CardContent>
    </Card>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {title}
      </h2>
      <span className="text-[11px] font-medium text-muted-foreground/60 tabular-nums">
        {count}
      </span>
    </div>
  );
}

function SubRow({
  sub,
  shared = false,
}: {
  sub: {
    name: string;
    price: number;
    currency: string;
    memberCount: number;
  };
  shared?: boolean;
}) {
  const displayPrice = shared
    ? Math.floor(sub.price / sub.memberCount)
    : sub.price;

  return (
    <div className="group flex items-center justify-between gap-3 py-2 px-1 rounded-md transition-colors hover:bg-foreground/[0.025] dark:hover:bg-white/[0.03]">
      <div className="flex items-center gap-2.5 min-w-0">
        <BrandIcon name={sub.name} size={22} />
        <p className="font-medium text-sm truncate">{sub.name}</p>
        {shared && (
          <Badge variant="brand" className="text-[10px] px-1.5">
            {sub.memberCount}
          </Badge>
        )}
      </div>
      <p className="text-sm font-medium tabular-nums whitespace-nowrap">
        {formatMoney(displayPrice, sub.currency)}
        <span className="text-muted-foreground font-normal text-xs ml-0.5">
          /mo
        </span>
      </p>
    </div>
  );
}
