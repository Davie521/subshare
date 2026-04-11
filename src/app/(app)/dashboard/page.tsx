"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Check, CreditCard, Users, ArrowRight } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";

type Dashboard = {
  monthlyTotal: number;
  pendingBills: Array<{
    id: number;
    subscriptionName: string;
    amount: number;
    currency: string;
  }>;
  subscriptions: Array<{
    name: string;
    price: number;
    currency: string;
    memberCount: number;
  }>;
};

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.dashboard().then((res) => {
      if (res.error) {
        router.push("/login");
        return;
      }
      setData(res.data!);
      setLoading(false);
    });
  }, [router]);

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="h-28 bg-muted rounded-lg animate-pulse" />
          <div className="h-28 bg-muted rounded-lg animate-pulse" />
          <div className="h-28 bg-muted rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  async function handleMarkPaid(billId: number) {
    await api.markPaid(billId);
    const res = await api.dashboard();
    if (res.data) setData(res.data);
  }

  const personalSubs = data.subscriptions.filter((s) => s.memberCount === 1);
  const sharedSubs = data.subscriptions.filter((s) => s.memberCount > 1);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>

      {/* Stats row */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardContent className="pt-5 pb-5">
            <p className="text-sm text-muted-foreground">Monthly spending</p>
            <p className="text-3xl font-bold tracking-tight mt-1">
              {formatMoney(data.monthlyTotal)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-5">
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <CreditCard className="h-3.5 w-3.5" />
              Subscriptions
            </p>
            <p className="text-3xl font-bold tracking-tight mt-1">
              {data.subscriptions.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-5">
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              Pending bills
            </p>
            <p className="text-3xl font-bold tracking-tight mt-1">
              {data.pendingBills.length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Two-column layout on desktop */}
      <div className="grid gap-8 lg:grid-cols-2">
        {/* Pending bills */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Pending
            </h2>
          </div>
          {data.pendingBills.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                All caught up
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {data.pendingBills.map((bill) => (
                <Card key={bill.id}>
                  <CardContent className="pt-4 pb-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{bill.subscriptionName}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatMoney(bill.amount, bill.currency)}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="cursor-pointer"
                      onClick={() => handleMarkPaid(bill.id)}
                    >
                      <Check className="h-3.5 w-3.5 mr-1" />
                      Paid
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Subscriptions breakdown */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Subscriptions
            </h2>
            <Link
              href="/subscriptions"
              className="text-xs text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-1 transition-colors"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="space-y-2">
            {personalSubs.map((sub, i) => (
              <Card key={`p-${i}`}>
                <CardContent className="pt-3 pb-3 flex items-center justify-between">
                  <p className="font-medium text-sm">{sub.name}</p>
                  <p className="text-sm tabular-nums">
                    {formatMoney(sub.price, sub.currency)}
                    <span className="text-muted-foreground text-xs">/mo</span>
                  </p>
                </CardContent>
              </Card>
            ))}

            {sharedSubs.length > 0 && personalSubs.length > 0 && (
              <Separator className="my-2" />
            )}

            {sharedSubs.map((sub, i) => (
              <Card key={`s-${i}`}>
                <CardContent className="pt-3 pb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">{sub.name}</p>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {sub.memberCount}p
                    </Badge>
                  </div>
                  <p className="text-sm tabular-nums">
                    {formatMoney(
                      Math.floor(sub.price / sub.memberCount),
                      sub.currency
                    )}
                    <span className="text-muted-foreground text-xs">/mo</span>
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
