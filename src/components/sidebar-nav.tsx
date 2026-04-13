"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, CreditCard, Users, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { UserMenu } from "@/components/user-menu";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/subscriptions", label: "Subscriptions", icon: CreditCard },
  { href: "/groups", label: "Groups", icon: Users },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex lg:flex-col lg:w-60 lg:border-r lg:bg-sidebar lg:text-sidebar-foreground lg:fixed lg:inset-y-0">
      {/* Logo */}
      <div className="flex items-center h-16 px-5">
        <Link href="/dashboard" className="cursor-pointer transition-opacity hover:opacity-80">
          <Logo size={28} />
        </Link>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-[14px] font-medium cursor-pointer transition-colors duration-150",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]"
              )}
            >
              <item.icon className="size-[16px] flex-shrink-0" strokeWidth={active ? 2.25 : 1.75} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Settings link */}
      <div className="px-3 pb-2">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-md text-[14px] font-medium cursor-pointer transition-colors duration-150",
            pathname.startsWith("/settings")
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]"
          )}
        >
          <Settings className="size-[16px] flex-shrink-0" strokeWidth={pathname.startsWith("/settings") ? 2.25 : 1.75} />
          Settings
        </Link>
      </div>

      {/* User card + sign out */}
      <div className="border-t">
        <UserMenu />
      </div>
    </aside>
  );
}
