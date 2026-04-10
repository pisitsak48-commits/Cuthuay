'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useStore';
import { Sidebar } from './Sidebar';
import { wsClient } from '@/lib/websocket';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, token, _hasHydrated } = useAuthStore();
  const router = useRouter();
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

  // ยังไม่ hydrate: แสดง blank screen แทนการ redirect
  if (!_hasHydrated) return null;

  if (!user) return null;

  return (
    <div className="flex min-h-screen bg-grid-pattern bg-grid-40">
      <Sidebar />
      <div className="flex-1 ml-56 flex flex-col min-h-screen">
        {children}
      </div>
    </div>
  );
}
