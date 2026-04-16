"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { LogoMark } from "@/components/logo";

const ERROR_MESSAGES: Record<string, string> = {
  oauth_denied: "Sign-in was cancelled.",
  state_mismatch: "Session expired. Please try again.",
  missing_verifier: "Session expired. Please try again.",
  email_not_verified: "Your Google email is not verified.",
  oauth_failed: "Something went wrong. Please try again.",
  rate_limit: "Too many attempts. Please wait a moment.",
};

function LoginContent() {
  const params = useSearchParams();
  const errorCode = params.get("error");
  const errorMessage = errorCode ? ERROR_MESSAGES[errorCode] ?? "An error occurred." : null;

  return (
    <div className="relative min-h-screen overflow-hidden flex items-center justify-center px-4 bg-background">
      {/* Ambient glows */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -right-24 size-[420px] rounded-full opacity-35 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, rgba(94,106,210,0.3), rgba(94,106,210,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -left-24 size-[420px] rounded-full opacity-30 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, rgba(113,112,255,0.28), rgba(113,112,255,0) 70%)",
        }}
      />

      <div className="relative w-full max-w-sm space-y-7">
        <div className="flex flex-col items-center gap-3 text-center">
          <Link href="/" className="cursor-pointer transition-opacity hover:opacity-80">
            <LogoMark size={44} />
          </Link>
          <div className="space-y-1">
            <h1 className="text-[26px] font-bold tracking-[-0.022em]">
              Welcome to SubShare
            </h1>
            <p className="text-[14px] text-muted-foreground">
              Sign in to track shared subscriptions.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {errorMessage && (
            <p className="text-center text-[13px] font-medium text-destructive">
              {errorMessage}
            </p>
          )}

          <a
            href="/api/auth/google"
            className="flex w-full items-center justify-center gap-3 rounded-lg border bg-card px-4 py-3 text-[15px] font-medium shadow-sm transition-colors hover:bg-accent cursor-pointer"
          >
            <svg className="size-5" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Sign in with Google
          </a>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
