"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MobileHeader() {
  return (
    <header className="lg:hidden flex items-center justify-between h-14 px-4 border-b bg-background/95 backdrop-blur-sm sticky top-0 z-40">
      <Link href="/dashboard" className="flex items-center gap-2 cursor-pointer">
        <div className="h-6 w-6 rounded-md bg-foreground flex items-center justify-center">
          <span className="text-background text-[10px] font-bold">S</span>
        </div>
        <span className="font-semibold tracking-tight">SubShare</span>
      </Link>
      <Link href="/subscriptions/new">
        <Button size="icon" variant="ghost" className="cursor-pointer h-8 w-8">
          <Plus className="h-4 w-4" />
        </Button>
      </Link>
    </header>
  );
}
