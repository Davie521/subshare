"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { LogOut, Check, ArrowRight } from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type User = {
  name: string;
  email: string;
  preferredCurrency: string;
  displayName: string;
  showEmail: boolean;
};

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [showEmail, setShowEmail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    api.me().then((res) => {
      if (res.data) {
        setUser(res.data);
        setDisplayName(res.data.displayName);
        setShowEmail(res.data.showEmail);
        return;
      }
      if (res.status === 401) {
        router.push("/login");
      }
    });
  }, [router]);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    await api.logout();
    router.push("/login");
    router.refresh();
  }

  const dirty =
    user !== null &&
    (displayName.trim() !== user.displayName.trim() ||
      showEmail !== user.showEmail);

  async function handleSave() {
    if (!dirty || saving) return;
    setSaving(true);
    const res = await api.updateProfile({
      displayName: displayName.trim(),
      showEmail,
    });
    setSaving(false);
    if (!res.error) {
      setUser(
        user
          ? { ...user, displayName: displayName.trim(), showEmail }
          : null
      );
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 3000);
    }
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
    <div className="space-y-10 max-w-xl">
      <header className="space-y-1.5">
        <p className="text-[13px] font-medium text-muted-foreground">Account</p>
        <h1 className="text-[32px] font-bold leading-tight tracking-[-0.022em]">
          Settings
        </h1>
      </header>

      {/* Profile */}
      <section className="space-y-4">
        <SectionHeader title="Profile" />
        <Card>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="displayName">Display name</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={user.name}
                maxLength={60}
              />
              <p className="text-[12px] text-muted-foreground">
                What friends see on subscriptions. Leave blank to use your
                account name ({user.name}).
              </p>
            </div>

            <Separator />

            <Toggle
              id="showEmail"
              checked={showEmail}
              onChange={setShowEmail}
              label="Show email to friends"
              hint="Friends will see your email next to your name. Non-friends never see it."
            />

            <div className="flex items-center gap-3 pt-1">
              <Button
                onClick={handleSave}
                disabled={!dirty || saving}
                className="cursor-pointer"
              >
                {saving ? "Saving…" : "Save changes"}
              </Button>
              {showSaved && !dirty && (
                <p className="text-[12px] text-muted-foreground flex items-center gap-1">
                  <Check className="size-3.5" />
                  Saved
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Account */}
      <section className="space-y-4">
        <SectionHeader title="Account" />
        <Card>
          <CardContent className="space-y-4">
            <Field label="Email" value={user.email} />
            <Field label="Currency" value={user.preferredCurrency} />
          </CardContent>
        </Card>
      </section>

      {/* Groups */}
      <section className="space-y-4">
        <SectionHeader title="Groups" />
        <Card className="hover:bg-foreground/[0.02] dark:hover:bg-white/[0.02] transition-colors">
          <Link href="/settings/circles">
            <CardContent className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-[15px] font-semibold">Member templates</p>
                <p className="text-[13px] text-muted-foreground">
                  Save a fixed group of people to quick-fill new subscriptions.
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground" />
            </CardContent>
          </Link>
        </Card>
      </section>

      {/* Session */}
      <section className="space-y-4">
        <SectionHeader title="Session" />
        <Card>
          <CardContent className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold">
                Signed in as {user.displayName?.trim() || user.name}
              </p>
              <p className="text-[13px] text-muted-foreground truncate">
                {user.email}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSignOut}
              disabled={signingOut}
              className="cursor-pointer shrink-0 gap-1.5"
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
    <div className="flex items-center justify-between gap-4">
      <Label className="text-[13px] font-medium text-muted-foreground">
        {label}
      </Label>
      <p className="text-[14px] font-medium truncate">{value}</p>
    </div>
  );
}

function Toggle({
  id,
  checked,
  onChange,
  label,
  hint,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="text-[14px] font-medium cursor-pointer">
          {label}
        </Label>
        {hint && (
          <p className="text-[12px] text-muted-foreground mt-0.5">{hint}</p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative shrink-0 w-9 h-5 rounded-full transition-colors cursor-pointer",
          checked ? "bg-[var(--brand)]" : "bg-muted"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-4" : "translate-x-0"
          )}
        />
      </button>
    </div>
  );
}
