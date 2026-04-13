"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { LogOut } from "lucide-react";
import { api } from "@/lib/api-client";

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<{
    name: string;
    email: string;
    preferredCurrency: string;
  } | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    api.me().then((res) => {
      if (res.error) {
        router.push("/login");
        return;
      }
      if (res.data) setUser(res.data);
    });
  }, [router]);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    await api.logout();
    router.push("/login");
    router.refresh();
  }

  if (!user) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 w-32 bg-muted rounded-md" />
        <div className="h-48 bg-muted rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <header className="space-y-1.5">
        <p className="text-[13px] font-medium text-muted-foreground">Account</p>
        <h1 className="text-[32px] font-bold leading-tight tracking-[-0.022em]">
          Settings
        </h1>
      </header>

      <section className="space-y-4">
        <SectionHeader title="Profile" />
        <Card>
          <CardContent className="space-y-5">
            <Field label="Name" value={user.name} />
            <Field label="Email" value={user.email} />
            <Field label="Currency" value={user.preferredCurrency} />
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionHeader title="Session" />
        <Card>
          <CardContent className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold">Signed in as {user.name}</p>
              <p className="text-[13px] text-muted-foreground truncate">
                {user.email}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSignOut}
              disabled={signingOut}
              className="cursor-pointer shrink-0"
            >
              <LogOut className="size-3.5" />
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
      {title}
    </h2>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-[12px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </Label>
      <p className="text-[15px] font-medium">{value}</p>
    </div>
  );
}
