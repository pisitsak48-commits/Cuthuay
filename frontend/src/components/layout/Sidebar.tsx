'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { APP_BRAND_NAME } from '@/lib/brand';
import { useAuthStore, useSidebarStore } from '@/store/useStore';

interface SubItem { href: string; label: string }
interface NavGroup { label: string; icon: React.ReactNode; items: SubItem[] }

function navItemActive(pathname: string, href: string): boolean {
  return pathname === href.split('?')[0];
}

const allNavGroups: NavGroup[] = [
  {
    label: 'รายการขาย',
    icon: <ReceiptIcon />,
    items: [
      { href: '/rounds',      label: 'จัดการงวด' },
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
      { href: '/summary',         label: 'สรุปรายงวด' },
      { href: '/summary/compare', label: 'เทียบทุกงวด · สรุปปี' },
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
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const sidebarExpanded = useSidebarStore((s) => s.sidebarExpanded);
  const toggleSidebar = useSidebarStore((s) => s.toggleSidebar);
  const sidebarMobileOpen = useSidebarStore((s) => s.sidebarMobileOpen);
  const setSidebarMobileOpen = useSidebarStore((s) => s.setSidebarMobileOpen);

  const isOperator = user?.role === 'operator';
  const isViewer = user?.role === 'viewer';
  const navGroups = useMemo(() => {
    if (isOperator) return allNavGroups.filter((g) => g.label === 'รายการขาย');
    if (isViewer) {
      return [
        {
          label: 'รายการขาย',
          icon: <ReceiptIcon />,
          items: [
            { href: '/bets', label: 'ดูรายการขาย (อ่านอย่างเดียว)' },
            { href: '/bets/search', label: 'ค้นหารายการขาย' },
            { href: '/bets/all', label: 'แสดงรายการขายทั้งหมด' },
          ],
        },
        allNavGroups.find((g) => g.label === 'รายการสรุปผล')!,
      ];
    }
    return allNavGroups;
  }, [isOperator, isViewer]);

  const activeGroupIndex = navGroups.findIndex((g) =>
    g.items.some((i) => navItemActive(pathname, i.href)),
  );
  const [openGroups, setOpenGroups] = useState<Record<number, boolean>>(
    activeGroupIndex >= 0 ? { [activeGroupIndex]: true } : { 0: true },
  );
  /** เมนูย่อยโหมดย่อแถบ: fixed + portal (ถ้าใส่ absolute ใน nav จะถูกตัดเพราะ overflow-y-auto) */
  const [navFlyout, setNavFlyout] = useState<{ groupIndex: number; top: number; left: number } | null>(null);
  const navFlyoutRef = useRef<HTMLDivElement | null>(null);
  const toggle = (i: number) => setOpenGroups((prev) => ({ ...prev, [i]: !prev[i] }));
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    setIsMobileViewport(mq.matches);
    const fn = (e: MediaQueryListEvent) => setIsMobileViewport(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  // On mobile, always show the fully-expanded layout (labels + icons) regardless
  // of the desktop collapse-state preference.
  const expanded = sidebarExpanded || isMobileViewport;

  useEffect(() => {
    if (!navFlyout) return;
    const onDown = (ev: MouseEvent) => {
      const el = navFlyoutRef.current;
      const t = ev.target as Node;
      if (el?.contains(t)) return;
      setNavFlyout(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [navFlyout]);

  useEffect(() => {
    setNavFlyout(null);
    setSidebarMobileOpen(false);
  }, [pathname, expanded, setSidebarMobileOpen]);

  return (
    <>
      {/* Mobile backdrop — closes drawer on tap, below sidebar, above content */}
      {sidebarMobileOpen && typeof document !== 'undefined' && createPortal(
        <div
          aria-hidden
          className="fixed inset-0 z-[39] bg-black/45 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarMobileOpen(false)}
        />,
        document.body,
      )}

    <aside
      className={cn(
        'fixed top-0 left-0 h-dvh max-h-dvh flex flex-col border-0 border-r-0 bg-[var(--color-sidebar-bg)] backdrop-blur-[18px]',
        'transition-[width,transform] duration-200 [transition-timing-function:var(--ease-premium,cubic-bezier(0.22,1,0.36,1))]',
        // Desktop: always visible, can be collapsed to icon-only
        'md:z-30 md:translate-x-0 md:shadow-[4px_0_24px_-8px_rgba(15,23,42,0.08)]',
        expanded ? 'md:w-60' : 'md:w-[4.5rem]',
        // Mobile: always full-width expanded, slides in as drawer
        'z-[40] w-64 shadow-[8px_0_32px_-4px_rgba(15,23,42,0.18)]',
        sidebarMobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
      )}
    >
      {/* Logo + collapse */}
      <div className={cn('flex items-center border-b border-[var(--color-border)] shrink-0', expanded ? 'gap-3 px-5 py-5' : 'flex-col gap-2 px-2 py-4')}>
        <div
          className="w-9 h-9 rounded-3xl border border-accent/20 flex items-center justify-center shadow-[var(--color-nav-active-shadow)] shrink-0"
          style={{ background: 'var(--gradient-sidebar-logo)' }}
        >
          <BrandIcon />
        </div>
        {expanded && (
          <div className="flex-1 min-w-0">
            <span className="text-sm font-semibold text-theme-text-primary tracking-[0.04em]">{APP_BRAND_NAME}</span>
            <p className="text-[11px] text-theme-text-muted leading-none mt-0.5">Risk Manager</p>
          </div>
        )}
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={expanded ? 'ย่อเมนู' : 'ขยายเมนู'}
          title={expanded ? 'ย่อเมนู (แสดงไอคอน)' : 'ขยายเมนู'}
          className={cn(
            'hidden md:flex rounded-full border border-[var(--color-border)] bg-[var(--color-input-bg)] p-2 text-[var(--color-nav-inactive)] hover:text-accent hover:border-accent/30 backdrop-blur-[8px] transition-all duration-theme shrink-0 items-center justify-center',
            !expanded && 'mx-auto',
          )}
        >
          {expanded ? <CollapseIcon /> : <ExpandIcon />}
        </button>
        {/* Mobile close button — only visible inside drawer */}
        <button
          type="button"
          onClick={() => setSidebarMobileOpen(false)}
          aria-label="ปิดเมนู"
          className="md:hidden flex rounded-full border border-[var(--color-border)] bg-[var(--color-input-bg)] p-2 text-[var(--color-nav-inactive)] hover:text-accent hover:border-accent/30 backdrop-blur-[8px] transition-all duration-theme shrink-0 items-center justify-center"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Dashboard — ซ่อนสำหรับ operator */}
      {!isOperator && (
        <div className={cn('pt-3 pb-1 shrink-0', expanded ? 'px-4' : 'px-2')}>
          <Link href="/" title="หน้าหลัก">
            <span className={cn(
              'relative flex items-center rounded-xl text-sm font-medium transition-[color,background-color,box-shadow] duration-200 ease-out cursor-pointer',
              expanded ? 'gap-3 px-4 py-3' : 'justify-center px-2 py-3',
              pathname === '/'
                ? '[background:var(--color-nav-active-bg)] text-[var(--color-nav-active-fg)] font-semibold shadow-[var(--color-nav-active-shadow)]'
                : 'bg-transparent text-[var(--color-nav-inactive)] hover:text-theme-text-primary hover:bg-[var(--color-nav-hover-bg)]',
            )}>
              {pathname === '/' && expanded && (
                <motion.span layoutId="sidebar-indicator"
                  className="absolute left-0 w-1.5 h-10 rounded-full bg-[var(--color-nav-active-fg)] opacity-95"
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} />
              )}
              <span className={pathname === '/' ? 'text-[var(--color-nav-active-fg)]' : 'text-[var(--color-nav-inactive)]'}><DashboardIcon /></span>
              {expanded && 'หน้าหลัก'}
            </span>
          </Link>
        </div>
      )}

      {/* Groups */}
      <nav className={cn('flex-1 pb-4 space-y-1 min-h-0 flex flex-col', expanded ? 'px-3' : 'px-2')}>
        <div className="flex-1 overflow-y-auto overflow-x-visible space-y-1">
        {navGroups.map((group, gi) => {
          const isOpen = openGroups[gi] ?? false;
          const groupActive = group.items.some((i) => navItemActive(pathname, i.href));

          /** เมนูที่มีลิงก์เดียว — แสดงเป็นแถบหลักโดยไม่มีหัวข้อพับ */
          if (group.items.length === 1) {
            const only = group.items[0];
            const active = navItemActive(pathname, only.href);
            if (!expanded) {
              return (
                <div key={gi} className="relative">
                  <Link href={only.href} title={only.label}>
                    <span
                      className={cn(
                        'relative w-full flex items-center justify-center px-2 py-3 rounded-xl text-sm font-medium transition-[color,background-color,box-shadow] duration-200 ease-out cursor-pointer',
                        active
                          ? '[background:var(--color-nav-active-bg)] text-[var(--color-nav-active-fg)] font-semibold shadow-[var(--color-nav-active-shadow)]'
                          : 'bg-transparent text-[var(--color-nav-inactive)] hover:text-theme-text-primary hover:bg-[var(--color-nav-hover-bg)]',
                      )}
                    >
                      <span className={active ? 'text-[var(--color-nav-active-fg)]' : 'text-[var(--color-nav-inactive)]'}>
                        {group.icon}
                      </span>
                    </span>
                  </Link>
                </div>
              );
            }
            return (
              <div key={gi}>
                <Link href={only.href}>
                  <span
                    className={cn(
                      'relative flex items-center rounded-xl text-sm font-medium transition-[color,background-color,box-shadow] duration-200 ease-out cursor-pointer gap-3 px-4 py-3',
                      active
                        ? '[background:var(--color-nav-active-bg)] text-[var(--color-nav-active-fg)] font-semibold shadow-[var(--color-nav-active-shadow)]'
                        : 'bg-transparent text-[var(--color-nav-inactive)] hover:text-theme-text-primary hover:bg-[var(--color-nav-hover-bg)]',
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="sidebar-indicator"
                        className="absolute left-0 w-1.5 h-10 rounded-full bg-[var(--color-nav-active-fg)] opacity-95"
                        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                      />
                    )}
                    <span className={active ? 'text-[var(--color-nav-active-fg)]' : 'text-[var(--color-nav-inactive)]'}>{group.icon}</span>
                    {only.label}
                  </span>
                </Link>
              </div>
            );
          }

          if (!expanded) {
            return (
              <div key={gi} className="relative">
                <button
                  type="button"
                  title={group.label}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setNavFlyout((prev) => {
                      if (prev?.groupIndex === gi) return null;
                      setOpenGroups((p) => ({ ...p, [gi]: true }));
                      return { groupIndex: gi, top: rect.top, left: rect.right + 8 };
                    });
                  }}
                  className={cn(
                    'w-full flex items-center justify-center px-2 py-3 rounded-xl text-sm font-medium transition-[color,background-color,box-shadow] duration-200 ease-out',
                    groupActive || navFlyout?.groupIndex === gi
                      ? '[background:var(--color-nav-active-bg)] text-[var(--color-nav-active-fg)] font-semibold shadow-[var(--color-nav-active-shadow)]'
                      : 'bg-transparent text-[var(--color-nav-inactive)] hover:text-theme-text-primary hover:bg-[var(--color-nav-hover-bg)]',
                  )}
                >
                  <span className={groupActive || navFlyout?.groupIndex === gi ? 'text-[var(--color-nav-active-fg)]' : 'text-[var(--color-nav-inactive)]'}>{group.icon}</span>
                </button>
              </div>
            );
          }

          return (
            <div key={gi}>
              <button type="button" onClick={() => toggle(gi)}
                className={cn(
                  'w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-[color,background-color,box-shadow] duration-200 ease-out',
                  groupActive
                    ? '[background:var(--color-nav-active-bg)] text-[var(--color-nav-active-fg)] font-semibold shadow-[var(--color-nav-active-shadow)]'
                    : 'bg-transparent text-[var(--color-nav-inactive)] hover:text-theme-text-primary hover:bg-[var(--color-nav-hover-bg)]',
                )}>
                <span className="flex items-center gap-3 min-w-0">
                  <span className={groupActive ? 'text-[var(--color-nav-active-fg)]' : 'text-[var(--color-nav-inactive)]'}>{group.icon}</span>
                  <span className="truncate">{group.label}</span>
                </span>
                <motion.span
                  animate={{ rotate: isOpen ? 180 : 0 }}
                  transition={{ duration: 0.18 }}
                  className={cn('shrink-0 transition-colors duration-200 ease-out', groupActive ? 'text-[var(--color-nav-active-fg)]' : 'text-theme-text-muted')}
                >
                  <ChevronIcon />
                </motion.span>
              </button>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div key="c" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: 'easeInOut' }} className="overflow-hidden">
                    <div className="ml-4 pl-4 border-l border-[var(--color-border)] mt-1 mb-2 space-y-1">
                      {group.items.map((item, ii) => {
                        const active = navItemActive(pathname, item.href);
                        return (
                          <Link key={ii} href={item.href}>
                            <span className={cn(
                              'flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-[color,background-color,box-shadow] duration-200 ease-out cursor-pointer',
                              active
                                ? '[background:var(--color-nav-active-bg)] text-[var(--color-nav-active-fg)] font-semibold shadow-[var(--color-nav-active-shadow)]'
                                : 'bg-transparent text-[var(--color-nav-inactive)] hover:text-theme-text-primary hover:bg-[var(--color-nav-hover-bg)]',
                            )}>
                              {active && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-nav-active-fg)] shrink-0" />}
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
        </div>
      </nav>

      {navFlyout != null && typeof document !== 'undefined' && createPortal(
        <motion.div
          ref={navFlyoutRef}
          role="menu"
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -4 }}
          transition={{ duration: 0.12 }}
          style={{
            position: 'fixed',
            top: Math.max(8, navFlyout.top),
            left: navFlyout.left,
            zIndex: 10050,
          }}
          className="min-w-[220px] rounded-2xl border-0 bg-[var(--color-card-bg-solid)] shadow-md backdrop-blur-[18px] py-1.5"
        >
          <p className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-theme-text-muted border-b border-[var(--color-border)]">
            {navGroups[navFlyout.groupIndex]?.label}
          </p>
          {navGroups[navFlyout.groupIndex]?.items.map((item, ii) => {
            const active = navItemActive(pathname, item.href);
            return (
              <Link key={ii} href={item.href} onClick={() => setNavFlyout(null)}>
                <span
                  role="menuitem"
                  className={cn(
                    'flex items-center gap-2 px-3 py-2.5 text-xs font-medium cursor-pointer transition-[color,background-color] duration-200 ease-out rounded-lg',
                    active
                      ? 'text-[var(--color-nav-active-fg)] [background:var(--color-nav-active-bg)] font-semibold'
                      : 'text-[var(--color-nav-inactive)] hover:text-theme-text-primary hover:bg-[var(--color-nav-hover-bg)]',
                  )}
                >
                  {active && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-nav-active-fg)] shrink-0" />}
                  {item.label}
                </span>
              </Link>
            );
          })}
        </motion.div>,
        document.body,
      )}

      {/* User */}
      <div className="border-t border-[var(--color-border)] px-4 py-4 shrink-0">
        <div className={cn(
          'flex items-center rounded-2xl bg-[var(--color-card-bg-solid)] border-0 shadow-sm backdrop-blur-[18px]',
          expanded ? 'gap-3 px-3 py-3' : 'flex-col gap-2 px-2 py-3',
        )}>
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-[var(--color-btn-primary-fg)] shadow-[var(--color-nav-active-shadow)] shrink-0"
            style={{ background: 'var(--gradient-sidebar-logo)' }}
          >
            {user?.username?.[0]?.toUpperCase() ?? 'U'}
          </div>
          {expanded && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-theme-text-primary truncate">{user?.username}</p>
              <p className="text-[11px] text-theme-text-muted capitalize">{user?.role}</p>
            </div>
          )}
          <button onClick={logout} aria-label="ออกจากระบบ" className="rounded-full border border-[var(--color-border)] bg-[var(--color-input-bg)] p-2 text-[var(--color-nav-inactive)] hover:text-[rgb(var(--color-loss)/1)] hover:border-[rgb(var(--color-loss)/0.35)] backdrop-blur-[8px] transition-all duration-theme" title="ออกจากระบบ">
            <LogoutIcon />
          </button>
        </div>
      </div>
    </aside>
    </>
  );
}

function CollapseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <polyline points="15 6 9 12 15 18" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ExpandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <polyline points="9 6 15 12 9 18" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BrandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--text-inverse)]">
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
