"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
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
      <div className="space-y-4 animate-pulse">
        <div className="h-24 bg-muted rounded-lg" />
        <div className="h-16 bg-muted rounded-lg" />
        <div className="h-16 bg-muted rounded-lg" />
      </div>
    );
  }

  async function handleMarkPaid(billId: number) {
    await api.markPaid(billId);
    const res = await api.dashboard();
    if (res.data) setData(res.data);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>

      {/* Monthly total */}
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Monthly spending</p>
          <p className="text-3xl font-bold tracking-tight mt-1">
            {formatMoney(data.monthlyTotal)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {data.subscriptions.length} subscription
            {data.subscriptions.length !== 1 ? "s" : ""}
          </p>
        </CardContent>
      </Card>

      {/* Pending bills */}
      {data.pendingBills.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Pending
          </h2>
          {data.pendingBills.map((bill) => (
            <Card key={bill.id}>
              <CardContent className="pt-4 pb-4 flex items-center justify-between">
                <div>
                  <p className="font-medium">{bill.subscriptionName}</p>
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
                  <Check className="h-4 w-4 mr-1" />
                  Paid
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Subscriptions overview */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Subscriptions
        </h2>
        {data.subscriptions.map((sub, i) => (
          <Card key={i}>
            <CardContent className="pt-4 pb-4 flex items-center justify-between">
              <div>
                <p className="font-medium">{sub.name}</p>
                {sub.memberCount > 1 && (
                  <Badge variant="secondary" className="text-xs mt-1">
                    {sub.memberCount} people
                  </Badge>
                )}
              </div>
              <p className="text-sm font-medium tabular-nums">
                {formatMoney(
                  Math.floor(sub.price / sub.memberCount),
                  sub.currency
                )}
                <span className="text-muted-foreground">/mo</span>
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
