"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Copy, Plus, Users, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { BrandIcon } from "@/components/brand-icon";

type GroupDetail = {
  id: number;
  name: string;
  publicId: string;
  createdBy: number;
  members: Array<{ userId: number; name: string }>;
  subscriptions: Array<{
    id: number;
    name: string;
    price: number;
    currency: string;
  }>;
};

export default function GroupDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.getGroup(Number(params.id)).then((res) => {
      if (res.data) setGroup(res.data);
    });
  }, [params.id]);

  if (!group) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 bg-muted rounded" />
        <div className="h-32 bg-muted rounded-lg" />
      </div>
    );
  }

  function copyInviteLink() {
    const url = `${window.location.origin}/join/${group!.publicId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDelete() {
    if (!confirm("Delete this group? This cannot be undone.")) return;
    const res = await api.deleteGroup(group!.id);
    if (res.error) {
      alert(res.error);
      return;
    }
    router.push("/groups");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{group.name}</h1>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Delete group"
          className="cursor-pointer text-muted-foreground"
          onClick={handleDelete}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Invite */}
      <Button
        variant="outline"
        className="w-full cursor-pointer"
        onClick={copyInviteLink}
      >
        <Copy className="h-4 w-4 mr-2" />
        {copied ? "Copied!" : "Copy invite link"}
      </Button>

      {/* Members */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" />
          Members ({group.members.length})
        </h2>
        <div className="flex flex-wrap gap-2">
          {group.members.map((m) => (
            <Badge key={m.userId} variant="secondary">
              {m.name}
              {m.userId === group.createdBy && " (payer)"}
            </Badge>
          ))}
        </div>
      </div>

      <Separator />

      {/* Subscriptions */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Subscriptions
          </h2>
          <Link href={`/subscriptions/new?groupId=${group.id}`}>
            <Button size="sm" variant="outline" className="cursor-pointer">
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add
            </Button>
          </Link>
        </div>

        {group.subscriptions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No subscriptions yet
          </p>
        ) : (
          group.subscriptions.map((sub) => (
            <Card key={sub.id}>
              <CardContent className="pt-4 pb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <BrandIcon name={sub.name} size={24} />
                  <p className="font-medium">{sub.name}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium tabular-nums">
                    {formatMoney(sub.price, sub.currency)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatMoney(
                      Math.floor(sub.price / group.members.length),
                      sub.currency
                    )}
                    /person
                  </p>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
