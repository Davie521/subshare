"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BrandIcon } from "@/components/brand-icon";
import { UserAvatar } from "@/components/user-avatar";

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
  logo: string | null;
  inactive: boolean;
  refundPolicy: "payer_absorbs" | "redistribute";
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
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmKickId, setConfirmKickId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<{
    name: string;
    price: string;
    nextPayment: string;
    refundPolicy: "payer_absorbs" | "redistribute";
  }>({
    name: "",
    price: "",
    nextPayment: "",
    refundPolicy: "payer_absorbs",
  });
  const [editError, setEditError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getSubscription(subId);
      if (res.data) {
        const d = res.data;
        // Narrow the API shape to the subset this page uses — explicit rather
        // than `as Sub` so future API columns don't silently leak in.
        setSub({
          id: d.id,
          name: d.name,
          price: d.price,
          currency: d.currency,
          nextPayment: d.nextPayment,
          ownerId: d.ownerId,
          payerId: d.payerId,
          logo: d.logo,
          inactive: d.inactive,
          members: d.members,
        });
        setLoadError(null);
      } else if (res.status === 401) {
        router.push("/login");
      } else if (res.status === 404) {
        setLoadError("Subscription not found");
      } else {
        setLoadError(res.error || "Failed to load");
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Network error");
    }
  }, [subId, router]);

  useEffect(() => {
    let cancelled = false;
    // load is async; setState calls happen in later microtasks.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    api.friends().then((r) => {
      if (cancelled) return;
      if (r.data) {
        setFriends(
          r.data.map((f) => ({
            userId: f.userId,
            displayName: f.displayName,
          }))
        );
      }
    }).catch(() => {
      // Friends sidebar is non-critical; stay silent if it fails.
    });
    return () => {
      cancelled = true;
    };
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
        <Button onClick={() => void load()}>Retry</Button>
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
  const payer = sub.members.find((m) => m.isPayer);

  async function doRemove(userId: number, self: boolean) {
    setBusy(true);
    setActionError(null);
    const res = await api.removeSubMember(sub!.id, userId);
    setBusy(false);
    setConfirmKickId(null);
    if (res.error) {
      setActionError(res.error);
      return;
    }
    if (self) router.push("/subscriptions");
    else await load();
  }

  function handleRemove(userId: number, self: boolean) {
    if (self) {
      void doRemove(userId, true);
      return;
    }
    if (confirmKickId === userId) {
      void doRemove(userId, false);
    } else {
      setConfirmKickId(userId);
    }
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

  function startEdit() {
    if (!sub) return;
    setEditForm({
      name: sub.name,
      price: (sub.price / 100).toFixed(2),
      nextPayment: sub.nextPayment,
      refundPolicy: sub.refundPolicy ?? "payer_absorbs",
    });
    setEditError(null);
    setEditing(true);
  }

  async function handleSaveEdit() {
    if (!sub) return;
    const price = Math.round(parseFloat(editForm.price) * 100);
    if (!editForm.name.trim() || isNaN(price) || price <= 0) {
      setEditError("Name and a valid price are required");
      return;
    }
    setBusy(true);
    setEditError(null);
    const res = await api.updateSubscription(sub.id, {
      name: editForm.name.trim(),
      price,
      nextPayment: editForm.nextPayment,
      refundPolicy: editForm.refundPolicy,
    });
    setBusy(false);
    if (res.error) {
      setEditError(res.error);
      return;
    }
    setEditing(false);
    await load();
  }

  async function handleDelete() {
    if (!sub) return;
    setBusy(true);
    setActionError(null);
    const res = await api.deleteSubscription(sub.id);
    setBusy(false);
    if (res.error) {
      setActionError(res.error);
      setConfirmDelete(false);
      return;
    }
    router.push("/subscriptions");
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
        {!editing && selfIsOwnerOrPayer && (
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <Pencil className="size-3.5" />
            Edit details
          </button>
        )}
      </div>

      {/* Hero */}
      <Card>
        <CardContent className="space-y-4">
          {editing ? (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <BrandIcon name={editForm.name || sub.name} size={52} />
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="sub-name" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Name
                  </Label>
                  <Input
                    id="sub-name"
                    value={editForm.name}
                    onChange={(e) =>
                      setEditForm({ ...editForm, name: e.target.value })
                    }
                    autoFocus
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="sub-price" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Price ({sub.currency}) / month
                  </Label>
                  <Input
                    id="sub-price"
                    type="number"
                    step="0.01"
                    value={editForm.price}
                    onChange={(e) =>
                      setEditForm({ ...editForm, price: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sub-next" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Next payment
                  </Label>
                  <Input
                    id="sub-next"
                    type="date"
                    value={editForm.nextPayment}
                    onChange={(e) =>
                      setEditForm({ ...editForm, nextPayment: e.target.value })
                    }
                  />
                </div>
              </div>

              {sub.members.length > 1 && (
                <div className="space-y-2">
                  <Label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    If someone leaves mid-month
                  </Label>
                  <div className="grid gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setEditForm({
                          ...editForm,
                          refundPolicy: "payer_absorbs",
                        })
                      }
                      className={cn(
                        "cursor-pointer text-left rounded-md border p-3 transition-colors",
                        editForm.refundPolicy === "payer_absorbs"
                          ? "border-foreground bg-foreground/5"
                          : "border-input hover:bg-foreground/[0.03]"
                      )}
                    >
                      <p className="text-[13px] font-semibold">
                        Payer absorbs the difference
                      </p>
                      <p className="text-[12px] text-muted-foreground">
                        The leaver pays only for the days they used; the payer
                        collects less. Other members unchanged.
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setEditForm({
                          ...editForm,
                          refundPolicy: "redistribute",
                        })
                      }
                      className={cn(
                        "cursor-pointer text-left rounded-md border p-3 transition-colors",
                        editForm.refundPolicy === "redistribute"
                          ? "border-foreground bg-foreground/5"
                          : "border-input hover:bg-foreground/[0.03]"
                      )}
                    >
                      <p className="text-[13px] font-semibold">
                        Split the difference among remaining members
                      </p>
                      <p className="text-[12px] text-muted-foreground">
                        Other unpaid members&apos; bills go up so the payer
                        doesn&apos;t lose any money.
                      </p>
                    </button>
                  </div>
                </div>
              )}

              {editError && (
                <p className="text-[13px] font-medium text-destructive">
                  {editError}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setEditing(false);
                    setEditError(null);
                  }}
                  className="cursor-pointer gap-1.5"
                >
                  <X className="size-3.5" />
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={handleSaveEdit}
                  className="cursor-pointer"
                >
                  {busy ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </div>
          ) : (
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
          )}

          {!editing && sub.members.length > 1 && (
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
                    <UserAvatar
                      name={m.displayName}
                      size="md"
                      tone={m.isPayer ? "brand" : "neutral"}
                    />
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
                        title={
                          canLeave
                            ? "Leave"
                            : confirmKickId === m.userId
                            ? "Confirm remove"
                            : "Remove"
                        }
                        aria-label={
                          canLeave
                            ? "Leave"
                            : confirmKickId === m.userId
                            ? "Confirm remove"
                            : "Remove"
                        }
                        onClick={() => handleRemove(m.userId, !!canLeave)}
                        className={
                          "shrink-0 size-8 rounded-md flex items-center justify-center cursor-pointer disabled:opacity-50 " +
                          (confirmKickId === m.userId
                            ? "text-white bg-destructive hover:bg-destructive/90"
                            : "text-muted-foreground hover:text-destructive hover:bg-destructive/[0.08]")
                        }
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

        {/* Delete subscription (owner / payer only) */}
        {selfIsOwnerOrPayer && (
          <Card className="border-destructive/20 bg-destructive/[0.02]">
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[13px] font-semibold">
                    Delete subscription
                  </p>
                  <p className="text-[12px] text-muted-foreground">
                    Removes the subscription and all of its billing history.
                    Members will no longer see it.
                  </p>
                </div>
                {!confirmDelete && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setConfirmDelete(true)}
                    className="cursor-pointer shrink-0 gap-1.5"
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </Button>
                )}
              </div>
              {confirmDelete && (
                <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/[0.04] px-3 py-2.5">
                  <p className="text-[12px] font-medium text-foreground">
                    Delete <span className="font-semibold">{sub.name}</span>?
                    This can&apos;t be undone.
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setConfirmDelete(false)}
                      className="cursor-pointer"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      disabled={busy}
                      onClick={handleDelete}
                      className="cursor-pointer bg-destructive hover:bg-destructive/90 text-white"
                    >
                      {busy ? "Deleting…" : "Yes, delete"}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Self leave */}
        {selfMember && !selfMember.isPayer && (
          <Card className="border-destructive/20 bg-destructive/[0.02]">
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[13px] font-semibold">Leave subscription</p>
                  <p className="text-[12px] text-muted-foreground">
                    You&apos;ll stay on the hook for any unpaid bills, but
                    won&apos;t be charged going forward.
                  </p>
                </div>
                {!confirmLeave && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setConfirmLeave(true)}
                    className="cursor-pointer shrink-0"
                  >
                    Leave
                  </Button>
                )}
              </div>
              {confirmLeave && (
                <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/[0.04] px-3 py-2.5">
                  <p className="text-[12px] font-medium text-foreground">
                    Leave <span className="font-semibold">{sub.name}</span>?
                    This can&apos;t be undone.
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setConfirmLeave(false)}
                      className="cursor-pointer"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      disabled={busy}
                      onClick={() => handleRemove(selfMember.userId, true)}
                      className="cursor-pointer bg-destructive hover:bg-destructive/90 text-white"
                    >
                      {busy ? "Leaving…" : "Yes, leave"}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
