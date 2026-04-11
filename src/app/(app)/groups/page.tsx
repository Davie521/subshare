"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, ChevronRight } from "lucide-react";
import { api } from "@/lib/api-client";

type Group = { id: number; name: string; publicId: string; createdBy: number };

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getGroups().then((res) => {
      if (res.data) setGroups(res.data);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-32 bg-muted rounded" />
        <div className="h-16 bg-muted rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Groups</h1>
        <Link href="/groups/new">
          <Button size="sm" className="cursor-pointer">
            <Plus className="h-4 w-4 mr-1" />
            New
          </Button>
        </Link>
      </div>

      {groups.length === 0 ? (
        <p className="text-muted-foreground text-sm py-8 text-center">
          No groups yet. Create one to start sharing subscriptions.
        </p>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => (
            <Link key={group.id} href={`/groups/${group.id}`}>
              <Card className="cursor-pointer hover:bg-muted/50 transition-colors duration-150">
                <CardContent className="pt-4 pb-4 flex items-center justify-between">
                  <p className="font-medium">{group.name}</p>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
