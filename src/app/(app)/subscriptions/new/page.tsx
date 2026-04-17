"use client";

import { useState, useEffect, Suspense, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Users, Plus, Search, ArrowLeft, Pencil } from "lucide-react";
import { api, type SubscriptionTag } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { BrandIcon } from "@/components/brand-icon";
import { TagEditor } from "@/components/tag-editor";
import { POPULAR_SERVICES, CATEGORIES, type ServiceTemplate } from "@/lib/popular-services";
import { formatMoney } from "@/lib/format";

export default function NewSubscriptionPage() {
  return (
    <Suspense fallback={<div className="h-64 bg-muted rounded-lg animate-pulse" />}>
      <NewSubscriptionFlow />
    </Suspense>
  );
}

type Step = "pick" | "form";

function NewSubscriptionFlow() {
  const [step, setStep] = useState<Step>("pick");
  const [selected, setSelected] = useState<ServiceTemplate | null>(null);
  const [customName, setCustomName] = useState("");

  function handleSelectService(service: ServiceTemplate) {
    setSelected(service);
    setCustomName("");
    setStep("form");
  }

  function handleCustom(initialName = "") {
    setSelected(null);
    setCustomName(initialName);
    setStep("form");
  }

  if (step === "pick") {
    return <ServicePicker onSelect={handleSelectService} onCustom={handleCustom} />;
  }

  return (
    <SubscriptionForm
      service={selected}
      initialName={customName}
      onBack={() => setStep("pick")}
    />
  );
}

// --- Step 1: Service Picker ---

function ServicePicker({
  onSelect,
  onCustom,
}: {
  onSelect: (s: ServiceTemplate) => void;
  onCustom: (initialName?: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = POPULAR_SERVICES;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q)
      );
    }
    if (activeCategory) {
      list = list.filter((s) => s.category === activeCategory);
    }
    return list;
  }, [search, activeCategory]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">New Subscription</h1>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search services..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>

      {/* Category chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
        <button
          onClick={() => setActiveCategory(null)}
          className="cursor-pointer"
        >
          <Badge
            variant={activeCategory === null ? "default" : "secondary"}
            className="whitespace-nowrap cursor-pointer px-2.5 py-1"
          >
            All
          </Badge>
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
            className="cursor-pointer"
          >
            <Badge
              variant={activeCategory === cat ? "default" : "secondary"}
              className="whitespace-nowrap cursor-pointer px-2.5 py-1"
            >
              {cat}
            </Badge>
          </button>
        ))}
      </div>

      {/* Service grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
        {filtered.map((service) => (
          <button
            key={`${service.name}-${service.category}`}
            onClick={() => onSelect(service)}
            className="cursor-pointer text-left"
          >
            <Card className="hover:bg-muted/50 transition-colors duration-150 cursor-pointer h-full">
              <CardContent className="pt-3 pb-3 px-3 flex items-center gap-2.5">
                <BrandIcon name={service.name} size={24} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{service.name}</p>
                  {service.defaultPrice && (
                    <p className="text-[11px] text-muted-foreground">
                      {formatMoney(service.defaultPrice, service.defaultCurrency || "USD")}/mo
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      {filtered.length === 0 && search && (
        <div className="flex flex-col items-center gap-3 py-6">
          <p className="text-sm text-muted-foreground">
            No match for &quot;{search}&quot;
          </p>
          <Button
            className="cursor-pointer"
            onClick={() => onCustom(search)}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add &quot;{search}&quot; as custom
          </Button>
        </div>
      )}

      {/* Custom entry */}
      <Separator />
      <Button
        variant="outline"
        className="w-full cursor-pointer"
        onClick={() => onCustom()}
      >
        <Pencil className="h-4 w-4 mr-2" />
        Add custom subscription
      </Button>
    </div>
  );
}

// --- Step 2: Subscription Form ---

function SubscriptionForm({
  service,
  initialName,
  onBack,
}: {
  service: ServiceTemplate | null;
  initialName?: string;
  onBack: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: service?.name || initialName || "",
    price: service?.defaultPrice ? (service.defaultPrice / 100).toFixed(2) : "",
    currency: service?.defaultCurrency || "CNY",
    nextPayment: new Date().toISOString().split("T")[0],
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Sharing mode + member selection
  const [mode, setMode] = useState<"personal" | "shared">("personal");
  const [friends, setFriends] = useState<Array<{ userId: number; displayName: string }>>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);
  const [selfId, setSelfId] = useState<number | null>(null);
  const [payerId, setPayerId] = useState<number | null>(null);
  const [refundPolicy, setRefundPolicy] = useState<
    "payer_absorbs" | "redistribute"
  >("payer_absorbs");
  const [circles, setCircles] = useState<Array<{ id: number; name: string; memberIds: number[]; defaultPayerId: number | null }>>([]);
  const [tags, setTags] = useState<SubscriptionTag[]>([]);

  useEffect(() => {
    void api.me().then((r) => {
      if (r.data) {
        setSelfId(r.data.id);
        setPayerId(r.data.id);
      }
    });
    void api.friends().then((r) => {
      if (r.data) {
        setFriends(
          r.data.map((f) => ({
            userId: f.userId,
            displayName: f.displayName,
          }))
        );
      }
    });
    void api.circles().then((r) => {
      if (r.data) setCircles(r.data);
    });
  }, []);

  function applyCircle(circleId: number) {
    const c = circles.find((x) => x.id === circleId);
    if (!c || selfId === null) return;
    setMode("shared");
    setSelectedMemberIds(c.memberIds.filter((id) => id !== selfId));
    if (c.defaultPayerId !== null) setPayerId(c.defaultPayerId);
    else setPayerId(selfId);
  }

  function toggleMember(userId: number) {
    setSelectedMemberIds((prev) =>
      prev.includes(userId) ? prev.filter((x) => x !== userId) : [...prev, userId]
    );
    // If removing current payer, reset payer to self.
    if (payerId === userId) setPayerId(selfId);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const price = Math.round(parseFloat(form.price) * 100);
    if (!form.name.trim() || isNaN(price) || price <= 0) {
      setError("Please fill in name and a valid price");
      return;
    }
    // Shared mode with zero picked members is intentionally allowed — the
    // user will invite others via an Invite link from the subscription
    // detail page after creation. This is the standard path for users
    // whose friend list is still empty.

    setSubmitting(true);
    setError("");

    const res = await api.createSubscription({
      name: form.name.trim(),
      price,
      currency: form.currency,
      nextPayment: form.nextPayment,
      ...(tags.length > 0 ? { tags } : {}),
      ...(mode === "shared"
        ? {
            members: selectedMemberIds,
            payerId: payerId ?? undefined,
            refundPolicy,
          }
        : {}),
    });

    if (res.error) {
      setError(res.error);
      setSubmitting(false);
      return;
    }

    router.push("/subscriptions");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Go back"
          className="cursor-pointer h-8 w-8"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <BrandIcon name={service?.name || form.name || "?"} size={24} />
          <h1 className="text-2xl font-semibold tracking-tight">
            {service ? service.name : form.name.trim() || "Custom Subscription"}
          </h1>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="e.g. Netflix"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus={!service}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="price">Price / month</Label>
                <Input
                  id="price"
                  type="number"
                  step="0.01"
                  placeholder="15.99"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  autoFocus={!!service}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="currency">Currency</Label>
                <select
                  id="currency"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm cursor-pointer"
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                >
                  <option value="CNY">CNY (¥)</option>
                  <option value="USD">USD ($)</option>
                  <option value="HKD">HKD (HK$)</option>
                  <option value="CAD">CAD (CA$)</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="JPY">JPY (¥)</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="nextPayment">Next payment date</Label>
              <Input
                id="nextPayment"
                type="date"
                value={form.nextPayment}
                onChange={(e) => setForm({ ...form, nextPayment: e.target.value })}
              />
            </div>

            <TagEditor tags={tags} onChange={setTags} />
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
                <span className="text-[11px] text-muted-foreground">Just for me</span>
              </button>
              <button
                type="button"
                onClick={() => setMode("shared")}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-4 rounded-lg border-2 cursor-pointer transition-all duration-150",
                  mode === "shared"
                    ? "border-foreground bg-foreground/5"
                    : "border-transparent bg-muted hover:bg-muted/80"
                )}
              >
                <Users className="h-5 w-5" />
                <span className="text-sm font-medium">Shared</span>
                <span className="text-[11px] text-muted-foreground">Split with friends</span>
              </button>
            </div>

            {mode === "shared" && (
              <div className="space-y-4 pt-2">
                <Separator />

                {/* Groups (circles) quick-pick */}
                {circles.length > 0 && (
                  <div className="space-y-2">
                    <Label>Pick a group</Label>
                    <p className="text-[12px] text-muted-foreground">
                      One tap to pre-fill members from a saved template.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {circles.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => applyCircle(c.id)}
                          className="cursor-pointer px-3 py-1.5 rounded-md border text-[13px] font-medium border-input bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]"
                        >
                          {c.name}{" "}
                          <span className="text-muted-foreground/70">
                            ({c.memberIds.length})
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Friends picker */}
                <div className="space-y-2">
                  <Label>Share with</Label>
                  <p className="text-[12px] text-muted-foreground leading-relaxed">
                    Pick existing friends to add now. To bring in new people —
                    even those not yet on SubShare — use the{" "}
                    <strong>Invite link</strong> button on the subscription
                    page after creating.
                  </p>
                  {friends.length === 0 ? (
                    <p className="text-[13px] font-medium text-muted-foreground">
                      No friends yet — create the subscription first, then
                      share the invite link.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {friends.map((f) => {
                        const selected = selectedMemberIds.includes(f.userId);
                        return (
                          <button
                            key={f.userId}
                            type="button"
                            onClick={() => toggleMember(f.userId)}
                            className={cn(
                              "cursor-pointer px-3 py-1.5 rounded-full text-[13px] font-medium border transition-colors",
                              selected
                                ? "border-transparent text-white"
                                : "border-input bg-transparent text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]"
                            )}
                            style={
                              selected
                                ? { backgroundColor: "var(--brand)" }
                                : undefined
                            }
                          >
                            {f.displayName}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Payer picker — only makes sense when at least one member */}
                {selectedMemberIds.length > 0 && selfId !== null && (
                  <div className="space-y-2">
                    <Label htmlFor="payer">Payer</Label>
                    <select
                      id="payer"
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm cursor-pointer"
                      value={payerId ?? selfId}
                      onChange={(e) => setPayerId(Number(e.target.value))}
                    >
                      <option value={selfId}>You</option>
                      {friends
                        .filter((f) => selectedMemberIds.includes(f.userId))
                        .map((f) => (
                          <option key={f.userId} value={f.userId}>
                            {f.displayName}
                          </option>
                        ))}
                    </select>
                    <p className="text-[12px] text-muted-foreground">
                      The payer&apos;s card is charged; everyone else owes
                      their share.
                    </p>
                  </div>
                )}

                {/* Refund policy — what happens when someone leaves mid-month */}
                {selectedMemberIds.length > 0 && (
                  <div className="space-y-2">
                    <Label>If someone leaves mid-month</Label>
                    <div className="grid gap-2">
                      <button
                        type="button"
                        onClick={() => setRefundPolicy("payer_absorbs")}
                        className={cn(
                          "cursor-pointer text-left rounded-md border p-3 transition-colors",
                          refundPolicy === "payer_absorbs"
                            ? "border-foreground bg-foreground/5"
                            : "border-input hover:bg-foreground/[0.03]"
                        )}
                      >
                        <p className="text-[13px] font-semibold">
                          Payer absorbs the difference
                        </p>
                        <p className="text-[12px] text-muted-foreground">
                          The leaver pays only for the days they used; the
                          payer collects less. Other members unchanged.
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setRefundPolicy("redistribute")}
                        className={cn(
                          "cursor-pointer text-left rounded-md border p-3 transition-colors",
                          refundPolicy === "redistribute"
                            ? "border-foreground bg-foreground/5"
                            : "border-input hover:bg-foreground/[0.03]"
                        )}
                      >
                        <p className="text-[13px] font-semibold">
                          Split the difference among remaining members
                        </p>
                        <p className="text-[12px] text-muted-foreground">
                          Other unpaid members&apos; bills go up so the
                          payer doesn&apos;t lose any money.
                        </p>
                      </button>
                    </div>
                  </div>
                )}

                {/* Preview */}
                {selectedMemberIds.length > 0 &&
                  form.price &&
                  !isNaN(parseFloat(form.price)) && (
                    <div className="rounded-md bg-muted/50 px-3 py-2 text-[12px] text-muted-foreground">
                      Per person:{" "}
                      <span className="font-semibold text-foreground tabular-nums">
                        {formatMoney(
                          Math.floor(
                            (parseFloat(form.price) * 100) /
                              (selectedMemberIds.length + 1)
                          ),
                          form.currency
                        )}
                      </span>{" "}
                      / month
                    </div>
                  )}
              </div>
            )}
          </CardContent>
        </Card>

        {error && <p className="text-sm text-destructive px-1">{error}</p>}

        <Button type="submit" className="w-full cursor-pointer" disabled={submitting}>
          {submitting ? "Creating..." : "Add Subscription"}
        </Button>
      </form>
    </div>
  );
}

function CreditCardIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <line x1="2" x2="22" y1="10" y2="10" />
    </svg>
  );
}
