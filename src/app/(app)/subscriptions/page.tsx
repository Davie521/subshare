"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { BrandIcon } from "@/components/brand-icon";

type Sub = {
  id: number;
  name: string;
  price: number;
  currency: string;
  nextPayment: string;
  groupId: number | null;
  memberCount: number;
  inactive: number;
};

export default function SubscriptionsPage() {
  const [subs, setSubs] = useState<Sub[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getSubscriptions().then((res) => {
      if (res.data) setSubs(res.data);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 bg-muted rounded" />
        <div className="h-16 bg-muted rounded-lg" />
        <div className="h-16 bg-muted rounded-lg" />
      </div>
    );
  }

  const personal = subs.filter((s) => !s.groupId && !s.inactive);
  const shared = subs.filter((s) => s.groupId && !s.inactive);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Subscriptions</h1>
        <Link href="/subscriptions/new">
          <Button size="sm" className="cursor-pointer">
            <Plus className="h-4 w-4 mr-1" />
            New
          </Button>
        </Link>
      </div>

      {personal.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Personal
          </h2>
          {personal.map((sub) => (
            <SubCard key={sub.id} sub={sub} />
          ))}
        </div>
      )}

      {shared.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Shared
          </h2>
          {shared.map((sub) => (
            <SubCard key={sub.id} sub={sub} />
          ))}
        </div>
      )}

      {subs.length === 0 && (
        <p className="text-muted-foreground text-sm py-8 text-center">
          No subscriptions yet
        </p>
      )}
    </div>
  );
}

function SubCard({ sub }: { sub: Sub }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BrandIcon name={sub.name} size={24} />
          <div>
          <p className="font-medium">{sub.name}</p>
          <div className="flex items-center gap-2 mt-1">
            {sub.memberCount > 1 && (
              <Badge variant="secondary" className="text-xs">
                {sub.memberCount} people
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              Next: {sub.nextPayment}
            </span>
          </div>
        </div>
        </div>
        <p className="text-sm font-medium tabular-nums">
          {formatMoney(
            sub.memberCount > 1
              ? Math.floor(sub.price / sub.memberCount)
              : sub.price,
            sub.currency
          )}
          <span className="text-muted-foreground">/mo</span>
        </p>
      </CardContent>
    </Card>
  );
}
