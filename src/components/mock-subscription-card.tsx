import { BrandIcon } from "@/components/brand-icon";

/**
 * Hi-fi mock of a SubShare subscription row — used as the editorial visual
 * on the landing page. Not wired to real data; decorative only.
 */
export function MockSubscriptionCard() {
  return (
    <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-card dark:shadow-none dark:ring-white/[0.08]">
      {/* Header row */}
      <div className="flex items-center gap-4">
        <BrandIcon name="Netflix" size={48} />
        <div className="flex-1 min-w-0">
          <p className="text-[17px] font-semibold tracking-[-0.01em]">
            Netflix
          </p>
          <p className="text-[13px] text-muted-foreground">
            Premium · Monthly
          </p>
        </div>
        <span className="inline-flex items-center rounded-full bg-[#eef0ff] dark:bg-[rgba(94,106,210,0.12)] text-[#4a56c4] dark:text-[#7170ff] px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.0104em]">
          SHARED · 5
        </span>
      </div>

      {/* Price breakdown */}
      <div className="mt-6 space-y-2.5 pt-5 border-t">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] text-muted-foreground">Plan total</span>
          <span className="text-[15px] font-medium tabular-nums">¥180.00</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] text-muted-foreground">Members</span>
          <span className="text-[15px] font-medium tabular-nums">5</span>
        </div>
        <div className="flex items-baseline justify-between pt-2.5 border-t">
          <span className="text-[13px] font-semibold">Your share</span>
          <span className="text-[20px] font-bold tabular-nums text-[var(--brand)]">
            ¥36.00<span className="text-muted-foreground font-normal text-[13px] ml-0.5">/mo</span>
          </span>
        </div>
      </div>

      {/* Avatars */}
      <div className="mt-5 flex items-center justify-between">
        <div className="flex -space-x-2">
          {AVATARS.map((a, i) => (
            <div
              key={i}
              className="size-8 rounded-full border-2 border-card flex items-center justify-center text-[11px] font-semibold text-white"
              style={{ backgroundColor: a.bg }}
              aria-hidden
            >
              {a.initial}
            </div>
          ))}
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#1aae39]/10 dark:bg-[#10b981]/15 text-[#1aae39] dark:text-[#10b981] px-2 py-0.5 text-[11px] font-semibold tracking-[0.0104em]">
          <span className="inline-block size-1.5 rounded-full bg-current" />
          ALL PAID
        </span>
      </div>
    </div>
  );
}

const AVATARS = [
  { initial: "Y", bg: "#5e6ad2" },
  { initial: "A", bg: "#10b981" },
  { initial: "B", bg: "#f59e0b" },
  { initial: "M", bg: "#ef4444" },
  { initial: "J", bg: "#a855f7" },
];
