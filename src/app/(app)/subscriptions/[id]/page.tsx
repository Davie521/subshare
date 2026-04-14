"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Pencil,
  UserMinus,
  UserPlus,
  Wallet,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { BrandIcon } from "@/components/brand-icon";
import { cn } from "@/lib/utils";

type Member = {
  userId: number;
  displayName: string;
  email?: string;
  addedAt: string;
  isPayer: boolean;
  isOwner: boolean;
  isSelf: boolean;
};

type Sub = {
  id: number;
  name: string;
  price: number;
  currency: string;
  nextPayment: string;
  ownerId: number;
  payerId: number;
  groupId: number | null;
  logo: string | null;
  inactive: number;
  members: Member[];
};

export default function SubscriptionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const subId = Number(params.id);

  const [sub, setSub] = useState<Sub | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [friends, setFriends] = useState<Array<{ userId: number; displayName: string }> | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.getSubscription(subId);
    if (res.data) {
      setSub(res.data as Sub);
      setLoadError(null);
    } else if (res.status === 401) {
      router.push("/login");
    } else if (res.status === 404) {
      setLoadError("Subscription not found");
    } else {
      setLoadError(res.error || "Failed to load");
    }
  }, [subId, router]);

  useEffect(() => {
    void load();
    void api.friends().then((r) => {
      if (r.data) setFriends(r.data.map((f) => ({ userId: f.userId, displayName: f.displayName })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  if (loadError && !sub) {
    return (
      <div className="max-w-md space-y-4">
        <Link
          href="/subscriptions"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <ArrowLeft className="size-3.5" />
          Subscriptions
        </Link>
        <h1 className="text-[24px] font-bold tracking-[-0.022em]">
          {loadError}
        </h1>
        <Button onClick={() => window.location.reload()}>Retry</Button>
      </div>
    );
  }

  if (!sub) {
    return (
      <div className="space-y-6 animate-pulse max-w-xl">
        <div className="h-10 w-64 bg-muted rounded-md" />
        <div className="h-40 bg-muted rounded-xl" />
        <div className="h-56 bg-muted rounded-xl" />
      </div>
    );
  }

  const selfIsOwnerOrPayer = sub.members.find(
    (m) => m.isSelf && (m.isOwner || m.isPayer)
  );
  const selfMember = sub.members.find((m) => m.isSelf);
  const perPersonShare = Math.floor(sub.price / Math.max(sub.members.length, 1));
  const nonPayerMembers = sub.members.filter((m) => !m.isPayer);
  const payer = sub.members.find((m) => m.isPayer);

  async function handleRemove(userId: number, self: boolean) {
    if (!self) {
      if (!confirm("Remove this member? They'll still owe any unpaid bills.")) return;
    }
    setBusy(true);
    setActionError(null);
    const res = await api.removeSubMember(sub!.id, userId);
    setBusy(false);
    if (res.error) {
      setActionError(res.error);
      return;
    }
    if (self) router.push("/subscriptions");
    else await load();
  }

  async function handleTransfer(newPayerId: number) {
    setBusy(true);
    setActionError(null);
    const res = await api.transferPayer(sub!.id, newPayerId);
    setBusy(false);
    setShowTransfer(false);
    if (res.error) {
      setActionError(res.error);
      return;
    }
    await load();
  }

  async function handleAdd(memberId: number) {
    setBusy(true);
    setActionError(null);
    const res = await api.addSubMembers(sub!.id, [memberId]);
    setBusy(false);
    setShowAdd(false);
    if (res.error) {
      setActionError(res.error);
      return;
    }
    await load();
  }

  const addableFriends = (friends ?? []).filter(
    (f) => !sub.members.some((m) => m.userId === f.userId)
  );

  return (
    <div className="space-y-8 max-w-2xl">
      <div className="flex items-center justify-between">
        <Link
          href="/subscriptions"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <ArrowLeft className="size-3.5" />
          Subscriptions
        </Link>
        <Link
          href={`/subscriptions/${sub.id}/edit`}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <Pencil className="size-3.5" />
          Edit
        </Link>
      </div>

      {/* Hero */}
      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <BrandIcon name={sub.name} size={52} />
            <div className="min-w-0">
              <h1 className="text-[26px] font-bold tracking-[-0.022em] truncate">
                {sub.name}
              </h1>
              <p className="text-[13px] text-muted-foreground tabular-nums">
                {formatMoney(sub.price, sub.currency)} / month · next{" "}
                {sub.nextPayment}
              </p>
            </div>
          </div>

          {sub.members.length > 1 && (
            <div className="grid grid-cols-2 gap-4 rounded-md bg-muted/50 px-3 py-2.5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Per person
                </p>
                <p className="text-[18px] font-semibold tabular-nums tracking-[-0.015em]">
                  {formatMoney(perPersonShare, sub.currency)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Paid by
                </p>
                <p className="text-[14px] font-semibold truncate">
                  {payer?.isSelf ? "You" : payer?.displayName ?? "—"}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {actionError && (
        <p className="text-[13px] font-medium text-destructive">{actionError}</p>
      )}

      {/* Members */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Members · {sub.members.length}
          </h2>
          {selfIsOwnerOrPayer && addableFriends.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAdd((v) => !v)}
              className="cursor-pointer gap-1.5"
            >
              <UserPlus className="size-3.5" />
              Add
            </Button>
          )}
        </div>

        {showAdd && selfIsOwnerOrPayer && (
          <Card className="border-dashed">
            <CardContent className="space-y-2">
              <p className="text-[13px] font-medium text-muted-foreground">
                Pick a friend to add:
              </p>
              {addableFriends.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">
                  All friends are already on this subscription.
                </p>
              ) : (
                <ul className="space-y-1">
                  {addableFriends.map((f) => (
                    <li key={f.userId}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleAdd(f.userId)}
                        className="w-full flex items-center justify-between px-2 py-2 rounded-md hover:bg-foreground/[0.04] cursor-pointer text-left disabled:opacity-50"
                      >
                        <span className="text-sm font-medium">
                          {f.displayName}
                        </span>
                        <UserPlus className="size-3.5 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        <ul className="space-y-2">
          {sub.members.map((m) => {
            const canKick =
              selfIsOwnerOrPayer && !m.isPayer && !m.isSelf;
            const canLeave = m.isSelf && !m.isPayer;

            return (
              <li key={m.userId}>
                <Card size="sm">
                  <CardContent className="flex items-center gap-3">
                    <div
                      className={cn(
                        "size-9 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold text-white"
                      )}
                      style={{
                        backgroundColor: m.isPayer
                          ? "var(--brand)"
                          : "var(--muted-foreground)",
                      }}
                      aria-hidden
                    >
                      {m.displayName.trim().charAt(0).toUpperCase() || "?"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <p className="text-sm font-semibold truncate">
                          {m.isSelf ? "You" : m.displayName}
                        </p>
                        {m.isPayer && (
                          <Badge variant="brand" className="text-[10px]">
                            Payer
                          </Badge>
                        )}
                        {m.isOwner && !m.isPayer && (
                          <Badge variant="secondary" className="text-[10px]">
                            Owner
                          </Badge>
                        )}
                      </div>
                      {m.email && (
                        <p className="text-[12px] text-muted-foreground truncate">
                          {m.email}
                        </p>
                      )}
                    </div>
                    {(canKick || canLeave) && (
                      <button
                        type="button"
                        disabled={busy}
                        title={canLeave ? "Leave" : "Remove"}
                        aria-label={canLeave ? "Leave" : "Remove"}
                        onClick={() => handleRemove(m.userId, !!canLeave)}
                        className="shrink-0 size-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/[0.08] cursor-pointer disabled:opacity-50"
                      >
                        <UserMinus className="size-3.5" />
                      </button>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>

        {/* Transfer payer */}
        {selfIsOwnerOrPayer && nonPayerMembers.length > 0 && (
          <Card className="border-dashed">
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-semibold">Transfer payer role</p>
                  <p className="text-[12px] text-muted-foreground">
                    Whoever pays gets the service bill, owes no share, and
                    receives transfers.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowTransfer((v) => !v)}
                  className="cursor-pointer gap-1.5 shrink-0"
                >
                  <Wallet className="size-3.5" />
                  Transfer
                </Button>
              </div>
              {showTransfer && (
                <ul className="space-y-1">
                  {nonPayerMembers.map((m) => (
                    <li key={m.userId}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleTransfer(m.userId)}
                        className="w-full flex items-center justify-between px-2 py-2 rounded-md hover:bg-foreground/[0.04] cursor-pointer text-left disabled:opacity-50"
                      >
                        <span className="text-sm font-medium">
                          {m.isSelf ? "You" : m.displayName}
                        </span>
                        <Wallet className="size-3.5 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {/* Self leave */}
        {selfMember && !selfMember.isPayer && (
          <Card className="border-destructive/20 bg-destructive/[0.02]">
            <CardContent>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[13px] font-semibold">Leave subscription</p>
                  <p className="text-[12px] text-muted-foreground">
                    You&apos;ll stay on the hook for any unpaid bills, but
                    won&apos;t be charged going forward.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => handleRemove(selfMember.userId, true)}
                  className="cursor-pointer shrink-0"
                >
                  Leave
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
