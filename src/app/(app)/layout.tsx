import { SidebarNav } from "@/components/sidebar-nav";
import { BottomNav } from "@/components/bottom-nav";
import { MobileHeader } from "@/components/mobile-header";
import { Fab } from "@/components/fab";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full">
      {/* Desktop sidebar */}
      <SidebarNav />

      {/* Mobile header */}
      <MobileHeader />

      {/* Main content */}
      <main className="lg:pl-60">
        <div className="max-w-5xl mx-auto px-4 py-6 lg:px-10 lg:py-10 pb-safe">
          {children}
        </div>
      </main>

      {/* Floating action button — persistent CTA */}
      <Fab />

      {/* Mobile bottom nav */}
      <BottomNav />
    </div>
  );
}
