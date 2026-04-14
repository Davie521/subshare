"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";
import { api } from "@/lib/api-client";
import { UserAvatar } from "@/components/user-avatar";

type Friend = {
  userId: number;
  displayName: string;
  email?: string;
  since: string;
};

function relativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays < 1) return "today";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function FriendsPage() {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api.friends().then((res) => {
      if (res.data) {
        setFriends(res.data);
        setLoadError(null);
      } else if (res.status === 401) {
        window.location.assign("/login");
      } else {
        setLoadError(res.error || "Failed to load");
      }
    });
  }, []);

  if (loadError && !friends) {
    return (
      <div className="max-w-md space-y-4">
        <h1 className="text-[24px] font-bold tracking-[-0.022em]">
          Couldn&apos;t load friends
        </h1>
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Button onClick={() => window.location.reload()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-xl">
      <header className="space-y-1.5">
        <p className="text-[13px] font-medium text-muted-foreground">Social</p>
        <h1 className="text-[32px] font-bold leading-tight tracking-[-0.022em]">
          Friends
        </h1>
        <p className="text-[14px] text-muted-foreground max-w-md">
          Everyone you&apos;ve been added to — or have added to — a subscription.
        </p>
      </header>

      {friends === null ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      ) : friends.length === 0 ? (
        <Card className="border-dashed bg-muted/30 shadow-none">
          <CardContent className="py-14 flex flex-col items-center gap-2.5 text-center">
            <div className="size-9 rounded-full bg-[var(--accent)] flex items-center justify-center">
              <Users className="size-[16px] text-[var(--accent-foreground)]" />
            </div>
            <p className="text-sm font-medium">No friends yet</p>
            <p className="text-[13px] text-muted-foreground max-w-[28ch]">
              Adding someone to a shared subscription connects you here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {friends.map((f) => {
            return (
              <li key={f.userId}>
                <Card size="sm">
                  <CardContent className="flex items-center gap-3">
                    <UserAvatar name={f.displayName} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">
                        {f.displayName}
                      </p>
                      {f.email ? (
                        <p className="text-[13px] text-muted-foreground truncate">
                          {f.email}
                        </p>
                      ) : (
                        <p className="text-[13px] text-muted-foreground">
                          Hidden email
                        </p>
                      )}
                    </div>
                    <p className="text-[12px] text-muted-foreground shrink-0">
                      since {relativeDate(f.since)}
                    </p>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
