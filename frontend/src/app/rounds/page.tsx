'use client';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { Card, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { RoundStatusBadge } from '@/components/ui/Badge';
import { roundsApi, type ImportPreviewResponse } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { formatBaht } from '@/lib/utils';
import { Round } from '@/types';
import { useAuthStore } from '@/store/useStore';

function formatRoundsBackupError(err: unknown): string {
  const e = err as { message?: string; response?: { data?: unknown; status?: number } };
  const msg = e?.message ?? '';
  if (msg === 'Network Error' || /network/i.test(msg)) {
    return 'Network Error — เรียก API ไม่ถึง ตรวจว่าเปิดเว็บที่พอร์ต 3000 และ CORS_ORIGIN บน backend ตรงกับ URL ที่เปิดเว็บ';
  }
  if (e?.response?.status === 403) return 'ไม่มีสิทธิ์ (ส่งออก/นำเข้า backup ต้องเป็น admin)';
  const data = e?.response?.data;
  if (data && typeof data === 'object' && data !== null && 'error' in data) {
    return String((data as { error: string }).error);
  }
  return msg || 'เกิดข้อผิดพลาด';
}

export default function RoundsPage() {
  const router = useRouter();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const [rounds, setRounds] = useState<Round[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportMode, setExportMode] = useState<'all' | 'pick'>('all');
  const [exportIncludeArchived, setExportIncludeArchived] = useState(true);
  const [exportPick, setExportPick] = useState<Record<string, boolean>>({});
  const [importReview, setImportReview] = useState<{
    payload: Record<string, unknown>;
    preview: ImportPreviewResponse;
  } | null>(null);
  const [importSubmitting, setImportSubmitting] = useState(false);
  /** ค่าเริ่มต้น: แสดงเฉพาะงวดที่เปิดรับ — งวดปิด/ออกผล/ซ่อนไม่โชว์ */
  const [showAllRounds, setShowAllRounds] = useState(false);
  const fetchData = useCallback(async () => {
    try {
      const rRes = await roundsApi.list();
      setRounds(rRes.data.rounds);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!isAdmin) setShowAllRounds(false);
  }, [isAdmin]);

  const visibleRounds = useMemo(
    () => (isAdmin && showAllRounds ? rounds : rounds.filter((r) => r.status === 'open')),
    [rounds, showAllRounds, isAdmin],
  );

  const handleStatusChange = async (round: Round, status: string) => {
    setSavingId(round.id);
    try {
      await roundsApi.updateStatus(round.id, status);
      setRounds((prev) => prev.map((r) => (r.id === round.id ? { ...r, status: status as Round['status'] } : r)));
    } catch (err: any) {
      alert('เปลี่ยนสถานะไม่สำเร็จ: ' + (err?.response?.data?.message ?? err?.message ?? 'error'));
    } finally {
      setSavingId(null);
    }
  };

  const handleCreate = async () => {
    if (!newDate) return;
    const d = new Date(newDate + 'T12:00:00');
    const name = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
    setCreating(true);
    setCreateError('');
    try {
      await roundsApi.create({ name, draw_date: newDate });
      setNewDate('');
      setShowCreate(false);
      await fetchData();
    } catch (err: any) {
      const d = err?.response?.data;
      const apiMsg =
        d && typeof d === 'object' && d !== null && 'error' in d
          ? String((d as { error: string }).error)
          : undefined;
      setCreateError(apiMsg ?? err?.response?.data?.message ?? err?.message ?? 'เกิดข้อผิดพลาด');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (round: Round) => {
    if (!confirm(`ลบงวด "${round.name}" และโพยทั้งหมดในงวดนี้? ไม่สามารถกู้คืนได้`)) return;
    setDeletingId(round.id);
    try {
      await roundsApi.delete(round.id);
      setRounds(prev => prev.filter(r => r.id !== round.id));
    } catch (err: any) {
      alert('ลบไม่สำเร็จ: ' + (err?.response?.data?.message ?? err?.message ?? 'error'));
    } finally {
      setDeletingId(null);
    }
  };

  const openExportModal = () => {
    const init: Record<string, boolean> = {};
    for (const r of rounds) init[r.id] = false;
    setExportPick(init);
    setExportMode('all');
    setExportIncludeArchived(true);
    setExportModalOpen(true);
  };

  const runExport = async () => {
    setExporting(true);
    try {
      let body: { round_ids?: string[]; include_archived?: boolean };
      if (exportMode === 'all') {
        body = { include_archived: exportIncludeArchived };
      } else {
        const ids = Object.entries(exportPick)
          .filter(([, on]) => on)
          .map(([id]) => id);
        if (ids.length === 0) {
          setImportMsg({ ok: false, msg: 'เลือกอย่างน้อยหนึ่งงวดเพื่อส่งออก' });
          setTimeout(() => setImportMsg(null), 8000);
          return;
        }
        body = { round_ids: ids };
      }
      const res = await roundsApi.exportBulk(body);
      const blob = res.data as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aurax-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportModalOpen(false);
      const label =
        exportMode === 'all'
          ? exportIncludeArchived
            ? 'ทุกงวด (รวม archived)'
            : 'ทุกงวด (ยกเว้น archived)'
          : `${Object.values(exportPick).filter(Boolean).length} งวดที่เลือก`;
      setImportMsg({ ok: true, msg: `ส่งออก backup สำเร็จ — ${label}` });
    } catch (err: unknown) {
      setImportMsg({ ok: false, msg: 'Export ไม่สำเร็จ: ' + formatRoundsBackupError(err) });
    } finally {
      setExporting(false);
      setTimeout(() => setImportMsg(null), 10_000);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await file.text();
      const data = JSON.parse(text) as Record<string, unknown>;
      const prevRes = await roundsApi.importPreview(data);
      setImportReview({ payload: data, preview: prevRes.data });
    } catch (err: unknown) {
      if (err instanceof SyntaxError) {
        setImportMsg({ ok: false, msg: 'ไฟล์ไม่ใช่ JSON ที่อ่านได้' });
      } else {
        setImportMsg({ ok: false, msg: 'ตรวจสอบไฟล์ไม่สำเร็จ: ' + formatRoundsBackupError(err) });
      }
      setTimeout(() => setImportMsg(null), 12_000);
    }
  };

  const confirmImport = async () => {
    if (!importReview) return;
    setImportSubmitting(true);
    try {
      const res = await roundsApi.importRound(importReview.payload);
      const d = res.data as {
        bulk?: boolean;
        imported?: boolean;
        imported_count?: number;
        results?: { imported: boolean; round_id: string; bet_count: number; message?: string }[];
        bet_count?: number;
        message?: string;
      };

      if (d.bulk && d.results) {
        const ok = (d.imported_count ?? 0) > 0;
        const skipped = d.results.filter((x) => !x.imported).length;
        setImportMsg({
          ok,
          msg: `นำเข้าแบบหลายงวด: สำเร็จ ${d.imported_count ?? 0} งวด${skipped ? ` (ข้าม ${skipped} งวดที่มีรหัสในระบบแล้ว)` : ''}`,
        });
        await fetchData();
      } else if (d.imported) {
        setImportMsg({ ok: true, msg: `นำเข้างวดสำเร็จ (${d.bet_count ?? 0} โพย)` });
        await fetchData();
      } else {
        setImportMsg({ ok: false, msg: d.message ?? 'งวดนี้มีอยู่แล้วในระบบ — ไม่มีการเปลี่ยนแปลง' });
      }
      setImportReview(null);
    } catch (err: unknown) {
      setImportMsg({ ok: false, msg: 'Import ไม่สำเร็จ: ' + formatRoundsBackupError(err) });
    } finally {
      setImportSubmitting(false);
      setTimeout(() => setImportMsg(null), 12_000);
    }
  };

  return (
    <AppShell>
      <Header
        title="จัดการงวด"
        subtitle="สร้างงวด สถานะเปิด/ปิด — อัตราเจ้ามือสำหรับคำนวณตัดหวยกำหนดในหน้า «ตัดหวย» (ผูกกับงวดทีละงวด)"
      />
      <main className="flex-1 p-6 space-y-5">
        <div className="flex flex-wrap justify-end gap-2 items-center">
          {isAdmin ? (
            <label className="flex items-center gap-2 text-xs text-theme-text-secondary mr-auto cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showAllRounds}
                onChange={(e) => { setShowAllRounds(e.target.checked); }}
                className="rounded border-border bg-surface-100 accent-neutral"
              />
              แสดงงวดที่ปิดรับ / ออกผล / ซ่อนแล้ว
            </label>
          ) : (
            <span className="text-[11px] text-theme-text-muted mr-auto">
              ผู้ปฏิบัติงานเห็นเฉพาะงวดที่เปิดรับ
            </span>
          )}
          <input ref={importInputRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
          {isAdmin && (
            <>
              <Button variant="outline" onClick={openExportModal} title="เลือกงวดหรือส่งออกทั้งหมด">
                📤 Export backup
              </Button>
              <Button variant="outline" onClick={() => importInputRef.current?.click()}>📥 Import backup</Button>
            </>
          )}
          <Button onClick={() => setShowCreate((v) => !v)}>+ สร้างงวดใหม่</Button>
        </div>

        {importMsg && (
          <div className={`rounded-lg px-4 py-2 text-sm ${importMsg.ok ? 'bg-[var(--color-badge-success-bg)] text-[var(--color-badge-success-text)] border border-[var(--color-badge-success-border)]' : 'bg-[var(--color-badge-danger-bg)] text-[var(--color-badge-danger-text)] border border-[var(--color-badge-danger-border)]'}`}>
            {importMsg.msg}
          </div>
        )}

        {showCreate && (
          <Card className="p-5">
            <CardTitle className="mb-4">สร้างงวดใหม่</CardTitle>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-theme-text-muted uppercase tracking-wider">วันออกรางวัล</label>
                <input
                  type="date"
                  className="h-10 min-w-[11rem] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-card-bg)] px-3 text-sm font-semibold text-[var(--color-text-primary)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] focus:border-[var(--color-border-strong)] [color-scheme:light]"
                  style={{ colorScheme: 'light' }}
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                />
                {newDate && (
                  <span className="text-xs text-theme-text-muted mt-0.5">
                    ชื่องวด: {new Date(newDate + 'T12:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </span>
                )}
              </div>
              <Button onClick={handleCreate} loading={creating} disabled={!newDate}>บันทึก</Button>
              <Button variant="ghost" onClick={() => setShowCreate(false)}>ยกเลิก</Button>
            </div>
            {createError && (
              <p className="mt-2 text-sm text-[var(--color-badge-danger-text)] bg-[var(--color-badge-danger-bg)] border border-[var(--color-badge-danger-border)] rounded px-3 py-2">{createError}</p>
            )}
          </Card>
        )}

        <Card className="p-0 overflow-hidden">
          <div className="px-5 pt-5 pb-3 flex flex-wrap items-center justify-between gap-2">
            <CardTitle>
              {isAdmin && showAllRounds ? 'รายการงวดทั้งหมด' : 'งวดที่เปิดรับเท่านั้น'}
            </CardTitle>
          </div>
          {isAdmin && !showAllRounds && (
            <p className="px-5 pb-2 text-[11px] text-theme-text-muted">
              งวดที่กดปิดรับแล้วจะถูกซ่อนจากรายการนี้ — ติ๊ก «แสดงงวด…» ด้านบนเพื่อจัดการ
            </p>
          )}
          {loading ? (
            <div className="p-5 space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-10 rounded-lg bg-surface-200 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-200/40">
                    {['งวด', 'วันออก', 'โพย', 'ยอดรับ', 'สถานะ', 'จัดการ', ''].map((h, i) => (
                      <th key={i} className="text-left py-2 px-4 text-xs text-theme-text-muted font-medium uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRounds.map((round, i) => (
                    <motion.tr
                      key={round.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className="border-b border-border/40 table-row-hover"
                    >
                      <td className="py-3 px-4 font-medium text-theme-text-primary">{round.name}</td>
                      <td className="py-3 px-4 text-theme-text-secondary font-mono text-xs">
                        {new Date(round.draw_date).toLocaleDateString('th-TH')}
                      </td>
                      <td className="py-3 px-4 font-mono text-theme-text-secondary">
                        {(round.bet_count ?? 0).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 font-mono text-profit">
                        {formatBaht(round.total_revenue ?? 0)}
                      </td>
                      <td className="py-3 px-4">
                        <RoundStatusBadge status={round.status} />
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {round.status === 'closed' && (
                            <Button size="sm" variant="ghost" disabled={savingId === round.id} onClick={() => handleStatusChange(round, 'open')}>เปิด</Button>
                          )}
                          {round.status === 'open' && (
                            <Button size="sm" variant="ghost" disabled={savingId === round.id} onClick={() => handleStatusChange(round, 'closed')}>ปิด</Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => router.push(`/bets?round=${round.id}`)}>โพย</Button>
                          {isAdmin && (round.status === 'drawn' || round.status === 'archived') && (
                            <Button size="sm" variant="ghost" onClick={() => router.push(`/summary?round=${round.id}&editResult=1`)}>ผล</Button>
                          )}
                          {isAdmin && (round.status === 'drawn' || round.status === 'archived') && (
                            <Button size="sm" variant="ghost" onClick={() => router.push(`/summary?round=${round.id}`)}>สรุป</Button>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-2">
                        <button
                          onClick={() => handleDelete(round)}
                          disabled={deletingId === round.id}
                          title="ลบงวดนี้"
                          className="h-7 w-7 flex items-center justify-center rounded text-theme-text-muted hover:text-loss hover:bg-[var(--color-badge-danger-bg)] disabled:opacity-40 transition-colors text-sm"
                        >
                          {deletingId === round.id ? '…' : '✕'}
                        </button>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
              {!visibleRounds.length && (
                <p className="text-center text-theme-text-muted py-8 text-sm">
                  {isAdmin && showAllRounds
                    ? 'ยังไม่มีงวด'
                    : isAdmin
                      ? 'ไม่มีงวดที่เปิดรับ — ติ๊กแสดงงวดอื่นด้านบน หรือสร้างงวดใหม่'
                      : 'ไม่มีงวดที่เปิดรับ — สร้างงวดใหม่'}
                </p>
              )}
            </div>
          )}
        </Card>
      </main>

      <Modal open={exportModalOpen} onClose={() => !exporting && setExportModalOpen(false)} title="ส่งออก backup (.json)" size="lg">
        <div className="space-y-4 text-sm">
          <p className="text-theme-text-secondary text-xs">
            เลือกส่งออกเฉพาะงวดที่ติ๊ก หรือส่งออกชุดใหญ่ทั้งระบบ (ตามตัวเลือกด้านล่าง)
          </p>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="expmode"
                checked={exportMode === 'all'}
                onChange={() => setExportMode('all')}
                className="accent-[var(--color-accent)]"
              />
              <span>ทุกงวดในระบบ</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="expmode"
                checked={exportMode === 'pick'}
                onChange={() => setExportMode('pick')}
                className="accent-[var(--color-accent)]"
              />
              <span>เลือกเป็นรายงวด</span>
            </label>
          </div>
          {exportMode === 'all' && (
            <label className="flex items-center gap-2 text-theme-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={exportIncludeArchived}
                onChange={(e) => setExportIncludeArchived(e.target.checked)}
                className="rounded border-border bg-surface-100 accent-[var(--color-accent)]"
              />
              รวมงวดสถานะ «ซ่อนแล้ว» (archived)
            </label>
          )}
          {exportMode === 'pick' && (
            <div className="rounded-xl border border-border bg-surface-200/30 max-h-56 overflow-y-auto p-2 space-y-1">
              <div className="flex justify-between items-center px-1 pb-2 border-b border-border/50">
                <span className="text-xs text-theme-text-muted">เลือกงวด ({Object.values(exportPick).filter(Boolean).length}/{rounds.length})</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs text-accent hover:underline"
                    onClick={() => {
                      const next: Record<string, boolean> = {};
                      for (const r of rounds) next[r.id] = true;
                      setExportPick(next);
                    }}
                  >
                    เลือกทั้งหมด
                  </button>
                  <button
                    type="button"
                    className="text-xs text-theme-text-muted hover:underline"
                    onClick={() => {
                      const z: Record<string, boolean> = {};
                      for (const r of rounds) z[r.id] = false;
                      setExportPick(z);
                    }}
                  >
                    ล้าง
                  </button>
                </div>
              </div>
              {rounds.length === 0 ? (
                <p className="text-theme-text-muted text-xs py-4 text-center">ยังไม่มีงวดในระบบ</p>
              ) : (
                rounds.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-hover)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!exportPick[r.id]}
                      onChange={(e) => setExportPick((p) => ({ ...p, [r.id]: e.target.checked }))}
                      className="rounded border-border"
                    />
                    <span className="flex-1 text-theme-text-primary">{r.name}</span>
                    <span className="text-xs text-theme-text-muted font-mono">{r.draw_date?.slice(0, 10)}</span>
                  </label>
                ))
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setExportModalOpen(false)} disabled={exporting}>
              ยกเลิก
            </Button>
            <Button onClick={runExport} loading={exporting} disabled={exportMode === 'pick' && rounds.length === 0}>
              ดาวน์โหลด
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!importReview}
        onClose={() => !importSubmitting && setImportReview(null)}
        title="ตรวจสอบก่อนนำเข้า backup"
        size="lg"
      >
        {importReview && (() => {
          const pv = importReview.preview;
          const rows = pv.bulk ? pv.rounds : [{ index: 0, ...pv.round }];
          const { counts } = pv;
          const hasInvalid = counts.invalid > 0;
          return (
            <div className="space-y-4 text-sm">
              <p className="text-xs text-theme-text-secondary">
                ระบบเทียบรหัสงวด (UUID) และวันออกกับข้อมูลปัจจุบัน — งวดที่มีรหัสอยู่แล้วจะถูกข้ามตอนนำเข้า (ไม่ทับโพยเดิม)
              </p>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="px-2 py-0.5 rounded-md bg-[var(--color-badge-success-bg)] text-[var(--color-badge-success-text)] border border-[var(--color-badge-success-border)]">ใหม่ {counts.new}</span>
                <span className="px-2 py-0.5 rounded-md bg-[var(--color-badge-neutral-bg)] text-theme-text-secondary border border-[var(--color-badge-neutral-border)]">มีรหัสแล้ว (จะข้าม) {counts.id_exists}</span>
                <span className="px-2 py-0.5 rounded-md bg-[var(--color-badge-warning-bg)] text-[var(--color-badge-warning-text)] border border-[var(--color-badge-warning-border)]">วันออกซ้ำคนละรหัส {counts.date_conflict}</span>
                {hasInvalid && (
                  <span className="px-2 py-0.5 rounded-md bg-[var(--color-badge-danger-bg)] text-[var(--color-badge-danger-text)] border border-[var(--color-badge-danger-border)]">รูปแบบผิด {counts.invalid}</span>
                )}
              </div>
              <div className="rounded-xl border border-border max-h-52 overflow-y-auto divide-y divide-border/40">
                {rows.map((row) => {
                  const isInv = !('round_id' in row) || row.status === 'invalid';
                  const st = isInv ? 'invalid' : row.status;
                  const rk = 'round_id' in row ? row.round_id : `pack-${row.index}`;
                  const label =
                    st === 'new'
                      ? 'นำเข้าใหม่'
                      : st === 'id_exists'
                        ? 'ข้าม (มีรหัสแล้ว)'
                        : st === 'date_conflict'
                          ? 'เตือน: วันออกซ้ำ'
                          : 'ผิดรูปแบบ';
                  return (
                    <div key={rk} className="px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={
                            st === 'new'
                              ? 'text-profit'
                              : st === 'id_exists'
                                ? 'text-theme-text-muted'
                                : st === 'date_conflict'
                                  ? 'text-risk-medium'
                                  : 'text-loss'
                          }
                        >
                          {label}
                        </span>
                        {'round_id' in row && <span className="font-mono text-theme-text-secondary truncate max-w-[200px]">{row.round_id}</span>}
                      </div>
                      {'name' in row && row.name && (
                        <div className="text-theme-text-primary mt-0.5">{row.name}</div>
                      )}
                      {'message' in row && row.message && (
                        <div className="text-theme-text-muted mt-1">{row.message}</div>
                      )}
                    </div>
                  );
                })}
              </div>
              {hasInvalid && (
                <p className="text-loss text-xs">แก้ไขไฟล์ให้ถูกต้องก่อน — ไม่สามารถนำเข้าได้จนกว่าจะไม่มีรายการ «ผิดรูปแบบ»</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setImportReview(null)} disabled={importSubmitting}>
                  ยกเลิก
                </Button>
                <Button onClick={confirmImport} loading={importSubmitting} disabled={hasInvalid}>
                  ยืนยันนำเข้า
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>
    </AppShell>
  );
}
