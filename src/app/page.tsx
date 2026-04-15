import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Logo } from "@/components/logo";
import { MockSubscriptionCard } from "@/components/mock-subscription-card";
import { ArrowRight } from "lucide-react";

export default async function Home() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <div className="bg-background text-foreground">
      <MinimalNav />

      <Hero />
      <Visualization />
      <HowItWorks />
      <Closing />

      <footer className="mx-auto flex max-w-6xl items-center justify-between px-8 py-10 lg:px-12">
        <Logo size={20} />
        <p className="text-[12px] text-muted-foreground">
          © {new Date().getFullYear()} SubShare
        </p>
      </footer>
    </div>
  );
}

/* =================================================================
   Minimal nav — logo left, single text link right. No pill CTA.
   ================================================================= */
function MinimalNav() {
  return (
    <nav className="absolute top-0 inset-x-0 z-20 mx-auto flex h-20 max-w-6xl items-center justify-between px-8 lg:px-12">
      <Link
        href="/"
        className="cursor-pointer transition-opacity hover:opacity-80"
      >
        <Logo size={26} />
      </Link>
      <Link
        href="/login"
        className="text-[14px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        Sign in
      </Link>
    </nav>
  );
}

/* =================================================================
   Section 1 · HERO — occupies 100vh, headline is the only focus.
   ================================================================= */
function Hero() {
  return (
    <section className="relative min-h-screen flex items-center overflow-hidden">
      {/* Single ambient glow — top-right, subtle */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -right-40 size-[640px] rounded-full opacity-30 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, rgba(94,106,210,0.4), rgba(94,106,210,0) 70%)",
        }}
      />

      <div className="relative z-10 mx-auto w-full max-w-6xl px-8 lg:px-12">
        <h1 className="max-w-4xl text-[52px] sm:text-[68px] lg:text-[88px] font-bold leading-[0.98] tracking-[-0.032em]">
          The ledger for{" "}
          <span className="text-[var(--brand)]">shared plans.</span>
        </h1>

        <p className="mt-10 max-w-xl text-[18px] lg:text-[20px] leading-[1.55] text-muted-foreground">
          Netflix with the flat. Spotify with your sister. ChatGPT with
          the group. One record for all of it.
        </p>

        <div className="mt-12">
          <Link
            href="/register"
            className="group inline-flex items-center gap-2 rounded-md bg-[var(--brand)] px-6 py-3.5 text-[15px] font-semibold text-white shadow-[0_8px_24px_rgba(94,106,210,0.35)] hover:bg-[var(--brand-accent)] hover:shadow-[0_12px_28px_rgba(94,106,210,0.45)] active:translate-y-px transition-all cursor-pointer"
          >
            Start your ledger
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>

      {/* Scroll hint — absolute bottom-center */}
      <div
        aria-hidden
        className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-muted-foreground"
      >
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em]">
          Scroll
        </span>
        <span className="block h-8 w-px bg-current opacity-40" />
      </div>
    </section>
  );
}

/* =================================================================
   Section 2 · VISUALIZATION — editorial: mock card on one side,
   quote on the other. No grid of 3 columns.
   ================================================================= */
function Visualization() {
  return (
    <section className="relative min-h-screen flex items-center border-t">
      <div className="mx-auto w-full max-w-6xl px-8 lg:px-12 py-24 lg:py-0 grid gap-14 lg:grid-cols-2 lg:gap-20 items-center">
        <div className="flex justify-center lg:justify-start">
          <MockSubscriptionCard />
        </div>

        <div className="space-y-6 max-w-md">
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            One plan · Five people
          </p>
          <p className="text-[28px] lg:text-[34px] leading-[1.2] tracking-[-0.022em] font-semibold">
            Netflix, ¥180 a month, split five ways.
          </p>
          <p className="text-[17px] leading-[1.6] text-muted-foreground">
            SubShare does the arithmetic, keeps the history, and shows
            everyone who&apos;s paid and who hasn&apos;t — so the group
            chat doesn&apos;t have to.
          </p>
        </div>
      </div>
    </section>
  );
}

/* =================================================================
   Section 3 · HOW IT WORKS — editorial, left/right alternating.
   No 3-column card grid.
   ================================================================= */
function HowItWorks() {
  return (
    <section className="relative border-t">
      <div className="mx-auto max-w-6xl px-8 lg:px-12 py-28 lg:py-40 space-y-20 lg:space-y-32">
        <header className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            How it works
          </p>
          <h2 className="mt-3 text-[36px] lg:text-[48px] font-bold tracking-[-0.028em] leading-[1.05]">
            Three steps from chaos to clarity.
          </h2>
        </header>

        <Step
          number="01"
          align="right"
          title="Record"
          body="Add a subscription. Enter the plan, the price, the people who share it. Ten seconds, tops."
        />
        <Step
          number="02"
          align="left"
          title="Review"
          body="See every shared plan on one page. Who's on what, what they owe this month, who still needs to pay."
        />
        <Step
          number="03"
          align="right"
          title="Reconcile"
          body="When someone transfers you, mark them paid. History is kept forever. No screenshots required."
        />
      </div>
    </section>
  );
}

function Step({
  number,
  title,
  body,
  align,
}: {
  number: string;
  title: string;
  body: string;
  align: "left" | "right";
}) {
  return (
    <div
      className={`grid gap-6 lg:grid-cols-12 items-start ${
        align === "right" ? "lg:[&>*:first-child]:col-start-7" : ""
      }`}
    >
      <div className="lg:col-span-6 space-y-4">
        <div className="flex items-baseline gap-4">
          <span className="text-[64px] lg:text-[88px] font-bold tracking-[-0.04em] leading-none text-muted-foreground/25 tabular-nums">
            {number}
          </span>
          <h3 className="text-[28px] lg:text-[36px] font-bold tracking-[-0.022em]">
            {title}
          </h3>
        </div>
        <p className="text-[17px] leading-[1.6] text-muted-foreground max-w-md">
          {body}
        </p>
      </div>
    </div>
  );
}

/* =================================================================
   Section 4 · CLOSING — one sentence, one CTA.
   ================================================================= */
function Closing() {
  return (
    <section className="relative min-h-[80vh] flex items-center border-t overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 left-1/2 -translate-x-1/2 size-[720px] rounded-full opacity-20 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, rgba(94,106,210,0.45), rgba(94,106,210,0) 70%)",
        }}
      />
      <div className="relative z-10 mx-auto w-full max-w-4xl px-8 lg:px-12 text-center space-y-10">
        <h2 className="text-[44px] lg:text-[64px] font-bold tracking-[-0.028em] leading-[1.02]">
          Stop maintaining
          <br />
          the spreadsheet.
        </h2>
        <div className="flex justify-center">
          <Link
            href="/register"
            className="group inline-flex items-center gap-2 rounded-md bg-[var(--brand)] px-6 py-3.5 text-[15px] font-semibold text-white shadow-[0_8px_24px_rgba(94,106,210,0.35)] hover:bg-[var(--brand-accent)] hover:shadow-[0_12px_28px_rgba(94,106,210,0.45)] active:translate-y-px transition-all cursor-pointer"
          >
            Start your ledger
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
