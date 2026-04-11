import { SidebarNav } from "@/components/sidebar-nav";
import { BottomNav } from "@/components/bottom-nav";
import { MobileHeader } from "@/components/mobile-header";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full">
      {/* Desktop sidebar */}
      <SidebarNav />

      {/* Mobile header */}
      <MobileHeader />

      {/* Main content */}
      <main className="lg:pl-60">
        <div className="max-w-3xl mx-auto px-4 py-6 lg:px-8 lg:py-8 pb-20 lg:pb-8">
          {children}
        </div>
      </main>

      {/* Mobile bottom nav */}
      <BottomNav />
    </div>
  );
}
