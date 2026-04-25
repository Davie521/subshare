"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, Sparkles, Clock } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { todayInAppTz } from "@/lib/date-utils";
import {
  daysBetweenISO,
  formatBillingRange,
  groupBillsBySubscription,
  isPending,
  splitBillsByPending,
  type SubGroup,
} from "@/lib/settlement-display";
import { UserAvatar } from "@/components/user-avatar";
import { BrandIcon } from "@/components/brand-icon";

type SettlementBill = {
  id: number;
  subscriptionId: number;
  subscriptionName: string;
  subscriptionLogo: string | null;
  billingDate: string;
  convertedAmount: number;
  direction: "outgoing" | "incoming";
  fxIncomplete?: boolean;
};

type SettlementRow = {
  counterpartyUserId: number;
  counterpartyName: string;
  displayCurrency: string;
  netAmount: number;
  billCount: number;
  bills: SettlementBill[];
  fxIncomplete?: boolean;
};

type Direction = "owe" | "owed";

/**
 * Per-counterparty derived view for rendering. Wraps the raw row with
 * the toggle-aware net + bill count + grouped sub rows + ID scope used
 * by the Settle button.
 */
type DecoratedRow = {
  row: SettlementRow;
  /** Signed net across `displayed` bills only. Negative = you owe. */
  displayedNet: number;
  displayedBillCount: number;
  groups: Array<SubGroup & { isAllPending: boolean }>;
  /** IDs of currently-active bills — passed to settle when toggle OFF. */
  activeBillIds: number[];
  /** How many pending bills the toggle is hiding for this counterparty. */
  pendingHidden: number;
};

/* ---------- date helpers ----------
 *
 * `today` is resolved via `todayInAppTz()` so it agrees with the server's
 * billing_date, which is always written in APP_TIMEZONE. Previously the
 * page used `new Date()` in browser-local TZ and drifted by a day for
 * users west of UTC.
 */

function daysSince(billingDate: string, today: string): number {
  return daysBetweenISO(billingDate, today);
}

/* ======================== PAGE ======================== */

export default function SettlementPage() {
  const router = useRouter();
  const [direction, setDirection] = useState<Direction>("owe");
  const [rows, setRows] = useState<SettlementRow[] | null>(null);
  const [settlingId, setSettlingId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settleError, setSettleError] = useState<string | null>(null);
  // Phase 3 — when OFF (default), bills with billing_date strictly in the
  // future are hidden from settle / counts / cards. Toggle ON merges them
  // back in with a muted visual treatment + Upcoming pill.
  const [showUpcoming, setShowUpcoming] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.settlement();
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
    // load is async; state updates happen in later microtasks.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Resolved once per render — today in the app's reference timezone, so
  // overdue math agrees with the server-written billing_date values.
  // useMemo so children receive a stable reference while the page lives.
  const today = useMemo(() => todayInAppTz(), []);

  // Per-counterparty filtered + decorated view. Recomputed when the
  // toggle flips. Net / billCount / groups all reflect ONLY the bills
  // we're about to render; the original row is kept for downstream
  // identity (counterparty IDs, names, displayCurrency).
  const decoratedRows = useMemo<DecoratedRow[]>(() => {
    if (!rows) return [];
    const out: DecoratedRow[] = [];
    for (const row of rows) {
      const { active, pending } = splitBillsByPending(row.bills, today);
      const displayed = showUpcoming ? row.bills : active;
      if (displayed.length === 0) continue;

      const displayedNet = displayed.reduce(
        (sum, b) =>
          sum + (b.direction === "outgoing" ? -b.convertedAmount : b.convertedAmount),
        0
      );
      // Hide rows that net to zero on the displayed slice unless something
      // hints there's still something to track (FX missing on at least one
      // bill, so the netAmount isn't trustworthy).
      const anyFxIncomplete =
        row.fxIncomplete || displayed.some((b) => b.fxIncomplete);
      if (displayedNet === 0 && !anyFxIncomplete) continue;

      const groups = groupBillsBySubscription(displayed).map((g) => ({
        ...g,
        isAllPending: g.bills.every((b) => isPending(b.billingDate, today)),
      }));

      out.push({
        row,
        displayedNet,
        displayedBillCount: displayed.length,
        groups,
        activeBillIds: active.map((b) => b.id),
        // Only "hidden" when the toggle is actually hiding them. With
        // the toggle ON they're rendered into the merged group, so the
        // count of "hidden" is zero by construction.
        pendingHidden: showUpcoming ? 0 : pending.length,
      });
    }
    return out;
  }, [rows, today, showUpcoming]);

  const oweRows = useMemo(
    () => decoratedRows.filter((d) => d.displayedNet < 0),
    [decoratedRows]
  );
  const owedRows = useMemo(
    () => decoratedRows.filter((d) => d.displayedNet > 0),
    [decoratedRows]
  );

  const activeRows = direction === "owe" ? oweRows : owedRows;

  // Total pending bills hidden across the OPPOSITE-of-current-direction
  // tab too — drives the "+N upcoming" hint, so the user knows there's
  // something to flip the toggle for.
  const totalPendingHidden = useMemo(
    () =>
      showUpcoming
        ? 0
        : decoratedRows.reduce((sum, d) => sum + d.pendingHidden, 0),
    [decoratedRows, showUpcoming]
  );

  async function onSettlePerson(d: DecoratedRow) {
    setSettlingId(d.row.counterpartyUserId);
    setSettleError(null);
    // Toggle OFF → scope settle to currently-visible (active) bill IDs so
    // future bills the user can't see don't get silently swept up.
    // Toggle ON → omit the scope, settle the whole bucket as before.
    const billIds = showUpcoming ? undefined : d.activeBillIds;
    const res = await api.markPairSettled(d.row.counterpartyUserId, billIds);
    setSettlingId(null);
    if (res.error) {
      setSettleError(res.error);
      return;
    }
    await load();
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
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-[32px] font-bold leading-tight tracking-[-0.022em]">
            Settlement
          </h1>
          <p className="text-[14px] text-muted-foreground max-w-xl">
            Who needs to transfer what. One number per person — netted across
            subscriptions and currencies.
          </p>
        </div>
        <UpcomingToggle
          checked={showUpcoming}
          onChange={setShowUpcoming}
          hiddenCount={totalPendingHidden}
        />
      </header>

      <Tabs
        direction={direction}
        oweCount={oweRows.length}
        owedCount={owedRows.length}
        onChange={setDirection}
      />

      {settleError && (
        <p className="text-[13px] font-medium text-destructive">{settleError}</p>
      )}

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
        <EmptyState
          direction={direction}
          hiddenCount={totalPendingHidden}
          onShowUpcoming={() => setShowUpcoming(true)}
        />
      ) : (
        <ul className="space-y-4">
          {activeRows.map((d) => (
            <li key={d.row.counterpartyUserId}>
              <PersonCard
                decorated={d}
                direction={direction}
                settling={settlingId === d.row.counterpartyUserId}
                onSettle={onSettlePerson}
                today={today}
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

/* ======================== Upcoming toggle ======================== */

/**
 * Tiny inline switch for the "Show upcoming" control. Custom-built to
 * avoid pulling in a Radix dep just for this one toggle. Keyboard-
 * accessible (role=switch, Space/Enter), with `aria-checked` mirroring
 * state.
 */
function UpcomingToggle({
  checked,
  onChange,
  hiddenCount,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  hiddenCount: number;
}) {
  return (
    <div className="flex items-center gap-2.5 sm:shrink-0">
      <div className="flex flex-col items-end leading-tight">
        <span className="text-[13px] font-medium">Show upcoming</span>
        {!checked && hiddenCount > 0 && (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {hiddenCount} hidden
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label="Show upcoming bills"
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40",
          checked
            ? "bg-[var(--brand)] dark:bg-[var(--brand-accent)]"
            : "bg-foreground/15 dark:bg-white/15"
        )}
      >
        <span
          className={cn(
            "inline-block size-[18px] rounded-full bg-background shadow transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          )}
        />
      </button>
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
        "group inline-flex items-center gap-2 px-3 h-11 md:h-8 rounded-md text-[13px] font-medium transition-all cursor-pointer",
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

function EmptyState({
  direction,
  hiddenCount,
  onShowUpcoming,
}: {
  direction: Direction;
  hiddenCount: number;
  onShowUpcoming: () => void;
}) {
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
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={onShowUpcoming}
            className="mt-2 text-[12px] font-medium text-[var(--brand)] hover:underline cursor-pointer"
          >
            {hiddenCount === 1
              ? "1 upcoming bill hidden — show it"
              : `${hiddenCount} upcoming bills hidden — show them`}
          </button>
        )}
      </CardContent>
    </Card>
  );
}

/* ======================== Person card ======================== */

function PersonCard({
  decorated,
  direction,
  settling,
  onSettle,
  today,
}: {
  decorated: DecoratedRow;
  direction: Direction;
  settling: boolean;
  onSettle: (d: DecoratedRow) => Promise<void>;
  today: string;
}) {
  const { row, displayedNet, displayedBillCount, groups, pendingHidden } =
    decorated;
  const total = Math.abs(displayedNet);
  // Overdue ring fires only on groups with at least one past-or-today
  // bill — pending-only groups (toggle ON) shouldn't light the card.
  const hasOverdue = groups.some(
    (g) => !g.isAllPending && daysSince(g.rangeStart, today) >= 0
  );

  return (
    <Card
      className={cn(
        "overflow-hidden transition-shadow",
        hasOverdue &&
          "ring-1 ring-[var(--brand)]/20 dark:ring-[var(--brand)]/30"
      )}
    >
      <CardContent className="p-0">
        {/* Header — reflows on mobile so the action button drops below */}
        <div className="flex flex-col gap-3 px-5 py-4 border-b border-border sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <UserAvatar name={row.counterpartyName} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold truncate">
                {row.counterpartyName}
              </p>
              <p className="text-[12px] text-muted-foreground">
                {direction === "owe" ? "You owe" : "Owes you"} ·{" "}
                {displayedBillCount}{" "}
                {displayedBillCount === 1 ? "bill" : "bills"}
                {pendingHidden > 0 && (
                  <span className="text-muted-foreground/70">
                    {" "}
                    · {pendingHidden} upcoming hidden
                  </span>
                )}
              </p>
            </div>
            <div className="shrink-0 sm:hidden flex flex-col items-end">
              <p className="text-[20px] font-bold tabular-nums tracking-[-0.012em] leading-tight">
                {formatMoney(total, row.displayCurrency)}
              </p>
              {row.fxIncomplete && (
                <p
                  className="text-[11px] text-[var(--brand)] font-medium"
                  title="Some bills couldn't be converted to your display currency — total may be incomplete"
                >
                  FX incomplete
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 sm:justify-end sm:shrink-0">
            <div className="hidden sm:flex flex-col items-end">
              <p className="text-[20px] font-bold tabular-nums tracking-[-0.012em] leading-tight">
                {formatMoney(total, row.displayCurrency)}
              </p>
              {row.fxIncomplete && (
                <p
                  className="text-[11px] text-[var(--brand)] font-medium"
                  title="Some bills couldn't be converted to your display currency — total may be incomplete"
                >
                  FX incomplete
                </p>
              )}
            </div>
            <Button
              size="sm"
              variant={direction === "owe" ? "default" : "outline"}
              disabled={settling}
              onClick={() => onSettle(decorated)}
              className="cursor-pointer gap-1.5 w-full sm:w-auto"
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

        {/* Per-subscription breakdown — bills of the same sub merged into
            one row whose range spans `rangeStart → rangeEnd`. */}
        <ul className="divide-y divide-border/60">
          {groups.map((g) => (
            <SubGroupRow
              key={g.subscriptionId}
              group={g}
              displayCurrency={row.displayCurrency}
              today={today}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/* ======================== Sub-group row ======================== */

/**
 * One row per (counterparty × subscription) bucket. Merges every unpaid
 * bill of that sub into a single line: range `Apr 25 – May 31`, summed
 * amount, group-level fxIncomplete and overdue indicators.
 *
 * Phase 3: when `isAllPending` is true (every bill in the group is
 * strictly future and the user has the toggle ON), the row renders in a
 * muted style with an `Upcoming` pill instead of an `Overdue` one —
 * signaling "this isn't due yet" without hiding the row entirely.
 */
function SubGroupRow({
  group,
  displayCurrency,
  today,
}: {
  group: SubGroup & { isAllPending: boolean };
  displayCurrency: string;
  today: string;
}) {
  const d = daysSince(group.rangeStart, today);
  const overdue = !group.isAllPending && d >= 0;
  const overdueLabel =
    d <= 0 ? "Due today" : d === 1 ? "Overdue 1 day" : `Overdue ${d} days`;
  const isOutgoing = group.direction === "outgoing";

  return (
    <li
      className={cn(
        "flex items-center gap-3 py-2.5 px-5 transition-colors",
        overdue
          ? "bg-[var(--brand)]/[0.04] dark:bg-[var(--brand)]/[0.08]"
          : "hover:bg-foreground/[0.02] dark:hover:bg-white/[0.02]",
        group.isAllPending && "opacity-70"
      )}
    >
      <BrandIcon
        name={group.subscriptionLogo || group.subscriptionName}
        size={20}
      />
      <div className="flex-1 min-w-0 flex items-baseline gap-2">
        <p
          className={cn(
            "text-[13px] font-medium truncate",
            group.isAllPending && "text-muted-foreground"
          )}
        >
          {group.subscriptionName}
        </p>
        <p className="text-[11px] text-muted-foreground whitespace-nowrap">
          {formatBillingRange(group.rangeStart, group.rangeEnd)}
        </p>
      </div>
      {group.fxIncomplete && (
        <span
          className="text-[10px] font-medium text-[var(--brand)]"
          title="Some bills couldn't be converted to your display currency — total may be incomplete"
        >
          FX incomplete
        </span>
      )}
      {group.isAllPending ? (
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.04em] px-1.5 h-[18px] rounded-full",
            "bg-foreground/[0.06] text-muted-foreground"
          )}
        >
          <Clock className="size-2.5" />
          Upcoming
        </span>
      ) : (
        overdue && (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.04em] px-1.5 h-[18px] rounded-full",
              "bg-[var(--brand)]/12 text-[var(--brand)] dark:bg-[var(--brand)]/18 dark:text-[var(--brand-accent)]"
            )}
          >
            <Clock className="size-2.5" />
            {overdueLabel}
          </span>
        )
      )}
      <p
        className={cn(
          "text-[13px] font-semibold tabular-nums whitespace-nowrap",
          group.isAllPending ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {isOutgoing ? "−" : "+"}
        {formatMoney(group.totalAmount, displayCurrency)}
      </p>
    </li>
  );
}
