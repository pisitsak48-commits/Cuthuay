'use client';
import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore, useSidebarStore } from '@/store/useStore';
import { Sidebar } from './Sidebar';
import { ApiErrorToast } from '@/components/ui/ApiErrorToast';
import { wsClient } from '@/lib/websocket';
import { isViewerAllowedPath } from '@/lib/rbac';
import { cn } from '@/lib/utils';
import { APP_BRAND_NAME } from '@/lib/brand';

import { restoreSessionFromCookies, isCookieAuthEnabled } from '@/lib/api';

const cookieAuthEnabled = isCookieAuthEnabled();

function HamburgerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, token, _hasHydrated } = useAuthStore();
  const sidebarExpanded = useSidebarStore((s) => s.sidebarExpanded);
  const toggleSidebarMobile = useSidebarStore((s) => s.toggleSidebarMobile);
  const router = useRouter();
  const pathname = usePathname();
  const wsConnected = useRef(false);
  const cookieRestoreStarted = useRef(false);

  useEffect(() => {
    if (!_hasHydrated) return;

    if (cookieAuthEnabled && user && !token && !cookieRestoreStarted.current) {
      cookieRestoreStarted.current = true;
      void restoreSessionFromCookies().then((access) => {
        if (access) {
          useAuthStore.setState({ token: access });
          if (!wsConnected.current) {
            wsClient.connect(access);
            wsConnected.current = true;
          }
          return;
        }
        useAuthStore.setState({ user: null, token: null, refreshToken: null });
        router.replace('/login');
      });
      return;
    }

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

  /** viewer: read-only routes only */
  useEffect(() => {
    if (!_hasHydrated || !user || user.role !== 'viewer') return;
    if (pathname.startsWith('/login')) return;
    if (!isViewerAllowedPath(pathname)) router.replace('/');
  }, [_hasHydrated, user, pathname, router]);

  if (!_hasHydrated) return null;

  if (!user) return null;
  if (!token) return null;

  return (
    <div className="relative h-dvh max-h-dvh text-theme-text-primary overflow-hidden bg-[var(--color-bg)]">
      <div className="pointer-events-none absolute inset-0 bg-[var(--color-bg-ambient)]" />
      <div className="relative flex h-full min-h-0">
        <Sidebar />
        <div
          className={cn(
            'flex flex-1 flex-col min-h-0 min-w-0 max-w-full transition-[margin] duration-200 ease-out',
            // Desktop: offset for sidebar width
            sidebarExpanded ? 'md:ml-60' : 'md:ml-[4.5rem]',
            // Mobile: no offset — sidebar overlays as drawer
          )}
        >
          {/* Mobile-only top bar — shows hamburger + brand name */}
          <div className="md:hidden sticky top-0 z-[28] flex items-center gap-3 px-4 h-14 bg-white/95 backdrop-blur-md border-b border-[var(--color-border)] shrink-0">
            <button
              type="button"
              onClick={toggleSidebarMobile}
              aria-label="เปิดเมนู"
              className="flex items-center justify-center w-10 h-10 rounded-xl text-[var(--color-nav-inactive)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-nav-hover-bg)] transition-colors duration-150 -ml-1"
            >
              <HamburgerIcon />
            </button>
            <span className="text-sm font-semibold text-theme-text-primary tracking-tight">{APP_BRAND_NAME}</span>
          </div>

          {children}
        </div>
      </div>
      <ApiErrorToast />
    </div>
  );
}
