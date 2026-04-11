"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Users, Plus, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export default function NewSubscriptionPage() {
  return (
    <Suspense
      fallback={<div className="h-64 bg-muted rounded-lg animate-pulse" />}
    >
      <NewSubscriptionForm />
    </Suspense>
  );
}

function NewSubscriptionForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetGroupId = searchParams.get("groupId");

  const [form, setForm] = useState({
    name: "",
    price: "",
    currency: "CNY",
    nextPayment: new Date().toISOString().split("T")[0],
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Group selection
  const [mode, setMode] = useState<"personal" | "group">(
    presetGroupId ? "group" : "personal"
  );
  const [groups, setGroups] = useState<Array<{ id: number; name: string }>>([]);
  const [selectedGroupId, setSelectedGroupId] = useState(
    presetGroupId ? Number(presetGroupId) : 0
  );

  // Inline group creation
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  useEffect(() => {
    api.getGroups().then((res) => {
      if (res.data) setGroups(res.data);
    });
  }, []);

  async function handleCreateGroupInline() {
    if (!newGroupName.trim()) return;
    const res = await api.createGroup(newGroupName.trim());
    if (res.error) return;
    // Refresh groups and select the new one
    const groupsRes = await api.getGroups();
    if (groupsRes.data) {
      setGroups(groupsRes.data);
      const newest = groupsRes.data[groupsRes.data.length - 1];
      if (newest) setSelectedGroupId(newest.id);
    }
    setCreatingGroup(false);
    setNewGroupName("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const price = Math.round(parseFloat(form.price) * 100);
    if (!form.name.trim() || isNaN(price) || price <= 0) {
      setError("Please fill in name and a valid price");
      return;
    }
    if (mode === "group" && !selectedGroupId) {
      setError("Please select or create a group");
      return;
    }

    setSubmitting(true);
    setError("");

    const res = await api.createSubscription({
      name: form.name.trim(),
      price,
      currency: form.currency,
      nextPayment: form.nextPayment,
      groupId: mode === "group" ? selectedGroupId : undefined,
    });

    if (res.error) {
      setError(res.error);
      setSubmitting(false);
      return;
    }

    router.push(
      mode === "group" ? `/groups/${selectedGroupId}` : "/subscriptions"
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        New Subscription
      </h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic info */}
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="e.g. Netflix, Spotify, ChatGPT"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="price">Price / month</Label>
                <Input
                  id="price"
                  type="number"
                  step="0.01"
                  placeholder="180.00"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="currency">Currency</Label>
                <select
                  id="currency"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm cursor-pointer"
                  value={form.currency}
                  onChange={(e) =>
                    setForm({ ...form, currency: e.target.value })
                  }
                >
                  <option value="CNY">CNY (¥)</option>
                  <option value="USD">USD ($)</option>
                  <option value="HKD">HKD (HK$)</option>
                  <option value="CAD">CAD (CA$)</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="JPY">JPY</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="nextPayment">Next payment date</Label>
              <Input
                id="nextPayment"
                type="date"
                value={form.nextPayment}
                onChange={(e) =>
                  setForm({ ...form, nextPayment: e.target.value })
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* Type toggle */}
        <Card>
          <CardContent className="pt-6 space-y-4">
            <Label>Type</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("personal")}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-4 rounded-lg border-2 cursor-pointer transition-all duration-150",
                  mode === "personal"
                    ? "border-foreground bg-foreground/5"
                    : "border-transparent bg-muted hover:bg-muted/80"
                )}
              >
                <CreditCardIcon className="h-5 w-5" />
                <span className="text-sm font-medium">Personal</span>
                <span className="text-[11px] text-muted-foreground">
                  Just for me
                </span>
              </button>
              <button
                type="button"
                onClick={() => setMode("group")}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-4 rounded-lg border-2 cursor-pointer transition-all duration-150",
                  mode === "group"
                    ? "border-foreground bg-foreground/5"
                    : "border-transparent bg-muted hover:bg-muted/80"
                )}
              >
                <Users className="h-5 w-5" />
                <span className="text-sm font-medium">Shared</span>
                <span className="text-[11px] text-muted-foreground">
                  Split with friends
                </span>
              </button>
            </div>

            {/* Group selection */}
            {mode === "group" && (
              <div className="space-y-3 pt-2">
                <Separator />
                <Label>Group</Label>

                {groups.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {groups.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => setSelectedGroupId(g.id)}
                        className="cursor-pointer"
                      >
                        <Badge
                          variant={
                            selectedGroupId === g.id ? "default" : "secondary"
                          }
                          className="cursor-pointer px-3 py-1.5 text-sm"
                        >
                          {g.name}
                        </Badge>
                      </button>
                    ))}
                  </div>
                )}

                {/* Inline create group */}
                {creatingGroup ? (
                  <div className="flex gap-2">
                    <Input
                      placeholder="Group name"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleCreateGroupInline();
                        }
                      }}
                      autoFocus
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="cursor-pointer"
                      onClick={handleCreateGroupInline}
                      disabled={!newGroupName.trim()}
                    >
                      Add
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="cursor-pointer flex-shrink-0"
                      onClick={() => {
                        setCreatingGroup(false);
                        setNewGroupName("");
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="cursor-pointer"
                    onClick={() => setCreatingGroup(true)}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    New group
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {error && (
          <p className="text-sm text-destructive px-1">{error}</p>
        )}

        <Button
          type="submit"
          className="w-full cursor-pointer"
          disabled={submitting}
        >
          {submitting ? "Creating..." : "Add Subscription"}
        </Button>
      </form>
    </div>
  );
}

function CreditCardIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <line x1="2" x2="22" y1="10" y2="10" />
    </svg>
  );
}
