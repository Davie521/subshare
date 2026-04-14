"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Check, History, Sparkles } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";

type SettlementRow = {
  counterpartyUserId: number;
  counterpartyName: string;
  currency: string;
  owedByMe: number;
  owedToMe: number;
  net: number;
  billIds: number[];
};

type View = "unpaid" | "paid";

export default function SettlementPage() {
  const [view, setView] = useState<View>("unpaid");
  const [rows, setRows] = useState<SettlementRow[] | null>(null);
  const [settlingKey, setSettlingKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load(v: View) {
    setRows(null);
    const res = await api.settlement(v);
    if (res.data) {
      setRows(res.data);
      setLoadError(null);
    } else if (res.status === 401) {
      window.location.assign("/login");
    } else {
      setLoadError(res.error || "Failed to load");
    }
  }

  useEffect(() => {
    const t = setTimeout(() => {
      void load(view);
    }, 0);
    return () => clearTimeout(t);
  }, [view]);

  async function onSettle(row: SettlementRow) {
    const key = `${row.counterpartyUserId}-${row.currency}`;
    setSettlingKey(key);
    const res = await api.markPairSettled(row.counterpartyUserId, row.currency);
    setSettlingKey(null);
    if (res.error) return;
    await load(view);
  }

  const totals = useMemo(() => {
    if (!rows) return null;
    const perCurrency = new Map<
      string,
      { owe: number; due: number; pairs: number }
    >();
    for (const r of rows) {
      const entry =
        perCurrency.get(r.currency) ?? { owe: 0, due: 0, pairs: 0 };
      if (r.net < 0) entry.owe += Math.abs(r.net);
      else if (r.net > 0) entry.due += r.net;
      entry.pairs += 1;
      perCurrency.set(r.currency, entry);
    }
    return Array.from(perCurrency.entries()).map(([currency, v]) => ({
      currency,
      ...v,
    }));
  }, [rows]);

  if (loadError && !rows) {
    return (
      <div className="max-w-md space-y-4">
        <h1 className="text-[24px] font-bold tracking-[-0.022em]">
          Couldn&apos;t load settlement
        </h1>
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Button onClick={() => window.location.reload()}>Retry</Button>
      </div>
    );
  }

  const showingPaid = view === "paid";

  return (
    <div className="space-y-10">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1.5 min-w-0">
          <h1 className="text-[32px] font-bold leading-tight tracking-[-0.022em]">
            Settlement
          </h1>
          <p className="text-[14px] text-muted-foreground max-w-xl">
            {showingPaid
              ? "Already-settled history, grouped by person and currency."
              : "One net transfer per person per currency — instead of paying for each subscription separately."}
          </p>
        </div>
        <ToggleSwitch
          on={showingPaid}
          onChange={(v) => setView(v ? "paid" : "unpaid")}
          label="Show paid history"
        />
      </header>

      {/* Summary strip: per-currency totals */}
      {!showingPaid && totals && totals.length > 0 && (
        <div
          className={cn(
            "grid gap-4",
            totals.length === 1
              ? "md:grid-cols-2"
              : "md:grid-cols-2 lg:grid-cols-3"
          )}
        >
          {totals.flatMap((t) => {
            const items: Array<{
              key: string;
              label: string;
              amount: number;
              tone: "owe" | "due";
            }> = [];
            if (t.owe > 0)
              items.push({
                key: `${t.currency}-owe`,
                label: `You owe · ${t.currency}`,
                amount: t.owe,
                tone: "owe",
              });
            if (t.due > 0)
              items.push({
                key: `${t.currency}-due`,
                label: `Owed to you · ${t.currency}`,
                amount: t.due,
                tone: "due",
              });
            return items.map(({ key, label, amount, tone }) => (
              <TotalCard key={key} label={label} amount={amount} tone={tone} />
            ));
          })}
        </div>
      )}

      {rows === null ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-40 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="border-dashed bg-muted/30 shadow-none">
          <CardContent className="py-16 flex flex-col items-center gap-2.5 text-center">
            <div className="size-10 rounded-full bg-[var(--accent)] flex items-center justify-center">
              <Sparkles className="size-[18px] text-[var(--accent-foreground)]" />
            </div>
            <p className="text-sm font-medium">
              {showingPaid ? "No history yet" : "All settled"}
            </p>
            <p className="text-[13px] text-muted-foreground max-w-[28ch]">
              {showingPaid
                ? "Once you mark balances as settled they'll appear here."
                : "No outstanding balances with anyone. New bills will show up here."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((row) => {
            const key = `${row.counterpartyUserId}-${row.currency}`;
            const netAbs = Math.abs(row.net);
            const iOwe = row.net < 0;
            const even = row.net === 0;
            const settling = settlingKey === key;

            return (
              <li key={key} className="h-full">
                <Card
                  className={cn(
                    "h-full transition-all",
                    !showingPaid && iOwe &&
                      "ring-[var(--brand)]/25 dark:ring-[var(--brand)]/35",
                    showingPaid && "opacity-95"
                  )}
                >
                  <CardContent className="h-full flex flex-col gap-4">
                    {/* Headline */}
                    <div className="flex items-start gap-3">
                      <UserAvatar name={row.counterpartyName} size="lg" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold truncate">
                            {row.counterpartyName}
                          </p>
                          {showingPaid && (
                            <Badge
                              variant="secondary"
                              className="text-[10px] gap-1 pl-1 pr-1.5"
                            >
                              <History className="size-2.5" />
                              Settled
                            </Badge>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-baseline gap-1.5">
                          <span className="text-[13px] text-muted-foreground">
                            {even
                              ? "Even — nothing to transfer"
                              : iOwe
                              ? showingPaid
                                ? "You paid"
                                : "You owe"
                              : showingPaid
                              ? "They paid you"
                              : "They owe you"}
                          </span>
                          <Badge
                            variant="secondary"
                            className="text-[10px] tracking-wide"
                          >
                            {row.currency}
                          </Badge>
                        </div>
                      </div>
                      <p
                        className={cn(
                          "text-[22px] font-bold tabular-nums shrink-0 tracking-[-0.018em]",
                          even && "text-muted-foreground",
                          !even &&
                            !showingPaid &&
                            iOwe &&
                            "text-[var(--brand)]",
                          !even &&
                            !showingPaid &&
                            !iOwe &&
                            "text-[#0d8a2d] dark:text-[#22c55e]",
                          !even && showingPaid && "text-muted-foreground"
                        )}
                      >
                        {even ? "—" : formatMoney(netAbs, row.currency)}
                      </p>
                    </div>

                    {/* Breakdown — only when truly bidirectional */}
                    {!even && row.owedByMe > 0 && row.owedToMe > 0 && (
                      <div className="rounded-md bg-muted/50 px-3 py-2 text-[12px] text-muted-foreground space-y-0.5 tabular-nums">
                        <div className="flex items-center justify-between">
                          <span>You → {row.counterpartyName}</span>
                          <span>{formatMoney(row.owedByMe, row.currency)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>{row.counterpartyName} → You</span>
                          <span>{formatMoney(row.owedToMe, row.currency)}</span>
                        </div>
                      </div>
                    )}

                    {/* Action pushed to bottom */}
                    {!showingPaid && !even && (
                      <div className="mt-auto flex items-center justify-between gap-3 pt-1">
                        <p className="text-[12px] text-muted-foreground">
                          After transferring off-app →
                        </p>
                        <Button
                          size="sm"
                          variant={iOwe ? "default" : "outline"}
                          disabled={settling}
                          onClick={() => onSettle(row)}
                          className="cursor-pointer gap-1.5"
                        >
                          {settling ? (
                            "Settling…"
                          ) : (
                            <>
                              <Check className="size-3.5" />
                              Mark settled
                            </>
                          )}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {!showingPaid && rows && rows.length > 0 && (
        <Card className="border-dashed bg-muted/30 shadow-none">
          <CardContent className="py-4 text-[12px] text-muted-foreground flex items-start gap-2">
            <ArrowRight className="size-3.5 mt-0.5 shrink-0" />
            <p>
              SubShare doesn&apos;t move money — transfer through your usual
              channel (bank, WeChat, Venmo…) then tap &ldquo;Mark settled&rdquo;
              to clear the balance.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TotalCard({
  label,
  amount,
  tone,
}: {
  label: string;
  amount: number;
  tone: "owe" | "due";
}) {
  const currency = label.split("·")[1]?.trim() ?? "";
  return (
    <Card
      className={cn(
        "relative overflow-hidden",
        tone === "owe" && "ring-[var(--brand)]/25 dark:ring-[var(--brand)]/35"
      )}
    >
      <div
        className={cn(
          "absolute inset-y-0 left-0 w-[3px]",
          tone === "owe"
            ? "bg-[var(--brand)]"
            : "bg-[#1aae39] dark:bg-[#10b981]"
        )}
      />
      <CardContent className="space-y-2">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </p>
        <p
          className={cn(
            "text-[28px] font-bold tracking-[-0.022em] tabular-nums leading-none",
            tone === "owe"
              ? "text-[var(--brand)]"
              : "text-[#0d8a2d] dark:text-[#22c55e]"
          )}
        >
          {formatMoney(amount, currency)}
        </p>
      </CardContent>
    </Card>
  );
}

function ToggleSwitch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="group shrink-0 flex items-center gap-2.5 cursor-pointer select-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span
        className={cn(
          "text-[12px] font-medium transition-colors whitespace-nowrap",
          on ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "relative inline-flex h-[22px] w-[38px] items-center rounded-full transition-colors",
          on
            ? "bg-[var(--brand)]"
            : "bg-muted border border-border group-hover:bg-muted/70"
        )}
      >
        <span
          className={cn(
            "inline-block size-[16px] transform rounded-full bg-background shadow-sm transition-transform",
            on ? "translate-x-[19px]" : "translate-x-[3px]"
          )}
        />
      </span>
    </button>
  );
}
