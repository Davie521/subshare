"use client";

import Link from "next/link";
import { Logo } from "@/components/logo";

export function MobileHeader() {
  return (
    <header className="lg:hidden flex items-center h-14 px-4 border-b bg-background/90 backdrop-blur-md sticky top-0 z-40">
      <Link href="/dashboard" className="cursor-pointer transition-opacity hover:opacity-80">
        <Logo size={22} />
      </Link>
    </header>
  );
}
