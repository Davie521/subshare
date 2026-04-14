"use client";

import { useEffect, useState } from "react";
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
    <div className="space-y-8 max-w-2xl">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1.5 min-w-0">
          <h1 className="text-[32px] font-bold leading-tight tracking-[-0.022em]">
            Settlement
          </h1>
          <p className="text-[14px] text-muted-foreground max-w-md">
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

      {rows === null ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="border-dashed bg-muted/30 shadow-none">
          <CardContent className="py-14 flex flex-col items-center gap-2.5 text-center">
            <div className="size-9 rounded-full bg-[var(--accent)] flex items-center justify-center">
              <Sparkles className="size-[16px] text-[var(--accent-foreground)]" />
            </div>
            <p className="text-sm font-medium">
              {showingPaid ? "No history yet" : "All settled"}
            </p>
            <p className="text-[13px] text-muted-foreground max-w-[26ch]">
              {showingPaid
                ? "Once you mark balances as settled they'll appear here."
                : "No outstanding balances with anyone. When new bills arrive they'll show up here."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((row) => {
            const key = `${row.counterpartyUserId}-${row.currency}`;
            const netAbs = Math.abs(row.net);
            const iOwe = row.net < 0;
            const even = row.net === 0;
            const settling = settlingKey === key;

            return (
              <li key={key}>
                <Card
                  className={cn(
                    "transition-all",
                    !showingPaid && iOwe &&
                      "ring-[var(--brand)]/25 dark:ring-[var(--brand)]/35",
                    showingPaid && "opacity-95"
                  )}
                >
                  <CardContent className="space-y-4">
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

                    {/* Breakdown */}
                    {!even && (row.owedByMe > 0 || row.owedToMe > 0) && (
                      <div className="rounded-md bg-muted/50 px-3 py-2 text-[12px] text-muted-foreground space-y-0.5 tabular-nums">
                        {row.owedByMe > 0 && (
                          <div className="flex items-center justify-between">
                            <span>You → {row.counterpartyName}</span>
                            <span>{formatMoney(row.owedByMe, row.currency)}</span>
                          </div>
                        )}
                        {row.owedToMe > 0 && (
                          <div className="flex items-center justify-between">
                            <span>
                              {row.counterpartyName} → You
                            </span>
                            <span>{formatMoney(row.owedToMe, row.currency)}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Action — only for Unpaid view */}
                    {!showingPaid && !even && (
                      <div className="flex items-center justify-between">
                        <p className="text-[12px] text-muted-foreground">
                          After you&apos;ve transferred off-app →
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
      className="group shrink-0 flex items-center gap-2.5 cursor-pointer select-none"
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
