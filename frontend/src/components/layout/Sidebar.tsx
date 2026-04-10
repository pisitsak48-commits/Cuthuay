'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/useStore';

interface SubItem { href: string; label: string }
interface NavGroup { label: string; icon: React.ReactNode; items: SubItem[] }

const navGroups: NavGroup[] = [
  {
    label: 'รายการขาย',
    icon: <ReceiptIcon />,
    items: [
      { href: '/bets',        label: 'ทำรายการขาย' },
      { href: '/bets/search', label: 'ค้นหารายการขาย' },
      { href: '/bets/all',    label: 'แสดงรายการขายทั้งหมด' },
    ],
  },
  {
    label: 'รายการตัดส่ง',
    icon: <ScissorsMenuIcon />,
    items: [
      { href: '/cut',    label: 'ทำการตัดส่ง' },
      { href: '/limits', label: 'กำหนดอัตราเก็บ / เลขอั้น' },
    ],
  },
  {
    label: 'รายการสรุปผล',
    icon: <SummaryIcon />,
    items: [
      { href: '/results',     label: 'ใส่ผลสลาก' },
      { href: '/summary',     label: 'ทำรายการสรุป' },
      { href: '/bet-results', label: 'ผลถูกรางวัล' },
    ],
  },
  {
    label: 'ข้อมูลพื้นฐาน',
    icon: <DatabaseIcon />,
    items: [
      { href: '/settings/users',  label: 'ข้อมูลผู้ใช้งาน' },
      { href: '/customers', label: 'ลูกค้า & เจ้ามือ' },
      { href: '/notebook',  label: 'สมุดบันทึก' },
    ],
  },
  {
    label: 'ตั้งค่า',
    icon: <SettingsIcon />,
    items: [
      { href: '/settings', label: 'ตั้งค่าระบบ' },
      { href: '/rounds',   label: 'จัดการงวด' },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  const activeGroupIndex = navGroups.findIndex((g) =>
    g.items.some((i) => {
      const base = i.href.split('?')[0];
      return base !== '/' && pathname.startsWith(base);
    }),
  );
  const [openGroups, setOpenGroups] = useState<Record<number, boolean>>(
    activeGroupIndex >= 0 ? { [activeGroupIndex]: true } : { 0: true },
  );
  const toggle = (i: number) => setOpenGroups((prev) => ({ ...prev, [i]: !prev[i] }));

  return (
    <aside className="fixed inset-y-0 left-0 z-30 w-56 flex flex-col border-r border-border bg-surface-50/90 backdrop-blur-md">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
        <div className="w-7 h-7 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center">
          <BrandIcon />
        </div>
        <div>
          <span className="text-sm font-bold text-slate-100 tracking-tight">CutHuay</span>
          <p className="text-[10px] text-slate-500 leading-none mt-0.5">Risk Manager</p>
        </div>
      </div>

      {/* Dashboard */}
      <div className="px-3 pt-3 pb-1 shrink-0">
        <Link href="/">
          <span className={cn(
            'relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer',
            pathname === '/' ? 'bg-accent/15 text-accent' : 'text-slate-400 hover:text-slate-200 hover:bg-surface-200',
          )}>
            {pathname === '/' && (
              <motion.span layoutId="sidebar-indicator"
                className="absolute left-0 w-0.5 h-5 bg-accent rounded-full"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }} />
            )}
            <span className={pathname === '/' ? 'text-accent' : 'text-slate-500'}><DashboardIcon /></span>
            หน้าหลัก
          </span>
        </Link>
      </div>

      {/* Groups */}
      <nav className="flex-1 px-3 pb-4 space-y-0.5 overflow-y-auto">
        {navGroups.map((group, gi) => {
          const isOpen = openGroups[gi] ?? false;
          const groupActive = group.items.some((i) => {
            const base = i.href.split('?')[0];
            return base !== '/' && pathname.startsWith(base);
          });
          return (
            <div key={gi}>
              <button onClick={() => toggle(gi)}
                className={cn(
                  'w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150',
                  groupActive ? 'text-accent bg-accent/10' : 'text-slate-400 hover:text-slate-200 hover:bg-surface-200',
                )}>
                <span className="flex items-center gap-2.5">
                  <span className={groupActive ? 'text-accent' : 'text-slate-500'}>{group.icon}</span>
                  {group.label}
                </span>
                <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.18 }} className="text-slate-500 shrink-0">
                  <ChevronIcon />
                </motion.span>
              </button>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div key="c" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: 'easeInOut' }} className="overflow-hidden">
                    <div className="ml-3 pl-3 border-l border-border/40 mt-0.5 mb-1 space-y-0.5">
                      {group.items.map((item, ii) => {
                        const base = item.href.split('?')[0];
                        const active = pathname === base || (base !== '/' && pathname === base);
                        return (
                          <Link key={ii} href={item.href}>
                            <span className={cn(
                              'flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 cursor-pointer',
                              active ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-200 hover:bg-surface-200/60',
                            )}>
                              {active && <span className="w-1 h-1 rounded-full bg-accent shrink-0" />}
                              {item.label}
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </nav>

      {/* User */}
      <div className="border-t border-border px-3 py-3 shrink-0">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
          <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-accent">{user?.username?.[0]?.toUpperCase() ?? 'U'}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-200 truncate">{user?.username}</p>
            <p className="text-[10px] text-slate-500 capitalize">{user?.role}</p>
          </div>
          <button onClick={logout} className="text-slate-500 hover:text-rose-400 transition-colors p-1" title="ออกจากระบบ">
            <LogoutIcon />
          </button>
        </div>
      </div>
    </aside>
  );
}

function BrandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
      <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
      <path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12" strokeLinecap="round" />
    </svg>
  );
}
function DashboardIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function ReceiptIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      <line x1="9" y1="12" x2="15" y2="12" strokeLinecap="round" /><line x1="9" y1="16" x2="13" y2="16" strokeLinecap="round" />
    </svg>
  );
}
function ScissorsMenuIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
      <path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12" strokeLinecap="round" />
    </svg>
  );
}
function SummaryIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function DatabaseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v6c0 1.657 4.03 3 9 3s9-1.343 9-3V5" />
      <path d="M3 11v6c0 1.657 4.03 3 9 3s9-1.343 9-3v-6" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}
function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function LogoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
