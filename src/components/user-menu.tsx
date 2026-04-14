"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { api } from "@/lib/api-client";
import { UserAvatar } from "@/components/user-avatar";

/**
 * User card at the bottom of the sidebar.
 * Shows avatar initial + name + email, with an inline Sign out action.
 */
export function UserMenu() {
  const router = useRouter();
  const [user, setUser] = useState<{ name: string; email: string } | null>(
    null
  );
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((res) => {
        if (cancelled) return;
        if (res.data) setUser({ name: res.data.name, email: res.data.email });
      })
      .catch(() => {
        // Silent: if we can't resolve the user, leave skeleton — the app
        // layout already guards behind auth, a retry on next nav covers it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    await api.logout();
    // Even if logout fails (network / 500), redirect anyway — user's
    // intent to sign out takes priority over API state.
    router.push("/login");
    router.refresh();
  }

  if (!user) {
    return (
      <div className="px-3 pb-3">
        <div className="h-10 rounded-lg bg-muted/40 animate-pulse" />
      </div>
    );
  }

  const displayName = user.name?.trim() || "Account";

  return (
    <div className="px-3 pb-3">
      <div className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-foreground/[0.04]">
        <UserAvatar name={displayName} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium truncate leading-tight">
            {displayName}
          </p>
          <p className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
            {user.email}
          </p>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          aria-label="Sign out"
          title="Sign out"
          className="shrink-0 flex items-center justify-center size-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
        >
          <LogOut className="size-[14px]" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
