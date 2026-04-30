'use client';
import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore, useSidebarStore } from '@/store/useStore';
import { Sidebar } from './Sidebar';
import { wsClient } from '@/lib/websocket';
import { cn } from '@/lib/utils';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, token, _hasHydrated } = useAuthStore();
  const sidebarExpanded = useSidebarStore((s) => s.sidebarExpanded);
  const router = useRouter();
  const pathname = usePathname();
  const wsConnected = useRef(false);

  useEffect(() => {
    // รอ Zustand hydrate ข้อมูลจาก localStorage ก่อน
    if (!_hasHydrated) return;

    if (!user || !token) {
      router.replace('/login');
      return;
    }
    if (!wsConnected.current) {
      wsClient.connect(token);
      wsConnected.current = true;
    }
  }, [user, token, _hasHydrated, router]);

  /** operator: /bets* (ยกเว้น /bets/import) + /rounds */
  useEffect(() => {
    if (!_hasHydrated || !user || user.role !== 'operator') return;
    if (pathname.startsWith('/login')) return;
    if (pathname === '/bets/import' || pathname.startsWith('/bets/import/')) {
      router.replace('/bets');
      return;
    }
    const allowed =
      pathname.startsWith('/bets') || pathname.startsWith('/rounds');
    if (!allowed) router.replace('/bets');
  }, [_hasHydrated, user, pathname, router]);

  // ยังไม่ hydrate: แสดง blank screen แทนการ redirect
  if (!_hasHydrated) return null;

  if (!user) return null;

  return (
    <div className="relative h-dvh max-h-dvh text-theme-text-primary overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[var(--color-bg-ambient)]" />
      <div className="relative flex h-full min-h-0">
        <Sidebar />
        <div
          className={cn(
            'flex flex-1 flex-col min-h-0 min-w-0 max-w-full transition-[margin] duration-200 ease-out',
            sidebarExpanded ? 'ml-60' : 'ml-[4.5rem]',
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
