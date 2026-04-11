"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";

export default function NewSubscriptionPage() {
  return (
    <Suspense fallback={<div className="h-64 bg-muted rounded-lg animate-pulse" />}>
      <NewSubscriptionForm />
    </Suspense>
  );
}

function NewSubscriptionForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const groupId = searchParams.get("groupId");

  const [form, setForm] = useState({
    name: "",
    price: "",
    currency: "CNY",
    nextPayment: new Date().toISOString().split("T")[0],
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [groups, setGroups] = useState<Array<{ id: number; name: string }>>([]);
  const [selectedGroupId, setSelectedGroupId] = useState(
    groupId ? Number(groupId) : 0
  );

  useEffect(() => {
    api.getGroups().then((res) => {
      if (res.data) setGroups(res.data);
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const price = Math.round(parseFloat(form.price) * 100);
    if (!form.name.trim() || isNaN(price) || price <= 0) {
      setError("Please fill in name and a valid price");
      return;
    }

    setSubmitting(true);
    setError("");

    const res = await api.createSubscription({
      name: form.name.trim(),
      price,
      currency: form.currency,
      nextPayment: form.nextPayment,
      groupId: selectedGroupId || undefined,
    });

    if (res.error) {
      setError(res.error);
      setSubmitting(false);
      return;
    }

    router.push(selectedGroupId ? `/groups/${selectedGroupId}` : "/subscriptions");
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        New Subscription
      </h1>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="e.g. Netflix"
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
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
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

            <div className="space-y-2">
              <Label htmlFor="group">Group (optional)</Label>
              <select
                id="group"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={selectedGroupId}
                onChange={(e) => setSelectedGroupId(Number(e.target.value))}
              >
                <option value={0}>Personal (no group)</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              type="submit"
              className="w-full cursor-pointer"
              disabled={submitting}
            >
              {submitting ? "Creating..." : "Add Subscription"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
