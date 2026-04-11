"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, CreditCard, Users, Settings, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/subscriptions", label: "Subscriptions", icon: CreditCard },
  { href: "/groups", label: "Groups", icon: Users },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex lg:flex-col lg:w-60 lg:border-r lg:bg-muted/30 lg:fixed lg:inset-y-0">
      {/* Logo */}
      <div className="flex items-center h-14 px-5">
        <Link href="/dashboard" className="flex items-center gap-2 cursor-pointer">
          <div className="h-7 w-7 rounded-lg bg-foreground flex items-center justify-center">
            <span className="text-background text-xs font-bold">S</span>
          </div>
          <span className="font-semibold text-lg tracking-tight">SubShare</span>
        </Link>
      </div>

      <Separator />

      {/* Quick action */}
      <div className="px-3 pt-4 pb-2">
        <Link href="/subscriptions/new">
          <Button className="w-full cursor-pointer justify-start gap-2" size="sm">
            <Plus className="h-4 w-4" />
            New Subscription
          </Button>
        </Link>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-3 py-2 space-y-1">
        {navItems.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors duration-150",
                active
                  ? "bg-foreground/5 text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
              )}
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom settings */}
      <div className="px-3 pb-4">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors duration-150",
            pathname.startsWith("/settings")
              ? "bg-foreground/5 text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
          )}
        >
          <Settings className="h-4 w-4 flex-shrink-0" />
          Settings
        </Link>
      </div>
    </aside>
  );
}
