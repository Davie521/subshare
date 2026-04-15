"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, Sparkles, Clock } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { BrandIcon } from "@/components/brand-icon";

type SettlementBill = {
  id: number;
  subscriptionId: number;
  subscriptionName: string;
  billingDate: string;
  convertedAmount: number;
  direction: "outgoing" | "incoming";
};

type SettlementRow = {
  counterpartyUserId: number;
  counterpartyName: string;
  displayCurrency: string;
  netAmount: number;
  billCount: number;
  bills: SettlementBill[];
};

type Direction = "owe" | "owed";

/* ---------- date helpers ---------- */

function todayLocal(): Date {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}

function parseISODate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysSince(billingDate: string): number {
  return Math.floor(
    (todayLocal().getTime() - parseISODate(billingDate).getTime()) /
      86_400_000
  );
}

function formatBillingDate(iso: string): string {
  const d = parseISODate(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ======================== PAGE ======================== */

export default function SettlementPage() {
  const [direction, setDirection] = useState<Direction>("owe");
  const [rows, setRows] = useState<SettlementRow[] | null>(null);
  const [settlingId, setSettlingId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.settlement();
    if (res.data) {
      setRows(res.data);
      setLoadError(null);
    } else if (res.status === 401) {
      window.location.assign("/login");
    } else {
      setLoadError(res.error || "Failed to load");
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const oweRows = useMemo(
    () => (rows ? rows.filter((r) => r.netAmount < 0) : []),
    [rows]
  );
  const owedRows = useMemo(
    () => (rows ? rows.filter((r) => r.netAmount > 0) : []),
    [rows]
  );

  const activeRows = direction === "owe" ? oweRows : owedRows;

  async function onSettlePerson(row: SettlementRow) {
    setSettlingId(row.counterpartyUserId);
    const res = await api.markPairSettled(row.counterpartyUserId);
    setSettlingId(null);
    if (!res.error) await load();
  }

  if (loadError && !rows) {
    return (
      <div className="max-w-md space-y-4">
        <h1 className="text-[24px] font-bold tracking-[-0.022em]">
          Couldn&apos;t load settlement
        </h1>
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Button onClick={() => load()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="space-y-1.5">
        <h1 className="text-[32px] font-bold leading-tight tracking-[-0.022em]">
          Settlement
        </h1>
        <p className="text-[14px] text-muted-foreground max-w-xl">
          Who needs to transfer what. One number per person — netted across
          subscriptions and currencies.
        </p>
      </header>

      <Tabs
        direction={direction}
        oweCount={oweRows.length}
        owedCount={owedRows.length}
        onChange={setDirection}
      />

      {rows === null ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="h-40 bg-muted/40 rounded-xl animate-pulse"
            />
          ))}
        </div>
      ) : activeRows.length === 0 ? (
        <EmptyState direction={direction} />
      ) : (
        <ul className="space-y-4">
          {activeRows.map((row) => (
            <li key={row.counterpartyUserId}>
              <PersonCard
                row={row}
                direction={direction}
                settling={settlingId === row.counterpartyUserId}
                onSettle={onSettlePerson}
              />
            </li>
          ))}
        </ul>
      )}

      {rows && rows.length > 0 && (
        <p className="text-[12px] text-muted-foreground max-w-xl leading-relaxed">
          SubShare doesn&apos;t move money — transfer through your usual
          channel (bank, WeChat, Venmo…) then tap &ldquo;Mark settled&rdquo;
          to clear the balance.
        </p>
      )}
    </div>
  );
}

/* ======================== Tabs ======================== */

function Tabs({
  direction,
  oweCount,
  owedCount,
  onChange,
}: {
  direction: Direction;
  oweCount: number;
  owedCount: number;
  onChange: (d: Direction) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Settlement direction"
      className="inline-flex items-center gap-1 rounded-lg bg-muted/40 p-1 border border-border"
    >
      <TabButton
        active={direction === "owe"}
        count={oweCount}
        onClick={() => onChange("owe")}
        label="You owe"
      />
      <TabButton
        active={direction === "owed"}
        count={owedCount}
        onClick={() => onChange("owed")}
        label="Owed to you"
      />
    </div>
  );
}

function TabButton({
  active,
  count,
  onClick,
  label,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "group inline-flex items-center gap-2 px-3 h-8 rounded-md text-[13px] font-medium transition-all cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40",
        active
          ? "bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-none dark:bg-white/[0.06]"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
      <span
        className={cn(
          "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold tabular-nums transition-colors",
          active
            ? "bg-[var(--brand)]/12 text-[var(--brand)] dark:bg-[var(--brand)]/18 dark:text-[var(--brand-accent)]"
            : "bg-foreground/[0.06] text-muted-foreground"
        )}
      >
        {count}
      </span>
    </button>
  );
}

/* ======================== Empty state ======================== */

function EmptyState({ direction }: { direction: Direction }) {
  return (
    <Card className="border-dashed bg-muted/30 shadow-none">
      <CardContent className="py-16 flex flex-col items-center gap-2.5 text-center">
        <div className="size-10 rounded-full bg-[var(--accent)] flex items-center justify-center">
          <Sparkles className="size-[18px] text-[var(--accent-foreground)]" />
        </div>
        <p className="text-sm font-medium">All clear</p>
        <p className="text-[13px] text-muted-foreground max-w-[32ch]">
          {direction === "owe"
            ? "You don't owe anyone right now. New bills will show up here."
            : "No one owes you right now. New bills will show up here."}
        </p>
      </CardContent>
    </Card>
  );
}

/* ======================== Person card ======================== */

function PersonCard({
  row,
  direction,
  settling,
  onSettle,
}: {
  row: SettlementRow;
  direction: Direction;
  settling: boolean;
  onSettle: (row: SettlementRow) => Promise<void>;
}) {
  const total = Math.abs(row.netAmount);
  const hasOverdue = row.bills.some((b) => daysSince(b.billingDate) >= 0);

  return (
    <Card
      className={cn(
        "overflow-hidden transition-shadow",
        hasOverdue &&
          "ring-1 ring-[var(--brand)]/20 dark:ring-[var(--brand)]/30"
      )}
    >
      <CardContent className="p-0">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <UserAvatar name={row.counterpartyName} size="lg" />
            <div className="min-w-0">
              <p className="text-[15px] font-semibold truncate">
                {row.counterpartyName}
              </p>
              <p className="text-[12px] text-muted-foreground">
                {direction === "owe" ? "You owe" : "Owes you"} · {row.billCount}{" "}
                {row.billCount === 1 ? "bill" : "bills"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <p className="text-[20px] font-bold tabular-nums tracking-[-0.012em] leading-tight">
              {formatMoney(total, row.displayCurrency)}
            </p>
            <Button
              size="sm"
              variant={direction === "owe" ? "default" : "outline"}
              disabled={settling}
              onClick={() => onSettle(row)}
              className="cursor-pointer gap-1.5"
            >
              {settling ? (
                "Settling…"
              ) : (
                <>
                  <Check className="size-3.5" />
                  {direction === "owe" ? "Mark settled" : "Mark received"}
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Per-bill breakdown */}
        <ul className="divide-y divide-border/60">
          {row.bills.map((b) => (
            <BillRow
              key={b.id}
              bill={b}
              displayCurrency={row.displayCurrency}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/* ======================== Bill row ======================== */

function BillRow({
  bill,
  displayCurrency,
}: {
  bill: SettlementBill;
  displayCurrency: string;
}) {
  const d = daysSince(bill.billingDate);
  const overdue = d >= 0;
  const label =
    d <= 0 ? "Due today" : d === 1 ? "Overdue 1 day" : `Overdue ${d} days`;
  const isOutgoing = bill.direction === "outgoing";

  return (
    <li
      className={cn(
        "flex items-center gap-3 py-2.5 px-5 transition-colors",
        overdue
          ? "bg-[var(--brand)]/[0.04] dark:bg-[var(--brand)]/[0.08]"
          : "hover:bg-foreground/[0.02] dark:hover:bg-white/[0.02]"
      )}
    >
      <BrandIcon name={bill.subscriptionName} size={20} />
      <div className="flex-1 min-w-0 flex items-baseline gap-2">
        <p className="text-[13px] font-medium truncate">
          {bill.subscriptionName}
        </p>
        <p className="text-[11px] text-muted-foreground whitespace-nowrap">
          {formatBillingDate(bill.billingDate)}
        </p>
      </div>
      {overdue && (
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.04em] px-1.5 h-[18px] rounded-full",
            "bg-[var(--brand)]/12 text-[var(--brand)] dark:bg-[var(--brand)]/18 dark:text-[var(--brand-accent)]"
          )}
        >
          <Clock className="size-2.5" />
          {label}
        </span>
      )}
      <p
        className={cn(
          "text-[13px] font-semibold tabular-nums whitespace-nowrap",
          isOutgoing ? "text-foreground" : "text-foreground"
        )}
      >
        {isOutgoing ? "−" : "+"}
        {formatMoney(bill.convertedAmount, displayCurrency)}
      </p>
    </li>
  );
}
