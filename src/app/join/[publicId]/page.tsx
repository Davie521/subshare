"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

export default function JoinPage() {
  const params = useParams();
  const router = useRouter();
  const rawPublicId = params.publicId as string;
  const publicId = /^[A-Za-z0-9_-]{1,32}$/.test(rawPublicId) ? rawPublicId : "";
  const [status, setStatus] = useState<"loading" | "ready" | "joining" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!publicId) {
      router.replace("/login");
      return;
    }
    api.me().then((res) => {
      if (res.data) {
        setStatus("ready");
        return;
      }
      if (res.status === 401) {
        router.push(`/login?redirect=/join/${publicId}`);
        return;
      }
      setError(res.error || "Couldn't verify session");
      setStatus("error");
    });
  }, [publicId, router]);

  async function handleJoin() {
    setStatus("joining");
    const res = await api.joinGroup(publicId);
    if (res.error) {
      setError(res.error);
      setStatus("error");
      return;
    }
    router.push("/groups");
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardContent className="pt-6 text-center space-y-4">
          <h1 className="text-xl font-semibold">Join Group</h1>
          <p className="text-sm text-muted-foreground">
            You&apos;ve been invited to join a subscription sharing group.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            className="w-full cursor-pointer"
            onClick={handleJoin}
            disabled={status === "joining"}
          >
            {status === "joining" ? "Joining..." : "Join Group"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
