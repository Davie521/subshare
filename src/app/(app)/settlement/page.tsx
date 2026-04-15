"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [view, setView] = useState<View>("unpaid");
  const [rows, setRows] = useState<SettlementRow[] | null>(null);
  const [me, setMe] = useState<string>("You");
  const [settlingKey, setSettlingKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settleError, setSettleError] = useState<string | null>(null);

  const load = useCallback(async (v: View) => {
    setRows(null);
    try {
      const res = await api.settlement(v);
      if (res.data) {
        setRows(res.data);
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
    void api.me().then((r) => {
      if (r.data) setMe(r.data.displayName || r.data.name || "You");
    });
  }, []);

  useEffect(() => {
    // load is async; setState calls happen in later microtasks.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(view);
  }, [view, load]);

  async function onSettle(row: SettlementRow) {
    const key = `${row.counterpartyUserId}-${row.currency}`;
    setSettlingKey(key);
    setSettleError(null);
    const res = await api.markPairSettled(row.counterpartyUserId, row.currency);
    setSettlingKey(null);
    if (res.error) {
      setSettleError(res.error);
      return;
    }
    await load(view);
  }

  const totals = useMemo(() => {
    if (!rows) return null;
    const perCurrency = new Map<string, { owe: number; due: number }>();
    for (const r of rows) {
      const e = perCurrency.get(r.currency) ?? { owe: 0, due: 0 };
      if (r.net < 0) e.owe += Math.abs(r.net);
      else if (r.net > 0) e.due += r.net;
      perCurrency.set(r.currency, e);
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
        <Button onClick={() => void load(view)}>Retry</Button>
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

      {settleError && (
        <p className="text-[13px] font-medium text-destructive">{settleError}</p>
      )}

      {/* Summary totals */}
      {!showingPaid && totals && totals.length > 0 && (
        <div
          className={cn(
            "grid gap-4",
            totals.length === 1 ? "md:grid-cols-2" : "md:grid-cols-2 lg:grid-cols-3"
          )}
        >
          {totals.flatMap((t) => {
            const items: React.ReactNode[] = [];
            if (t.owe > 0)
              items.push(
                <TotalCard
                  key={`${t.currency}-owe`}
                  label={`You owe · ${t.currency}`}
                  amount={t.owe}
                  currency={t.currency}
                  tone="owe"
                />
              );
            if (t.due > 0)
              items.push(
                <TotalCard
                  key={`${t.currency}-due`}
                  label={`Owed to you · ${t.currency}`}
                  amount={t.due}
                  currency={t.currency}
                  tone="due"
                />
              );
            return items;
          })}
        </div>
      )}

      {rows === null ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />
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
            <p className="text-[13px] text-muted-foreground max-w-[30ch]">
              {showingPaid
                ? "Once you mark balances as settled they'll appear here."
                : "No outstanding balances with anyone. New bills will show up here."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={`${row.counterpartyUserId}-${row.currency}`}>
              <FlowRow
                row={row}
                meName={me}
                showingPaid={showingPaid}
                settling={
                  settlingKey === `${row.counterpartyUserId}-${row.currency}`
                }
                onSettle={() => onSettle(row)}
              />
            </li>
          ))}
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

/* ---------------- Flow row (single-pair, single-row) ---------------- */

function FlowRow({
  row,
  meName,
  showingPaid,
  settling,
  onSettle,
}: {
  row: SettlementRow;
  meName: string;
  showingPaid: boolean;
  settling: boolean;
  onSettle: () => void;
}) {
  const iOwe = row.net < 0;
  const even = row.net === 0;
  const netAbs = Math.abs(row.net);
  const hasBothSides = row.owedByMe > 0 && row.owedToMe > 0;

  // Visual direction: source → destination (money flow)
  const source = iOwe
    ? { name: meName, label: "You" }
    : { name: row.counterpartyName, label: row.counterpartyName };
  const dest = iOwe
    ? { name: row.counterpartyName, label: row.counterpartyName }
    : { name: meName, label: "You" };

  return (
    <Card
      className={cn(
        "transition-all overflow-hidden",
        !showingPaid && iOwe &&
          "ring-[var(--brand)]/25 dark:ring-[var(--brand)]/35",
        showingPaid && "opacity-95"
      )}
    >
      <CardContent className="p-0">
        <div className="flex items-center gap-4 md:gap-6 px-4 md:px-6 py-5">
          {/* LEFT — source */}
          <div className="flex flex-col items-center gap-1.5 shrink-0 w-[72px]">
            <UserAvatar
              name={source.name}
              size="lg"
              tone={!showingPaid && iOwe ? "brand" : "neutral"}
            />
            <p className="text-[12px] font-medium truncate max-w-full text-center">
              {source.label}
            </p>
          </div>

          {/* CENTER — flow */}
          <div className="flex-1 min-w-0 flex flex-col items-center">
            {even ? (
              <>
                <div className="flex items-center gap-2 w-full">
                  <DashedLine />
                  <p className="text-[13px] font-medium text-muted-foreground whitespace-nowrap">
                    Even
                  </p>
                  <DashedLine />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Nothing to transfer
                </p>
              </>
            ) : (
              <>
                <p
                  className={cn(
                    "text-[26px] md:text-[30px] font-bold tabular-nums tracking-[-0.018em] leading-none",
                    !showingPaid && iOwe && "text-[var(--brand)]",
                    !showingPaid && !iOwe &&
                      "text-[#0d8a2d] dark:text-[#22c55e]",
                    showingPaid && "text-muted-foreground"
                  )}
                >
                  {formatMoney(netAbs, row.currency)}
                </p>
                <FlowArrow
                  tone={
                    showingPaid
                      ? "muted"
                      : iOwe
                      ? "brand"
                      : "green"
                  }
                />
                <div className="flex items-center gap-1.5 mt-1">
                  <Badge
                    variant="secondary"
                    className="text-[10px] tracking-wide"
                  >
                    {row.currency}
                  </Badge>
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
              </>
            )}
          </div>

          {/* RIGHT — destination */}
          <div className="flex flex-col items-center gap-1.5 shrink-0 w-[72px]">
            <UserAvatar
              name={dest.name}
              size="lg"
              tone={!showingPaid && !iOwe && !even ? "brand" : "neutral"}
            />
            <p className="text-[12px] font-medium truncate max-w-full text-center">
              {dest.label}
            </p>
          </div>

          {/* ACTION */}
          {!showingPaid && !even && (
            <div className="shrink-0 hidden sm:block">
              <Button
                size="sm"
                variant={iOwe ? "default" : "outline"}
                disabled={settling}
                onClick={onSettle}
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
        </div>

        {/* Mobile action bar (stacks under flow on small screens) */}
        {!showingPaid && !even && (
          <div className="sm:hidden border-t bg-muted/20 px-4 py-2.5 flex items-center justify-between">
            <p className="text-[12px] text-muted-foreground">
              After transferring off-app
            </p>
            <Button
              size="sm"
              variant={iOwe ? "default" : "outline"}
              disabled={settling}
              onClick={onSettle}
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

        {/* Bidirectional breakdown — small, subtle strip */}
        {!even && hasBothSides && (
          <div className="border-t bg-muted/20 px-4 md:px-6 py-2 flex items-center justify-center gap-4 md:gap-6 text-[11px] text-muted-foreground tabular-nums flex-wrap">
            <span>
              You → {row.counterpartyName}:{" "}
              <span className="text-foreground font-medium">
                {formatMoney(row.owedByMe, row.currency)}
              </span>
            </span>
            <span className="text-muted-foreground/50">·</span>
            <span>
              {row.counterpartyName} → You:{" "}
              <span className="text-foreground font-medium">
                {formatMoney(row.owedToMe, row.currency)}
              </span>
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DashedLine() {
  return (
    <div
      aria-hidden
      className="flex-1 h-0 border-t-2 border-dashed border-border"
    />
  );
}

function FlowArrow({ tone }: { tone: "brand" | "green" | "muted" }) {
  const stroke =
    tone === "brand"
      ? "var(--brand)"
      : tone === "green"
      ? "currentColor"
      : "currentColor";
  const color =
    tone === "green"
      ? "text-[#0d8a2d] dark:text-[#22c55e]"
      : tone === "muted"
      ? "text-muted-foreground/50"
      : "text-[var(--brand)]";
  return (
    <svg
      aria-hidden
      viewBox="0 0 200 14"
      className={cn("w-full max-w-[220px] mt-2", color)}
      preserveAspectRatio="none"
    >
      <line
        x1="0"
        y1="7"
        x2="188"
        y2="7"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <polyline
        points="182,2 192,7 182,12"
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TotalCard({
  label,
  amount,
  currency,
  tone,
}: {
  label: string;
  amount: number;
  currency: string;
  tone: "owe" | "due";
}) {
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
