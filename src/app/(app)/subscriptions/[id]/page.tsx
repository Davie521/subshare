"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Copy,
  Link2,
  Pencil,
  Trash2,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { api, type SubscriptionTag } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BrandIcon } from "@/components/brand-icon";
import { UserAvatar } from "@/components/user-avatar";
import { TagChipList } from "@/components/tag-chip";
import { TagEditor, type TagEditorHandle } from "@/components/tag-editor";
import { IconPicker } from "@/components/icon-picker";

type Member = {
  userId: number;
  displayName: string;
  email?: string;
  addedAt: string;
  leftAt?: string | null;
  isPayer: boolean;
  isOwner: boolean;
  isSelf: boolean;
  status: "active" | "left_unsettled";
  outstandingAmount?: number;
};

type Sub = {
  id: number;
  name: string;
  price: number;
  currency: string;
  nextPayment: string;
  startDate: string;
  ownerId: number;
  payerId: number;
  logo: string | null;
  refundPolicy: "payer_absorbs" | "redistribute";
  tags: SubscriptionTag[];
  personalTags: SubscriptionTag[];
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
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [invitingBusy, setInvitingBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmKickId, setConfirmKickId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editAddedAtId, setEditAddedAtId] = useState<number | null>(null);
  const [editAddedAtValue, setEditAddedAtValue] = useState<string>("");
  const [editAddedAtError, setEditAddedAtError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<{
    name: string;
    price: string;
    refundPolicy: "payer_absorbs" | "redistribute";
  }>({
    name: "",
    price: "",
    refundPolicy: "payer_absorbs",
  });
  const [editError, setEditError] = useState<string | null>(null);

  const [editingTags, setEditingTags] = useState(false);
  const [tagsDraft, setTagsDraft] = useState<SubscriptionTag[]>([]);
  const [tagsError, setTagsError] = useState<string | null>(null);
  const tagEditorRef = useRef<TagEditorHandle>(null);

  const [editingPersonalTags, setEditingPersonalTags] = useState(false);
  const [personalTagsDraft, setPersonalTagsDraft] = useState<SubscriptionTag[]>([]);
  const [personalTagsError, setPersonalTagsError] = useState<string | null>(null);
  const personalTagEditorRef = useRef<TagEditorHandle>(null);

  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [iconError, setIconError] = useState<string | null>(null);

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
          startDate: d.startDate,
          ownerId: d.ownerId,
          payerId: d.payerId,
          logo: d.logo,
          refundPolicy: d.refundPolicy,
          tags: d.tags ?? [],
          personalTags: d.personalTags ?? [],
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
  const selfIsOwner = sub.members.some((m) => m.isSelf && m.isOwner);
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

  function openEditAddedAt(m: Member) {
    setEditAddedAtId(m.userId);
    setEditAddedAtValue(m.addedAt);
    setEditAddedAtError(null);
  }

  function cancelEditAddedAt() {
    setEditAddedAtId(null);
    setEditAddedAtValue("");
    setEditAddedAtError(null);
  }

  async function saveEditAddedAt(userId: number) {
    if (!sub) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(editAddedAtValue)) {
      setEditAddedAtError("Pick a valid date");
      return;
    }
    setBusy(true);
    setEditAddedAtError(null);
    const res = await api.editMemberAddedAt(sub.id, userId, editAddedAtValue);
    setBusy(false);
    if (res.error) {
      setEditAddedAtError(res.error);
      return;
    }
    cancelEditAddedAt();
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

  async function handleCreateInvite() {
    if (!sub) return;
    setInvitingBusy(true);
    setInviteError(null);
    setInviteCopied(false);
    const res = await api.createInvite(sub.id);
    setInvitingBusy(false);
    if (res.error || !res.data) {
      setInviteError(res.error || "Could not create invite");
      return;
    }
    const url = `${window.location.origin}/invite/${res.data.token}`;
    setInviteUrl(url);
    try {
      await navigator.clipboard.writeText(url);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    } catch {
      // Clipboard API can fail on insecure contexts; the UI shows the URL
      // anyway so the user can manually copy.
    }
  }

  async function handleCopyInvite() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    } catch {
      setInviteError("Copy failed — select the link manually");
    }
  }

  function startEdit() {
    if (!sub) return;
    setEditForm({
      name: sub.name,
      price: (sub.price / 100).toFixed(2),
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

  async function handleChangeLogo(newLogo: string | null) {
    if (!sub) return;
    setBusy(true);
    setIconError(null);
    try {
      const res = await api.updateSubscription(sub.id, { logo: newLogo });
      if (res.error) {
        setIconError(res.error);
        return;
      }
      setIconPickerOpen(false);
      await load();
    } catch (err) {
      setIconError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  function startEditTags() {
    if (!sub) return;
    setTagsDraft(sub.tags);
    setTagsError(null);
    setEditingTags(true);
  }

  async function handleSaveTags() {
    if (!sub) return;
    // Flush any text still in the TagEditor's input row so typed-but-not-
    // yet-added tags aren't silently dropped on Save. commitPending returns
    // the post-commit array; fall back to the stale draft when nothing was
    // pending (React state updates from setState don't land in time for
    // this same click tick).
    const committed = tagEditorRef.current?.commitPending();
    const finalTags = committed ?? tagsDraft;
    setBusy(true);
    setTagsError(null);
    const res = await api.updateSubscription(sub.id, { tags: finalTags });
    setBusy(false);
    if (res.error) {
      setTagsError(res.error);
      return;
    }
    setEditingTags(false);
    await load();
  }

  function startEditPersonalTags() {
    if (!sub) return;
    setPersonalTagsDraft(sub.personalTags);
    setPersonalTagsError(null);
    setEditingPersonalTags(true);
  }

  async function handleSavePersonalTags() {
    if (!sub) return;
    // Mirrors handleSaveTags — flush pending input before persisting.
    const committed = personalTagEditorRef.current?.commitPending();
    const finalTags = committed ?? personalTagsDraft;
    setBusy(true);
    setPersonalTagsError(null);
    const res = await api.updateSubscription(sub.id, {
      personalTags: finalTags,
    });
    setBusy(false);
    if (res.error) {
      setPersonalTagsError(res.error);
      return;
    }
    setEditingPersonalTags(false);
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
          className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground cursor-pointer min-h-11 md:min-h-0 -ml-2 px-2"
        >
          <ArrowLeft className="size-3.5" />
          Subscriptions
        </Link>
        {!editing && selfIsOwnerOrPayer && (
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground cursor-pointer min-h-11 md:min-h-0 -mr-2 px-2"
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
                <BrandIcon name={sub.logo || editForm.name || sub.name} size={52} />
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              </div>

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
              {selfIsOwnerOrPayer ? (
                <button
                  type="button"
                  onClick={() => {
                    setIconError(null);
                    setIconPickerOpen(true);
                  }}
                  className="relative group cursor-pointer rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                  aria-label="Change icon"
                  title="Change icon"
                >
                  <BrandIcon name={sub.logo || sub.name} size={52} />
                  <span className="pointer-events-none absolute inset-0 rounded-md bg-foreground/0 group-hover:bg-foreground/20 transition-colors flex items-center justify-center">
                    <Pencil className="size-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </span>
                </button>
              ) : (
                <BrandIcon name={sub.logo || sub.name} size={52} />
              )}
              <div className="min-w-0 flex-1">
                <h1 className="text-[26px] font-bold tracking-[-0.022em] truncate">
                  {sub.name}
                </h1>
                <p className="text-[13px] text-muted-foreground tabular-nums">
                  {formatMoney(sub.price, sub.currency)} / month · next{" "}
                  {sub.nextPayment}
                </p>
                {sub.tags.length > 0 && (
                  <div className="mt-2">
                    <TagChipList tags={sub.tags} />
                  </div>
                )}
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

      {/* Tags — owner or payer can edit. Public/private distinction only
          shows up on multi-member subs; on a 1-member sub there is no-one
          else for a "public" tag to be public TO, so the toggle is
          hidden and new tags default to private. */}
      {selfIsOwnerOrPayer && (
        <Card>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  Tags
                </p>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  {sub.members.length > 1
                    ? "Private tags are only visible to the owner and payer."
                    : "Short labels for this subscription."}
                </p>
              </div>
              {!editingTags && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={startEditTags}
                  className="cursor-pointer gap-1.5"
                >
                  <Pencil className="size-3.5" />
                  {sub.tags.length > 0 ? "Edit" : "Add"}
                </Button>
              )}
            </div>

            {editingTags ? (
              <>
                <TagEditor
                  ref={tagEditorRef}
                  tags={tagsDraft}
                  onChange={setTagsDraft}
                  disabled={busy}
                  showVisibilityToggle={sub.members.length > 1}
                />
                {tagsError && (
                  <p className="text-[13px] font-medium text-destructive">
                    {tagsError}
                  </p>
                )}
                <div className="flex items-center justify-end gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setEditingTags(false);
                      setTagsError(null);
                    }}
                    className="cursor-pointer gap-1.5"
                  >
                    <X className="size-3.5" />
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={handleSaveTags}
                    className="cursor-pointer"
                  >
                    {busy ? "Saving…" : "Save tags"}
                  </Button>
                </div>
              </>
            ) : sub.tags.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                No tags yet.
              </p>
            ) : (
              <TagChipList tags={sub.tags} />
            )}
          </CardContent>
        </Card>
      )}

      {/* Your tags — per-member personal bucket. Only surfaced on shared
          subs; on a solo sub the main Tags card is the only tag surface
          (no distinction between "my tags" and "everyone's tags"). */}
      {sub.members.length > 1 && selfMember && (
        <Card>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  Your tags
                </p>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  Only you can see these.
                </p>
              </div>
              {!editingPersonalTags && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={startEditPersonalTags}
                  className="cursor-pointer gap-1.5"
                >
                  <Pencil className="size-3.5" />
                  {sub.personalTags.length > 0 ? "Edit" : "Add"}
                </Button>
              )}
            </div>

            {editingPersonalTags ? (
              <>
                <TagEditor
                  ref={personalTagEditorRef}
                  tags={personalTagsDraft}
                  onChange={setPersonalTagsDraft}
                  disabled={busy}
                  showVisibilityToggle={false}
                />
                {personalTagsError && (
                  <p className="text-[13px] font-medium text-destructive">
                    {personalTagsError}
                  </p>
                )}
                <div className="flex items-center justify-end gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setEditingPersonalTags(false);
                      setPersonalTagsError(null);
                    }}
                    className="cursor-pointer gap-1.5"
                  >
                    <X className="size-3.5" />
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={handleSavePersonalTags}
                    className="cursor-pointer"
                  >
                    {busy ? "Saving…" : "Save tags"}
                  </Button>
                </div>
              </>
            ) : sub.personalTags.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                No personal tags yet.
              </p>
            ) : (
              <TagChipList tags={sub.personalTags} />
            )}
          </CardContent>
        </Card>
      )}

      {actionError && (
        <p className="text-[13px] font-medium text-destructive">{actionError}</p>
      )}
      {iconError && (
        <p className="text-[13px] font-medium text-destructive">{iconError}</p>
      )}

      {/* Members */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Members · {sub.members.length}
          </h2>
          <div className="flex gap-2">
            {selfMember && (
              <Button
                size="sm"
                variant="outline"
                disabled={invitingBusy}
                onClick={handleCreateInvite}
                className="cursor-pointer gap-1.5"
              >
                <Link2 className="size-3.5" />
                {invitingBusy ? "Creating…" : "Invite link"}
              </Button>
            )}
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
        </div>

        {inviteError && (
          <p className="text-[13px] font-medium text-destructive">
            {inviteError}
          </p>
        )}

        {inviteUrl && (
          <Card className="border-dashed">
            <CardContent className="space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold">
                    Invite link ready
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Single-use invite link
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setInviteUrl(null);
                    setInviteCopied(false);
                  }}
                  className="cursor-pointer text-muted-foreground hover:text-foreground"
                  aria-label="Dismiss"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate text-[12px] font-mono bg-muted/40 border rounded-md px-2.5 py-2">
                  {inviteUrl}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopyInvite}
                  className="cursor-pointer gap-1.5 shrink-0"
                >
                  {inviteCopied ? (
                    <>
                      <Check className="size-3.5" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="size-3.5" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

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
            const isLeftUnsettled = m.status === "left_unsettled";
            const canKick =
              selfIsOwnerOrPayer && !m.isPayer && !m.isSelf && !isLeftUnsettled;
            const canLeave = m.isSelf && !m.isPayer && !isLeftUnsettled;
            const canEditAddedAt = selfIsOwner && !isLeftUnsettled;
            const owed = m.outstandingAmount ?? 0;
            const owedLabel =
              owed > 0
                ? `Owes ${formatMoney(owed, sub.currency)}`
                : owed < 0
                ? `Owed ${formatMoney(Math.abs(owed), sub.currency)}`
                : null;

            return (
              <li key={m.userId}>
                <Card
                  size="sm"
                  className={cn(isLeftUnsettled && "opacity-60 bg-muted/30")}
                >
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
                        {isLeftUnsettled && (
                          <Badge variant="outline" className="text-[10px]">
                            Left {m.leftAt} · {owedLabel}
                          </Badge>
                        )}
                      </div>
                      {m.email ? (
                        <p className="text-[12px] text-muted-foreground truncate">
                          {m.email}
                        </p>
                      ) : (
                        <p className="text-[12px] text-muted-foreground">
                          Joined {m.addedAt}
                        </p>
                      )}
                    </div>
                    {canEditAddedAt && (
                      <button
                        type="button"
                        disabled={busy}
                        title="Edit join date"
                        aria-label="Edit join date"
                        onClick={() => openEditAddedAt(m)}
                        className="shrink-0 size-11 md:size-8 rounded-md flex items-center justify-center cursor-pointer disabled:opacity-50 text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06]"
                      >
                        <CalendarDays className="size-3.5" />
                      </button>
                    )}
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
                          "shrink-0 size-11 md:size-8 rounded-md flex items-center justify-center cursor-pointer disabled:opacity-50 " +
                          (confirmKickId === m.userId
                            ? "text-white bg-destructive hover:bg-destructive/90"
                            : "text-muted-foreground hover:text-destructive hover:bg-destructive/[0.08]")
                        }
                      >
                        <UserMinus className="size-3.5" />
                      </button>
                    )}
                  </CardContent>
                  {editAddedAtId === m.userId && (
                    <CardContent className="border-t pt-3 flex flex-col gap-2">
                      <Label htmlFor={`addedAt-${m.userId}`} className="text-[12px] text-muted-foreground">
                        Joined on (any change retro-recomputes bills)
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id={`addedAt-${m.userId}`}
                          type="date"
                          value={editAddedAtValue}
                          onChange={(e) => setEditAddedAtValue(e.target.value)}
                          min={sub.startDate}
                          max={new Date().toISOString().slice(0, 10)}
                          className="flex-1"
                        />
                        <Button
                          size="sm"
                          onClick={() => saveEditAddedAt(m.userId)}
                          disabled={busy}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={cancelEditAddedAt}
                          disabled={busy}
                        >
                          Cancel
                        </Button>
                      </div>
                      {editAddedAtError && (
                        <p className="text-[12px] text-destructive">
                          {editAddedAtError}
                        </p>
                      )}
                    </CardContent>
                  )}
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

      {iconPickerOpen && (
        <IconPicker
          currentLogo={sub.logo}
          onSelect={(name) => void handleChangeLogo(name)}
          onReset={() => void handleChangeLogo(null)}
          onClose={() => setIconPickerOpen(false)}
        />
      )}
    </div>
  );
}
