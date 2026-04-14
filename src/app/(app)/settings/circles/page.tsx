"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Plus, Trash2, Users, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { UserAvatar } from "@/components/user-avatar";

type Circle = {
  id: number;
  name: string;
  ownerUserId: number;
  defaultPayerId: number | null;
  memberIds: number[];
  createdAt: string;
};

type Friend = {
  userId: number;
  displayName: string;
};

export default function CirclesPage() {
  const [circles, setCircles] = useState<Circle[] | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selfId, setSelfId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Circle | null>(null);
  const [creating, setCreating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    const [c, f, me] = await Promise.all([
      api.circles(),
      api.friends(),
      api.me(),
    ]);
    if (c.data) setCircles(c.data);
    else if (c.status === 401) {
      window.location.assign("/login");
      return;
    } else setLoadError(c.error || "Failed to load");
    if (f.data)
      setFriends(
        f.data.map((x) => ({ userId: x.userId, displayName: x.displayName }))
      );
    if (me.data) setSelfId(me.data.id);
  }

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loadError && !circles) {
    return (
      <div className="max-w-md space-y-4">
        <h1 className="text-[24px] font-bold tracking-[-0.022em]">
          Couldn&apos;t load groups
        </h1>
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Button onClick={load}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <ArrowLeft className="size-3.5" />
          Settings
        </Link>
      </div>
      <header className="space-y-1.5">
        <h1 className="text-[32px] font-bold leading-tight tracking-[-0.022em]">
          Groups
        </h1>
        <p className="text-[14px] text-muted-foreground max-w-md">
          Save frequent group-of-people as a template. When you create a new
          subscription you can pick a group to pre-fill the members.
        </p>
      </header>

      <div>
        <Button
          size="sm"
          onClick={() => setCreating(true)}
          className="cursor-pointer gap-1.5"
        >
          <Plus className="size-3.5" />
          New group
        </Button>
      </div>

      {circles === null ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      ) : circles.length === 0 ? (
        <Card className="border-dashed bg-muted/30 shadow-none">
          <CardContent className="py-14 flex flex-col items-center gap-2.5 text-center">
            <div className="size-9 rounded-full bg-[var(--accent)] flex items-center justify-center">
              <Users className="size-[16px] text-[var(--accent-foreground)]" />
            </div>
            <p className="text-sm font-medium">No groups yet</p>
            <p className="text-[13px] text-muted-foreground max-w-[34ch]">
              Create one to speed up new subscription setup when the same
              people share everything.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {circles.map((c) => (
            <li key={c.id}>
              <Card
                size="sm"
                className="cursor-pointer hover:bg-foreground/[0.02] dark:hover:bg-white/[0.03]"
                onClick={() => setEditing(c)}
              >
                <CardContent className="flex items-center gap-3">
                  <div className="size-10 rounded-full bg-[var(--accent)] flex items-center justify-center shrink-0">
                    <Users className="size-4 text-[var(--accent-foreground)]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{c.name}</p>
                    <p className="text-[13px] text-muted-foreground">
                      {c.memberIds.length}{" "}
                      {c.memberIds.length === 1 ? "member" : "members"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && selfId !== null && (
        <CircleEditor
          circle={editing}
          selfId={selfId}
          friends={friends}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function CircleEditor({
  circle,
  selfId,
  friends,
  onClose,
  onSaved,
}: {
  circle: Circle | null;
  selfId: number;
  friends: Friend[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(circle?.name ?? "");
  const [memberIds, setMemberIds] = useState<number[]>(
    circle ? circle.memberIds.filter((id) => id !== selfId) : []
  );
  const [defaultPayerId, setDefaultPayerId] = useState<number | null>(
    circle?.defaultPayerId ?? null
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (saving) return;
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError("");
    const body = { name: name.trim(), memberIds, defaultPayerId };
    const res = circle
      ? await api.updateCircle(circle.id, body)
      : await api.createCircle(body);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onSaved();
  }

  async function remove() {
    if (!circle) return;
    if (!window.confirm(`Delete group "${circle.name}"?`)) return;
    const res = await api.deleteCircle(circle.id);
    if (res.error) {
      setError(res.error);
      return;
    }
    onSaved();
  }

  function toggleMember(id: number) {
    setMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    if (defaultPayerId === id && !memberIds.includes(id)) {
      // added a member — payer still valid
    } else if (defaultPayerId === id) {
      // removed → reset default payer
      setDefaultPayerId(null);
    }
  }

  const payerCandidates = [selfId, ...memberIds];

  return (
    <div className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
      <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto">
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              {circle ? "Edit group" : "New group"}
            </h2>
            <button
              onClick={onClose}
              className="size-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-foreground/[0.04] cursor-pointer"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Family"
              maxLength={60}
            />
          </div>

          <div className="space-y-2">
            <Label>Members</Label>
            <p className="text-[12px] text-muted-foreground">
              You&apos;re always included. Pick friends to add.
            </p>
            {friends.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                No friends yet — add someone to a subscription first.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {friends.map((f) => {
                  const picked = memberIds.includes(f.userId);
                  return (
                    <button
                      key={f.userId}
                      type="button"
                      onClick={() => toggleMember(f.userId)}
                      className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-[13px] font-medium cursor-pointer transition-colors ${
                        picked
                          ? "bg-[var(--brand)]/10 border-[var(--brand)]/30 text-foreground"
                          : "border-transparent bg-muted/50 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <UserAvatar name={f.displayName} size="sm" />
                      {f.displayName}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="payer">Default payer</Label>
            <p className="text-[12px] text-muted-foreground">
              Who normally pays subscriptions in this group. Still editable
              per-subscription later.
            </p>
            <select
              id="payer"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={defaultPayerId ?? ""}
              onChange={(e) =>
                setDefaultPayerId(
                  e.target.value ? Number(e.target.value) : null
                )
              }
            >
              <option value="">— none —</option>
              {payerCandidates.map((id) => {
                const label =
                  id === selfId
                    ? "Me"
                    : friends.find((f) => f.userId === id)?.displayName ??
                      `User #${id}`;
                return (
                  <option key={id} value={id}>
                    {label}
                  </option>
                );
              })}
            </select>
          </div>

          {error && (
            <p className="text-[13px] text-[var(--brand)]">{error}</p>
          )}

          <div className="flex items-center justify-between pt-2">
            {circle ? (
              <Button
                variant="outline"
                size="sm"
                onClick={remove}
                className="cursor-pointer gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onClose}
                className="cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={save}
                disabled={saving || !name.trim()}
                className="cursor-pointer"
              >
                {saving ? "Saving…" : circle ? "Save" : "Create"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
