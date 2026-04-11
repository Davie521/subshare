"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<{
    name: string;
    email: string;
    preferredCurrency: string;
  } | null>(null);

  useEffect(() => {
    api.me().then((res) => {
      if (res.error) {
        router.push("/login");
        return;
      }
      if (res.data) setUser(res.data);
    });
  }, [router]);

  if (!user) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-32 bg-muted rounded" />
        <div className="h-32 bg-muted rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-1">
            <Label className="text-muted-foreground">Name</Label>
            <p className="font-medium">{user.name}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground">Email</Label>
            <p className="font-medium">{user.email}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground">Currency</Label>
            <p className="font-medium">{user.preferredCurrency}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
