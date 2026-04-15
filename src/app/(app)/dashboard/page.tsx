"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, TrendingUp } from "lucide-react";
import { BrandIcon } from "@/components/brand-icon";
import { NotificationsList } from "@/components/notifications-list";
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
    id: number;
    name: string;
    price: number;
    currency: string;
    memberCount: number;
  }>;
};

type SettlementSummaryRow = {
  counterpartyUserId: number;
  counterpartyName: string;
  displayCurrency: string;
  netAmount: number;
  billCount: number;
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
    let cancelled = false;
    Promise.all([api.dashboard(), api.settlement()])
      .then(([d, s]) => {
        if (cancelled) return;
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
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Network error";
        setLoadError(message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  // settlement kept only to power the "To transfer" stat card.

  if (loadError && !data) {
    return (
      <div className="space-y-6 max-w-md">
        <div className="space-y-1.5">
          <h1 className="text-[24px] font-bold tracking-[-0.022em]">
            Couldn&apos;t load dashboard
          </h1>
          <p className="text-sm text-muted-foreground">{loadError}</p>
        </div>
        <Button onClick={() => router.refresh()}>Retry</Button>
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

  // Outgoing count powers the "To transfer" stat card.
  const outgoingPairs = (settlement ?? []).filter((r) => r.netAmount < 0);

  const personalSubs = data.subscriptions.filter((s) => s.memberCount === 1);
  const sharedSubs = data.subscriptions.filter((s) => s.memberCount > 1);
  const sharedSavings = sharedSubs.reduce(
    (acc, s) => acc + (s.price - Math.floor(s.price / s.memberCount)),
    0
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <header>
        <h1 className="text-[32px] font-bold leading-tight tracking-[-0.022em]">
          Dashboard
        </h1>
      </header>

      {/* Stats row */}
      <div className="grid gap-3 md:grid-cols-3">
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
        <Link
          href="/settlement"
          className="rounded-xl transition-transform hover:-translate-y-[1px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40"
        >
          <StatCard
            label="To transfer"
            value={String(outgoingPairs.length)}
            sub={
              outgoingPairs.length === 0
                ? "Nothing owed"
                : outgoingPairs.length === 1
                ? "1 person · tap to settle"
                : `${outgoingPairs.length} people · tap to settle`
            }
            tone={outgoingPairs.length > 0 ? "warn" : "neutral"}
          />
        </Link>
      </div>

      {/* Two-column layout on desktop */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Updates — only unread; mark-read makes them disappear */}
        <section className="space-y-3 lg:col-span-3 min-w-0">
          <SectionHeader title="Updates" />
          <NotificationsList limit={30} maxVisible={5} unreadOnly />
        </section>

        {/* Subscriptions — narrower */}
        <section className="space-y-3 lg:col-span-2">
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
            <div className="-mx-1">
              {personalSubs.slice(0, 4).map((sub) => (
                <SubRow key={`p-${sub.id}`} sub={sub} />
              ))}

              {sharedSubs.length > 0 && personalSubs.length > 0 && (
                <div className="pt-3 pb-1 px-2">
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    Shared
                  </p>
                </div>
              )}

              {sharedSubs.slice(0, 4).map((sub) => (
                <SubRow key={`s-${sub.id}`} sub={sub} shared />
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
    <Card
      size="sm"
      className="relative overflow-hidden md:col-span-1 ring-[var(--brand)]/20 dark:ring-[var(--brand)]/30"
    >
      {/* Subtle brand accent stripe */}
      <div className="absolute inset-y-0 left-0 w-[3px] bg-[var(--brand)]" />
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            This month
          </p>
          <TrendingUp className="size-[14px] text-[var(--brand)]" />
        </div>
        <p className="text-[28px] font-bold tracking-[-0.022em] tabular-nums leading-none">
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
    <Card size="sm">
      <CardContent className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </p>
        <p className="text-[28px] font-bold tracking-[-0.022em] tabular-nums leading-none">
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

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <h2 className="text-[15px] font-semibold tracking-[-0.011em] text-foreground">
        {title}
      </h2>
      {typeof count === "number" && count > 0 && (
        <span className="text-[13px] font-medium text-muted-foreground tabular-nums">
          {count}
        </span>
      )}
    </div>
  );
}

function SubRow({
  sub,
  shared = false,
}: {
  sub: {
    id: number;
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
    <Link
      href={`/subscriptions/${sub.id}`}
      className="group flex items-center gap-3 px-3.5 py-3 rounded-lg border border-transparent transition-colors cursor-pointer hover:bg-foreground/[0.025] hover:border-[rgba(0,0,0,0.06)] dark:hover:bg-white/[0.03] dark:hover:border-white/[0.06]"
    >
      <BrandIcon name={sub.name} size={32} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold truncate leading-tight">
          {sub.name}
        </p>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          {shared ? `${sub.memberCount} members` : "Personal"}
        </p>
      </div>
      <p className="shrink-0 text-[14px] font-semibold tabular-nums whitespace-nowrap">
        {formatMoney(displayPrice, sub.currency)}
        <span className="text-muted-foreground font-normal text-[11px] ml-0.5">
          /mo
        </span>
      </p>
    </Link>
  );
}
