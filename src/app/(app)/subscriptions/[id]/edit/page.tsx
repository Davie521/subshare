"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { BrandIcon } from "@/components/brand-icon";

export default function EditSubscriptionPage() {
  const params = useParams();
  const router = useRouter();
  const subId = Number(params.id);

  const [form, setForm] = useState({
    name: "",
    price: "",
    nextPayment: "",
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/subscriptions/${subId}`)
      .then((r) => r.json())
      .then((sub) => {
        if (sub.error) {
          router.push("/subscriptions");
          return;
        }
        setForm({
          name: sub.name,
          price: (sub.price / 100).toFixed(2),
          nextPayment: sub.nextPayment,
        });
        setLoading(false);
      });
  }, [subId, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const price = Math.round(parseFloat(form.price) * 100);
    if (!form.name.trim() || isNaN(price) || price <= 0) {
      setError("Please fill in name and a valid price");
      return;
    }

    setSubmitting(true);
    setError("");

    const res = await api.updateSubscription(subId, {
      name: form.name.trim(),
      price,
      nextPayment: form.nextPayment,
    });

    if (res.error) {
      setError(res.error);
      setSubmitting(false);
      return;
    }

    router.push("/subscriptions");
  }

  async function handleDelete() {
    if (!confirm("Delete this subscription?")) return;
    const res = await api.deleteSubscription(subId);
    if (res.error) {
      alert(res.error);
      return;
    }
    router.push("/subscriptions");
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 bg-muted rounded" />
        <div className="h-64 bg-muted rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="cursor-pointer h-8 w-8"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <BrandIcon name={form.name} size={24} />
          <h1 className="text-2xl font-semibold tracking-tight">Edit</h1>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="cursor-pointer text-destructive"
          onClick={handleDelete}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="price">Price / month</Label>
              <Input
                id="price"
                type="number"
                step="0.01"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
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

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full cursor-pointer" disabled={submitting}>
              {submitting ? "Saving..." : "Save Changes"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
