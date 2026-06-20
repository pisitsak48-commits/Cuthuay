'use client';
import { useEffect, useState, useCallback, useRef, useMemo, Suspense } from 'react';
import { useFocusTrap } from '@/lib/useFocusTrap';
import { useSearchParams, useRouter } from 'next/navigation';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import Link from 'next/link';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { Card, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { roundsApi } from '@/lib/api';
import { APP_BRAND_NAME } from '@/lib/brand';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/useStore';
import { useSummaryData } from '@/hooks/useSummaryData';
import { useSummaryRounds } from '@/hooks/useSummaryRounds';
import { showApiError } from '@/lib/apiErrorToast';
import { ProfitTab } from '@/components/summary/ProfitTab';
import { CustomerTab } from '@/components/summary/CustomerTab';
import { DealerTab } from '@/components/summary/DealerTab';
import { SummaryPrizeBar, totePerms } from '@/components/summary/summaryShared';

function SummaryPageInner() {
  const confirm = useConfirm();
  const searchParams = useSearchParams();
  const router = useRouter();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  /** ค่าเริ่มต้น: ซ่อน archived และงวดเก่า (วันออกก่อนวันล่าสุด) — admin ติ๊กเพื่อโชว์ทั้งหมด */
  const [summaryIncludeArchived, setSummaryIncludeArchived] = useState(false);
  const roundFromUrl = searchParams.get('round') ?? '';
  const [tab, setTab] = useState<'profit' | 'customer' | 'dealer'>('profit');
  const { rounds, roundId, setRoundId, roundsForPicker } = useSummaryRounds({
    roundFromUrl,
    includeArchived: summaryIncludeArchived,
    isAdmin: Boolean(isAdmin),
  });
  const { data, loading, error, fetchSummary } = useSummaryData(roundId);

  useEffect(() => {
    if (!isAdmin) setSummaryIncludeArchived(false);
  }, [isAdmin]);

  useEffect(() => { void fetchSummary(); }, [fetchSummary]);

  // ─── Result modal state ────────────────────────────────────────────────────
  const [showResultModal, setShowResultModal] = useState(false);
  const [rPrize1st, setRPrize1st] = useState('');
  const [rBot3, setRBot3] = useState<[string,string,string,string]>(['','','','']);
  const [rBot2, setRBot2] = useState('');
  const [resultSaving, setResultSaving] = useState(false);
  const [resultError, setResultError] = useState('');

  const rTop3  = rPrize1st.length >= 3 ? rPrize1st.slice(-3) : '';
  const rTop2  = rTop3.length === 3 ? rTop3.slice(-2) : '';
  const rTote3 = rTop3.length === 3 ? totePerms(rTop3) : [];

  const openResultModal = useCallback(() => {
    const rd = data?.round.result_data as { prize_1st?: string; prize_3top?: string; prize_3bottom?: string[]; prize_2bottom?: string } | null;
    if (rd) {
      setRPrize1st(rd.prize_1st ?? rd.prize_3top ?? '');
      const b3 = rd.prize_3bottom ?? [];
      setRBot3([b3[0]??'', b3[1]??'', b3[2]??'', b3[3]??''] as [string,string,string,string]);
      setRBot2(rd.prize_2bottom ?? '');
    } else {
      setRPrize1st(''); setRBot3(['','','','']); setRBot2('');
    }
    setResultError('');
    setShowResultModal(true);
  }, [data]);

  const closeResultModal = useCallback(() => setShowResultModal(false), []);
  const resultModalRef = useFocusTrap(showResultModal, closeResultModal);

  const autoOpenResultDone = useRef(false);
  useEffect(() => {
    if (searchParams.get('editResult') !== '1') {
      autoOpenResultDone.current = false;
      return;
    }
    if (!data || autoOpenResultDone.current) return;
    autoOpenResultDone.current = true;
    openResultModal();
    const rid = roundId || data.round.id;
    router.replace(`/summary?round=${encodeURIComponent(rid)}`, { scroll: false });
  }, [searchParams, data, roundId, openResultModal, router]);

  async function handleSaveResult() {
    if (!roundId) { setResultError('กรุณาเลือกงวด'); return; }
    if (rTop3.length !== 3) { setResultError('กรุณากรอกรางวัลที่ 1 ให้ครบอย่างน้อย 3 หลัก'); return; }
    if (rBot2.length !== 2) { setResultError('กรุณากรอก 2 ตัวล่าง (2 หลัก)'); return; }
    setResultError('');
    setResultSaving(true);
    try {
      await roundsApi.submitResult(roundId, {
        result_prize_1st: rPrize1st.length === 6 ? rPrize1st : undefined,
        result_3top: rTop3,
        result_2bottom: rBot2,
        result_3bottom: rBot3.filter(s => s.length === 3),
      });
      setShowResultModal(false);
      await fetchSummary();
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'เกิดข้อผิดพลาด';
      setResultError(msg);
      showApiError(e, 'บันทึกผลไม่สำเร็จ');
    } finally {
      setResultSaving(false);
    }
  }

  async function handleResetResult() {
    if (!await confirm({ message: 'รีเซ็ตผลสลาก?\nงวดจะกลับสู่สถานะปิด และข้อมูลสรุปผลจะถูกล้างทั้งหมด', danger: true })) return;
    try {
      await roundsApi.resetResult(roundId);
      setShowResultModal(false);
      await fetchSummary();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'รีเซ็ตไม่สำเร็จ';
      setResultError(msg);
      showApiError(e, 'รีเซ็ตผลไม่สำเร็จ');
    }
  }

  const tabs = [
    {
      key: 'profit',
      label: 'สรุปผลกำไร',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
      activeClass:
        'bg-[var(--color-accent)] text-white font-semibold border-0 shadow-sm transition-[color,background-color,box-shadow] duration-200 ease-out',
      dotClass: 'bg-white',
    },
    {
      key: 'customer',
      label: 'รายลูกค้า',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      activeClass:
        'bg-[var(--color-accent)] text-white font-semibold border-0 shadow-sm transition-[color,background-color,box-shadow] duration-200 ease-out',
      dotClass: 'bg-white',
    },
    {
      key: 'dealer',
      label: 'รายเจ้ามือ',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
      activeClass:
        'bg-[var(--color-accent)] text-white font-semibold border-0 shadow-sm transition-[color,background-color,box-shadow] duration-200 ease-out',
      dotClass: 'bg-white',
    },
  ] as const;

  return (
    <AppShell>
      <Header
        title="สรุปรายงวด"
        subtitle={`${APP_BRAND_NAME} · สรุปผลกำไร-ขาดทุน หลังออกผลสลาก`}
        variant="prominent"
      />
      <main className="flex-1 overflow-auto p-5">
        <div className="max-w-7xl mx-auto space-y-4">
          <div className="flex justify-end -mt-1 mb-1">
            <Link
              href="/summary/compare"
              className="text-xs font-semibold text-accent hover:underline inline-flex items-center gap-1"
            >
              เทียบทุกงวด · สรุปปี <span aria-hidden>→</span>
            </Link>
          </div>

          {/* เลือกงวด + ดึงข้อมูล */}
          <div className="rounded-2xl border border-[var(--color-border)]/60 bg-[var(--color-card-bg-solid)] shadow-[var(--shadow-soft)] px-3 py-2.5 sm:py-3 flex flex-col gap-2">
            <div
              className={cn(
                'flex flex-wrap items-center gap-2 sm:gap-3 transition-opacity duration-200 ease-out',
                loading && data && 'opacity-[0.62]',
              )}
            >
              <label className="text-sm text-theme-text-secondary whitespace-nowrap">งวด:</label>
              <select
                value={roundsForPicker.some((r) => r.id === roundId) ? roundId : (roundsForPicker[0]?.id ?? '')}
                onChange={(e) => setRoundId(e.target.value)}
                disabled={roundsForPicker.length === 0}
                className="h-9 min-w-0 max-w-[min(100%,16rem)] rounded-lg bg-[var(--color-input-bg)] border border-border px-3 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] focus:border-[var(--color-border-strong)] sm:max-w-[13rem] disabled:opacity-50"
              >
                {roundsForPicker.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}{r.status === 'drawn' ? ' ✓' : ''}</option>
                ))}
              </select>
              {isAdmin && (
                <label className="flex items-center gap-2 text-[11px] text-theme-text-muted cursor-pointer select-none whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={summaryIncludeArchived}
                    onChange={(e) => { setSummaryIncludeArchived(e.target.checked); }}
                    className="rounded border-border bg-surface-100 accent"
                  />
                  แสดมงวดเก่า / ซ่อนแล้ว (ทั้งหมด)
                </label>
              )}
              <Button onClick={fetchSummary} disabled={!roundId || loading} variant="outline" className="shrink-0 min-w-[9.5rem] justify-center ml-auto">
                {loading ? 'กำลังโหลด...' : 'ดึงข้อมูล'}
              </Button>
            </div>
          </div>

          {data && (
            <SummaryPrizeBar
              data={data}
              loading={loading}
              openResultModal={openResultModal}
              handleResetResult={handleResetResult}
            />
          )}

          {error && <p className="text-sm text-[var(--color-badge-danger-text)] bg-[var(--color-badge-danger-bg)] border border-[var(--color-badge-danger-border)] rounded-lg px-3 py-2">{error}</p>}

          {data && (
            <div
              className={cn(
                'space-y-4 transition-opacity duration-200 ease-out',
                loading && 'opacity-[0.62]',
              )}
            >
              {/* Tab bar */}
              <div className="rounded-2xl border-0 bg-[var(--color-surface-muted)] p-1.5 flex gap-1.5 shadow-sm">
                {tabs.map(t => (
                  <button key={t.key} type="button" onClick={() => setTab(t.key)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-semibold rounded-full transition-[color,background-color,box-shadow,border-color] duration-200 ${
                      tab === t.key
                        ? t.activeClass
                        : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-[var(--color-card-bg)]/90'
                    }`}>
                    <span className="w-3.5 h-3.5 shrink-0 flex items-center justify-center" aria-hidden>
                      {tab === t.key ? (
                        <span className={`w-1.5 h-1.5 rounded-full ${t.dotClass}`} />
                      ) : (
                        <span className="opacity-50 [&>svg]:shrink-0">{t.icon}</span>
                      )}
                    </span>
                    {t.label}
                  </button>
                ))}
              </div>

              <div>
                {tab === 'profit'   && <ProfitTab   data={data} />}
                {tab === 'customer' && <CustomerTab data={data} roundId={roundId} />}
                {tab === 'dealer'   && <DealerTab   data={data} roundId={roundId} />}
              </div>
            </div>
          )}

          {!data && !loading && roundId && (
            <p className="text-sm text-theme-text-muted text-center py-12">ยังไม่มีข้อมูล — กด "ดึงข้อมูล" เพื่อโหลด</p>
          )}
        </div>
      </main>

      {/* ─── Result Modal ──────────────────────────────────────────────────── */}
      {showResultModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-[3px]"
          onClick={() => setShowResultModal(false)}
        >
          <div
            ref={resultModalRef}
            role="dialog" aria-modal="true" aria-label="ผลรางวัลงวดนี้"
            tabIndex={-1}
            className="relative z-10 w-full max-w-xl overflow-hidden rounded-2xl bg-[var(--color-card-bg-solid)] shadow-xl focus:outline-none"
            onClick={e => e.stopPropagation()}
          >
            <div className="relative px-6 pt-6 pb-5 border-b border-[var(--color-border)]/90 bg-[var(--color-card-bg-solid)]">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-profit/35 via-[var(--color-accent)]/25 to-loss/25 opacity-90" aria-hidden />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex h-8 w-8 items-center justify-center rounded-xl shadow-sm ${data?.round.result_data ? 'bg-[var(--bg-glass-subtle)] ring-1 ring-[var(--color-border)]' : 'bg-profit/15 ring-1 ring-profit/25'}`} aria-hidden>
                      <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${data?.round.result_data ? 'text-theme-text-secondary' : 'text-profit'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                      </svg>
                    </span>
                    <span className="text-lg font-bold text-theme-text-primary tracking-tight">
                      {data?.round.result_data ? 'แก้ไขผลสลาก' : 'ใส่ผลสลาก'}
                    </span>
                  </div>
                  <p className="text-sm text-theme-text-muted pl-10 -mt-0.5">งวด <span className="font-semibold text-theme-text-secondary">{data?.round.name}</span></p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowResultModal(false)}
                  className="shrink-0 rounded-xl p-2 text-theme-text-muted hover:text-theme-text-primary hover:bg-[var(--bg-hover)] transition-colors"
                  aria-label="ปิด"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-5 bg-[var(--color-bg-primary)] max-h-[min(78vh,calc(100vh-8rem))] overflow-y-auto">
              <section className="rounded-2xl border border-[var(--color-border)]/70 bg-[var(--color-card-bg-solid)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-theme-text-secondary mb-2 block">
                  รางวัลที่ 1 <span className="text-loss normal-case tracking-normal">*</span>
                  <span className="ml-1.5 font-normal text-theme-text-muted normal-case tracking-normal">(6 หลัก)</span>
                </label>
                <input
                  type="text" inputMode="numeric" maxLength={6}
                  value={rPrize1st}
                  onChange={e => setRPrize1st(e.target.value.replace(/\D/g,'').slice(0,6))}
                  placeholder="เช่น 536077"
                  autoFocus
                  className="w-full h-12 rounded-xl bg-[var(--color-input-bg)] border-2 border-[var(--color-input-border)] px-4 text-2xl tracking-[0.35em] font-bold text-theme-text-primary text-center sm:text-left sm:tracking-[0.28em] placeholder:text-theme-text-muted/70 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] focus:border-[var(--color-border-strong)] shadow-inner"
                />
              </section>

              <section className="rounded-2xl border border-[var(--color-border)]/70 bg-[var(--color-card-bg-solid)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-theme-text-secondary mb-2 block">
                  3 ตัวล่าง <span className="font-normal text-theme-text-muted normal-case">(สูงสุด 4 ชุด)</span>
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  {[0, 1, 2, 3].map(i => (
                    <input key={i} type="text" inputMode="numeric" maxLength={3}
                      value={rBot3[i]}
                      onChange={e => {
                        const n = [...rBot3] as typeof rBot3;
                        n[i] = e.target.value.replace(/\D/g,'').slice(0,3);
                        setRBot3(n);
                      }}
                      placeholder={`ชุด ${i + 1}`}
                      className="w-full h-10 rounded-xl bg-[var(--color-input-bg)] border border-[var(--color-input-border)] focus:border-[var(--color-border-strong)] text-center text-sm font-semibold tracking-tight text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] shadow-inner"
                    />
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-[var(--color-border)]/70 bg-[var(--color-card-bg-solid)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-theme-text-secondary mb-2 block">
                  2 ตัวล่าง <span className="text-loss normal-case tracking-normal">*</span>
                  <span className="ml-1.5 font-normal text-theme-text-muted normal-case tracking-normal">(2 หลัก)</span>
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="text" inputMode="numeric" maxLength={2}
                    value={rBot2}
                    onChange={e => setRBot2(e.target.value.replace(/\D/g,'').slice(0,2))}
                    placeholder="74"
                    className="w-28 h-11 rounded-xl bg-[var(--color-input-bg)] border-2 border-[var(--color-input-border)] focus:border-[var(--color-border-strong)] text-center text-lg font-bold tracking-widest text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] shadow-inner"
                  />
                  {rBot2.length === 2 && (
                    <span className="text-xs text-theme-text-muted rounded-lg bg-[var(--bg-glass-subtle)] border border-[var(--color-border)]/60 px-3 py-2">
                      วิ่งล่าง: <span className="font-semibold text-theme-text-secondary tabular-nums">{rBot2.split('').join(', ')}</span>
                    </span>
                  )}
                </div>
              </section>

              {rTop3 && (
                <div className="rounded-2xl border border-[var(--color-semantic-success)]/30 bg-[var(--color-semantic-success)]/[0.05] px-4 py-3.5 shadow-sm">
                  <div className="text-[11px] font-bold text-[var(--color-semantic-success)] mb-2">สรุปจากเลขรางวัลที่ 1</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:text-sm">
                    <div className="text-theme-text-muted">3 ตัวบน <span className="text-profit font-bold tabular-nums ml-1">{rTop3}</span></div>
                    <div className="text-theme-text-muted">2 ตัวบน <span className="text-profit font-bold tabular-nums ml-1">{rTop2}</span></div>
                    {rTote3.length > 0 && (
                      <div className="col-span-2 text-theme-text-muted leading-relaxed">
                        โต๊ด <span className="text-theme-text-secondary font-medium tracking-tight">{rTote3.join(' , ')}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {resultError && (
                <p className="text-sm text-[var(--color-badge-danger-text)] bg-[var(--color-badge-danger-bg)] rounded-xl px-3 py-2.5 border border-[var(--color-badge-danger-border)]">{resultError}</p>
              )}
            </div>

            <div className="px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-card-bg-solid)] flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <button
                type="button"
                onClick={handleSaveResult}
                disabled={resultSaving || rTop3.length !== 3 || rBot2.length !== 2}
                className="btn-toolbar-glow btn-toolbar-profit order-1 sm:order-none flex-1 !h-auto py-3 text-sm rounded-2xl flex items-center justify-center gap-2 font-semibold disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
              >
                {resultSaving ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {resultSaving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
              <div className="flex gap-2 order-2 sm:order-none sm:shrink-0">
                {data?.round.result_data && (
                  <button
                    type="button"
                    onClick={handleResetResult}
                    className="btn-toolbar-glow btn-fintech-rose inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 px-4 py-3 text-sm rounded-2xl !h-auto font-semibold"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    รีเซ็ต
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowResultModal(false)}
                  className="btn-toolbar-glow btn-toolbar-muted px-4 py-3 text-sm rounded-2xl !h-auto font-semibold"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

export default function SummaryPage() {
  return <Suspense><SummaryPageInner /></Suspense>;
}
