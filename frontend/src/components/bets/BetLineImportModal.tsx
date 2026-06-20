'use client';

import { useEffect, useMemo, type Dispatch, RefObject, SetStateAction } from 'react';
import { Bet, Customer } from '@/types';
import { parseLineBetsTextWithSegments, normalizeLinePasteText } from '@/lib/betParser';
import { COL_TYPES } from '@/lib/bets/betSheetGroups';
import type { LineOcrEngineChoice, ImageOcrSource } from '@/hooks/useBetOcr';

const LINE_OCR_ENGINE_STORAGE_KEY = 'cuthuay-line-ocr-engine';

type PreviewRow = { number: string; amounts: Record<string, number> };

export type BetLineImportModalProps = {
  lineText: string;
  setLineText: Dispatch<SetStateAction<string>>;
  onClose: () => void;
  customers: Customer[];
  selectedCustomerId: string;
  setSelectedCustomerId: Dispatch<SetStateAction<string>>;
  navigateCustomer: (dir: -1 | 1) => void;
  sheet: number;
  setSheet: Dispatch<SetStateAction<number>>;
  setSelectedGroups: Dispatch<SetStateAction<Set<string>>>;
  effectiveMaxSheets: number;
  customerBets: Bet[];
  handleRemoveSheet: () => void;
  handleAddSheet: () => void;
  currentCustomer: Customer | null | undefined;
  handleLineImport: () => void | Promise<void>;
  importResult: { ok: boolean; msg: string } | null;
  setImportResult: Dispatch<SetStateAction<{ ok: boolean; msg: string } | null>>;
  imgInputRef: RefObject<HTMLInputElement>;
  pdfInputRef: RefObject<HTMLInputElement>;
  handleImageFile: (f: File) => void | Promise<void>;
  handlePdfFile: (f: File) => void | Promise<void>;
  lineOcrEngine: LineOcrEngineChoice;
  setLineOcrEngine: Dispatch<SetStateAction<LineOcrEngineChoice>>;
  ocrLoading: boolean;
  ocrError: string;
  setOcrError: Dispatch<SetStateAction<string>>;
  imageOcrSource: ImageOcrSource | null;
  setImageOcrSource: Dispatch<SetStateAction<ImageOcrSource | null>>;
  ocrServerFallbackNote: string | null;
  setOcrServerFallbackNote: Dispatch<SetStateAction<string | null>>;
  imgDragOver: boolean;
  setImgDragOver: Dispatch<SetStateAction<boolean>>;
  pdfLoading: boolean;
  pdfDragOver: boolean;
  setPdfDragOver: Dispatch<SetStateAction<boolean>>;
  setPdfLoading: Dispatch<SetStateAction<boolean>>;
};

export function BetLineImportModal(props: BetLineImportModalProps) {
  const {
    lineText,
    setLineText,
    onClose,
    customers,
    selectedCustomerId,
    setSelectedCustomerId,
    navigateCustomer,
    sheet,
    setSheet,
    setSelectedGroups,
    effectiveMaxSheets,
    customerBets,
    handleRemoveSheet,
    handleAddSheet,
    currentCustomer,
    handleLineImport,
    importResult,
    setImportResult,
    imgInputRef,
    pdfInputRef,
    handleImageFile,
    handlePdfFile,
    lineOcrEngine,
    setLineOcrEngine,
    ocrLoading,
    ocrError,
    setOcrError,
    imageOcrSource,
    setImageOcrSource,
    ocrServerFallbackNote,
    setOcrServerFallbackNote,
    imgDragOver,
    setImgDragOver,
    pdfLoading,
    pdfDragOver,
    setPdfDragOver,
    setPdfLoading,
  } = props;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const preview = lineText.trim() ? parseLineBetsTextWithSegments(lineText) : null;

  const groupedPreview = useMemo(() => {
    const rows: PreviewRow[] = [];
    if (!preview?.bets.length) return rows;
    const map = new Map<string, PreviewRow>();
    for (const b of preview.bets) {
      const rk = `${String(b.segment_index ?? 0)}|${b.number}`;
      if (!map.has(rk)) {
        const row: PreviewRow = { number: b.number, amounts: {} };
        map.set(rk, row);
        rows.push(row);
      }
      const row = map.get(rk)!;
      row.amounts[b.bet_type] = (row.amounts[b.bet_type] ?? 0) + b.amount;
    }
    return rows;
  }, [preview]);

  return (
<div
  className="fixed inset-y-0 right-0 z-50 flex w-full justify-end pointer-events-none"
  aria-hidden={false}
>
  <div
    className="pointer-events-auto flex h-full max-h-[100dvh] w-full max-w-[min(100vw,720px)] flex-col border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--gray-50)_92%,var(--primary-50)_8%)] shadow-[var(--shadow-lift-hover)] sm:rounded-l-2xl overflow-hidden"
    role="region"
    aria-labelledby="line-import-title"
  >
    <div className="shrink-0 px-4 sm:px-5 py-3.5 border-b border-[var(--color-border)] bg-gradient-to-r from-[var(--primary-50)] via-[var(--color-surface)] to-[color-mix(in_srgb,var(--primary-100)_35%,white)] flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1">
        <h2 id="line-import-title" className="text-base font-semibold text-[var(--text-primary)] tracking-tight">รับข้อมูลไลน์</h2>
        <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed max-w-[40rem]">
          แผงด้านขวาไม่บังโต๊ะคีย์ · พิมพ์ซ้ายได้ตามปกติ · preview อัปเดตทันที · ปิดเมื่อเสร็จ (ปุ่มปิด หรือ Esc)
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 shrink-0 w-full sm:w-auto sm:pt-0.5">
        <button
          type="button"
          onClick={() => {
            onClose();
            setLineText('');
            setOcrError('');
            setOcrServerFallbackNote(null);
            setImageOcrSource(null);
            setPdfLoading(false);
            setPdfDragOver(false);
            setImportResult(null);
          }}
          className="btn-toolbar-glow btn-toolbar-muted !h-9 px-4 text-sm rounded-xl"
        >
          ปิด
        </button>
      </div>
    </div>

    {/* Body: มือถือ = คอลัมน์รับข้อความบน / preview ล่าง · lg = preview 60% + รับข้อความ 40% */}
    <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0 overflow-hidden px-4 sm:px-5 py-4">
      {/* Preview */}
      <div className="flex flex-1 flex-col gap-2 min-h-0 min-w-0 lg:min-h-[min(420px,50dvh)] lg:flex-[1.5] order-2 lg:order-1">
        <div className="text-[11px] sm:text-xs shrink-0 flex flex-wrap items-center gap-2">
          {!preview && <span className="text-[var(--chart-neutral-mid)] font-medium">ยังไม่มีข้อความ — วางในช่องข้อความด้านขวาบน</span>}
          {preview && preview.parsedCount > 0 && (
            <>
              <span className="text-[var(--color-semantic-success-muted)] font-semibold">✓ พบ {preview.parsedCount} รายการ ({groupedPreview.length} แถว)</span>
              {preview.skippedCount > 0 && <span className="text-[var(--chart-neutral-dark)] font-medium">⚠ ข้าม {preview.skippedCount} บรรทัด</span>}
            </>
          )}
          {preview && preview.parsedCount === 0 && (
            <span className="text-[var(--chart-neutral-mid)]">ไม่พบรายการที่ถูกต้อง{preview.skippedCount > 0 ? ` (ข้าม ${preview.skippedCount} บรรทัด)` : ''}</span>
          )}
        </div>

        <div className="flex-1 min-h-[200px] lg:min-h-0 flex flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)] overflow-hidden">
          <div className="shrink-0 border-b border-[color-mix(in_srgb,var(--chart-primary)_22%,var(--color-border))] bg-gradient-to-r from-[var(--primary-700)] via-[var(--primary-600)] to-[var(--primary-800)]">
            <table className="w-full table-fixed text-[11px] sm:text-xs">
              <thead>
                <tr>
                  <th className="text-left py-2.5 px-2 text-[color-mix(in_srgb,var(--text-inverse)_88%,transparent)] font-semibold w-7">#</th>
                  <th className="text-center py-2.5 px-2 text-[var(--text-inverse)] font-bold w-14 tracking-wide">เลข</th>
                  {COL_TYPES.map(c => (
                    <th key={c.key} className="text-right py-2.5 px-1.5 text-[color-mix(in_srgb,var(--text-inverse)_92%,transparent)] font-semibold">{c.label}</th>
                  ))}
                </tr>
              </thead>
            </table>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 bg-[color-mix(in_srgb,var(--gray-50)_55%,var(--color-surface))]">
            <table className="w-full table-fixed text-[11px] sm:text-xs">
              <tbody>
                {groupedPreview.length === 0 ? (
                  <tr>
                    <td colSpan={2 + COL_TYPES.length} className="py-14 text-center text-[var(--chart-neutral-mid)] text-xs font-medium">
                      ยังไม่มีแถว preview
                    </td>
                  </tr>
                ) : groupedPreview.map((row, idx) => (
                  <tr
                    key={row.number + idx}
                    className={`border-b border-[var(--chart-neutral-light)] ${idx % 2 === 0 ? 'bg-[var(--bg-glass-subtle)]' : 'bg-transparent'} hover:bg-[var(--color-nav-hover-bg)] transition-colors`}
                  >
                    <td className="py-1.5 px-2 text-[var(--chart-neutral-mid)] w-7  font-medium">{idx + 1}</td>
                    <td className="py-1.5 px-2 w-14 align-middle text-center">
                      <span className="inline-flex min-w-[2.25rem] justify-center rounded-md border border-[var(--chart-neutral-light)] bg-[var(--color-input-bg)] px-1 py-0.5  tracking-tight text-[0.85em] font-extrabold  text-[var(--chart-neutral-dark)] shadow-[inset_0_1px_0_var(--color-border-strong)]">
                        {row.number}
                      </span>
                    </td>
                    {COL_TYPES.map(c => (
                      <td key={c.key} className="py-1.5 px-1.5 text-right  tracking-tight text-[var(--chart-neutral-dark)]  font-medium">
                        {(row.amounts[c.key] ?? 0) > 0
                          ? row.amounts[c.key].toLocaleString()
                          : <span className="text-[var(--chart-neutral-mid)]">·</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {preview && preview.parsedCount > 0 && (
          <div className="text-[11px] text-[var(--chart-neutral-mid)] shrink-0">
            นำเข้าให้ <span className="text-[var(--chart-neutral-dark)] font-semibold">{currentCustomer?.name ?? '(ไม่ระบุลูกค้า)'}</span>
            <span> · แผ่น </span><span className=" tracking-tight text-[var(--chart-neutral-dark)] font-semibold">{sheet}</span>
          </div>
        )}
      </div>

      {/* รับข้อความ / OCR — lg แถวขวา ~40% */}
      <div className="w-full flex flex-1 flex-col gap-2.5 min-h-0 min-w-0 lg:flex-1 lg:min-w-[240px] order-1 lg:order-2 overflow-y-auto pr-0.5">
        <input ref={imgInputRef} type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ''; }} />
        <input ref={pdfInputRef} type="file" accept="application/pdf" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handlePdfFile(f); e.target.value = ''; }} />

        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 space-y-2 shrink-0 shadow-[var(--shadow-soft)]">
          <div className="text-[11px] font-bold text-[var(--text-primary)] tracking-wide">นำเข้าไปที่</div>
          {customers.length === 0 ? (
            <p className="text-[11px] text-[var(--chart-neutral-mid)] leading-snug font-medium">
              ยังไม่มีลูกค้าในระบบ — เพิ่มที่เมนูลูกค้าก่อน
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[var(--chart-neutral-mid)] shrink-0 w-11 font-medium">ลูกค้า</span>
                <select
                  value={selectedCustomerId}
                  onChange={(e) => setSelectedCustomerId(e.target.value)}
                  className="flex-1 h-8 min-w-0 rounded-lg bg-[var(--color-input-bg)] border-2 border-[var(--chart-neutral-light)] px-2 text-xs text-[var(--chart-neutral-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] focus:border-[var(--chart-primary)]"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => navigateCustomer(-1)}
                  className="btn-toolbar-glow btn-toolbar-muted !h-8 !px-2 !text-[11px] rounded-lg font-semibold shrink-0"
                >
                  ขึ้น
                </button>
                <button
                  type="button"
                  onClick={() => navigateCustomer(1)}
                  className="btn-toolbar-glow btn-fintech-search !h-8 !px-2 !text-[11px] rounded-lg font-semibold shrink-0"
                >
                  ลง
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[var(--chart-neutral-mid)] shrink-0 w-11 font-medium">แผ่น</span>
                <select
                  value={sheet}
                  onChange={(e) => {
                    setSheet(Number(e.target.value));
                    setSelectedGroups(new Set());
                  }}
                  disabled={!selectedCustomerId}
                  className="flex-1 h-8 min-w-0 rounded-lg bg-[var(--color-input-bg)] border-2 border-[var(--chart-neutral-light)] px-2 text-xs text-[var(--chart-neutral-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] focus:border-[var(--chart-primary)]  tracking-tight disabled:opacity-45"
                >
                  {Array.from({ length: effectiveMaxSheets }, (_, i) => effectiveMaxSheets - i).map((n) => (
                    <option key={n} value={n}>
                      {n}{customerBets.filter((b) => (b.sheet_no ?? 1) === n).length > 0 ? ' ●' : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleRemoveSheet}
                  className="btn-toolbar-glow btn-toolbar-danger !h-8 !w-8 !min-w-[2rem] !p-0 flex items-center justify-center text-base font-bold rounded-lg shrink-0"
                  title="ลบแผ่น (ลบได้เมื่อไม่มีข้อมูล)"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={handleAddSheet}
                  className="btn-toolbar-glow btn-toolbar-profit !h-8 !w-8 !min-w-[2rem] !p-0 flex items-center justify-center text-base font-bold rounded-lg shrink-0"
                  title="เพิ่มแผ่นใหม่"
                >
                  +
                </button>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:flex-wrap">
          <button
            type="button"
            onClick={() => setLineText(normalizeLinePasteText(lineText))}
            disabled={!lineText.trim()}
            className="text-[11px] px-3 py-2 rounded-lg border border-[var(--chart-primary)]/35 bg-[var(--primary-50)] text-[var(--primary-800)] font-semibold hover:bg-[var(--primary-100)] hover:border-[var(--chart-primary)]/55 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-200 shrink-0"
          >
            ตัดคำนำหน้าไลน์
          </button>
          <div className="flex-1 min-w-[12rem] rounded-lg border border-[var(--color-badge-info-border)] bg-[var(--color-badge-info-bg)] px-3 py-2 text-[11px] leading-snug text-[var(--color-badge-info-text)]">
            <span className="font-semibold text-[var(--primary-800)]">ลบสิ่งรบกวน:</span>{' '}
            เวลา Mo · ชื่อผู้ส่ง · บรรทัดแทรก — จัดเครื่องหมาย &quot;×&quot; เป็น *
          </div>
        </div>

        <textarea
          value={lineText}
          onChange={e => setLineText(e.target.value)}
          onPaste={e => {
            const pasted = e.clipboardData.getData('text/plain');
            if (pasted === '') return;
            e.preventDefault();
            const normalized = normalizeLinePasteText(pasted);
            const el = e.currentTarget;
            const start = el.selectionStart ?? 0;
            const end = el.selectionEnd ?? 0;
            setLineText(prev => {
              const before = prev.slice(0, start);
              const after = prev.slice(end);
              const headSep =
                before.length > 0 && !before.endsWith('\n') && normalized.length > 0 ? '\n' : '';
              const tailSep =
                normalized.length > 0 && after.length > 0 && !after.startsWith('\n') ? '\n' : '';
              const insert = headSep + normalized + tailSep;
              const next = before + insert + after;
              requestAnimationFrame(() => {
                const pos = before.length + insert.length;
                el.selectionStart = el.selectionEnd = Math.min(pos, next.length);
                el.scrollTop = el.scrollHeight;
              });
              return next;
            });
          }}
          placeholder={"วางข้อความจากไลน์\nเช่น:\n12=100×100\n38=50×50\n470 บ50 ต50\n\n21\n26\n60=50×50"}
          className="flex-1 min-h-[140px] lg:min-h-[200px] max-h-[40dvh] lg:max-h-none rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]  tracking-tight resize-y focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] focus:border-[var(--chart-primary)] shadow-[var(--shadow-input-inner)]"
        />

        <div className="flex gap-2 shrink-0 items-stretch">
          <button
            type="button"
            onClick={handleLineImport}
            disabled={!preview || preview.parsedCount === 0 || !selectedCustomerId || customers.length === 0}
            className="btn-primary-glow flex-1 min-w-0 !h-10 text-sm rounded-xl font-semibold disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
          >
            นำเข้า{preview && preview.parsedCount > 0 ? ` (${preview.parsedCount})` : ''}
          </button>
          <button
            type="button"
            onClick={() => {
              setLineText('');
              setImportResult(null);
              setOcrError('');
              setOcrServerFallbackNote(null);
              setImageOcrSource(null);
            }}
            disabled={!lineText.trim()}
            title="ล้างข้อความในกล่อง (กรณี OCR ผิด)"
            className="shrink-0 px-3 !h-10 text-[11px] font-semibold rounded-xl border-2 border-[var(--chart-primary)] bg-[var(--primary-100)] text-[var(--primary-800)] hover:bg-[var(--primary-200)] hover:border-[var(--chart-primary-dark)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-200 shadow-sm"
          >
            เคลียร์
          </button>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)] font-medium">
          <div className="flex-1 border-t border-[var(--color-border)]" />
          <span className="text-[var(--text-primary)]">หรืออัปโหลดรูป / PDF</span>
          <div className="flex-1 border-t border-[var(--color-border)]" />
        </div>

        <label className="flex flex-col gap-1 text-[11px] text-[var(--chart-neutral-mid)] px-0.5">
          <span className="font-bold text-[var(--chart-neutral-dark)]">OCR รูปโพย</span>
          <select
            value={lineOcrEngine}
            onChange={(e) => {
              const v = e.target.value as LineOcrEngineChoice;
              setLineOcrEngine(v);
              try {
                localStorage.setItem(LINE_OCR_ENGINE_STORAGE_KEY, v);
              } catch {
                /* noop */
              }
            }}
            className="rounded-lg border-2 border-[var(--chart-neutral-light)] bg-[var(--color-input-bg)] px-2 py-1.5 text-xs text-[var(--chart-neutral-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] focus:border-[var(--chart-primary)]"
          >
            <option value="auto">อัตโนมัติ — Paddle ก่อน แล้ว Google Vision (ประหยัดโควตา Vision; ปรับที่ API: OCR_IMAGE_AUTO_ORDER)</option>
            <option value="google-vision">Google Cloud Vision เท่านั้น</option>
            <option value="paddle">PaddleOCR บนเซิร์ฟเวอร์เท่านั้น</option>
            <option value="browser">ไม่เรียก API — ใช้ Tesseract ในเบราว์เซอร์</option>
          </select>
        </label>

        <div
          onDragOver={e => { e.preventDefault(); setImgDragOver(true); }}
          onDragLeave={() => setImgDragOver(false)}
          onDrop={e => { e.preventDefault(); setImgDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleImageFile(f); }}
          onClick={() => imgInputRef.current?.click()}
          className={`flex items-center justify-center min-h-[3.25rem] rounded-xl border-2 border-dashed px-3 cursor-pointer text-xs transition-colors duration-200 select-none font-medium
            ${imgDragOver ? 'border-[var(--chart-primary)] bg-[var(--chart-primary-soft)] text-[var(--chart-neutral-dark)]' : 'border-[var(--chart-neutral-mid)]/45 bg-[var(--color-input-bg)] hover:border-[var(--chart-primary)] hover:bg-[var(--color-nav-hover-bg)] text-[var(--chart-neutral-mid)] hover:text-[var(--chart-neutral-dark)]'}`}
        >
          {ocrLoading
            ? <span className="text-[var(--chart-neutral-dark)] animate-pulse">กำลังอ่านรูป…</span>
            : <span>ลากรูปหรือคลิกเลือกไฟล์</span>}
        </div>
        {ocrError && (
          <div className="text-xs text-[var(--color-badge-danger-text)] bg-[var(--color-badge-danger-bg)] border border-[var(--color-badge-danger-border)] rounded-lg px-2 py-1.5 shrink-0">
            {ocrError}
          </div>
        )}
        {ocrServerFallbackNote && !ocrError && (
          <div className="text-[11px] leading-snug text-[var(--text-accent)] bg-[var(--color-badge-warning-bg)] border border-[var(--color-badge-warning-border)] rounded-lg px-2 py-1.5 shrink-0">
            <span className="font-semibold">เซิร์ฟเวอร์ OCR ไม่ได้ข้อความ</span>
            {' — '}
            {ocrServerFallbackNote}
            {' · '}
            <span className="italic">ใช้ Tesseract ในเครื่องแทน — ตรวจสอบ credentials / Paddle บน API ถ้าต้องการให้อ่านจากเซิร์ฟเวอร์</span>
          </div>
        )}
        {imageOcrSource && (
          <p className="text-[11px] text-[var(--chart-neutral-mid)] px-0.5 -mt-1 leading-relaxed">
            <span className="font-bold text-[var(--color-semantic-success-muted)]">OCR รอบนี้:</span>{' '}
            {imageOcrSource === 'paddle'
              ? 'PaddleOCR บนเซิร์ฟเวอร์'
              : imageOcrSource === 'google-vision'
                ? 'Google Cloud Vision (Document Text Detection)'
                : 'Tesseract ในเบราว์เซอร์ (สำรอง / หรือเลือกไม่เรียก API)'}
          </p>
        )}
        <p className="text-[11px] leading-relaxed text-[var(--chart-neutral-mid)] px-0.5 font-medium">
          รูปจะถูกประมวลผลก่อนส่ง OCR (ขยายความละเอียด เน้นหมึกน้ำเงิน/ลดพื้นหลังตาราง) — Paddle บนเซิร์ฟเวอร์ก็ใช้ขั้นตอนคล้ายกันหลังอัปโหลด · อัตโนมัติหรือเบราว์เซอร์ — สำรอง Tesseract ได้
        </p>

        <div
          onDragOver={e => { e.preventDefault(); setPdfDragOver(true); }}
          onDragLeave={() => setPdfDragOver(false)}
          onDrop={e => {
            e.preventDefault(); setPdfDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f) handlePdfFile(f);
          }}
          onClick={() => pdfInputRef.current?.click()}
          className={`flex items-center justify-center min-h-[3.25rem] rounded-xl border-2 border-dashed px-3 cursor-pointer text-xs transition-colors duration-200 select-none font-medium
            ${pdfDragOver ? 'border-[var(--chart-primary)] bg-[var(--chart-primary-soft)] text-[var(--chart-neutral-dark)]' : 'border-[var(--chart-neutral-mid)]/45 bg-[var(--color-input-bg)] hover:border-[var(--chart-primary)] hover:bg-[var(--color-nav-hover-bg)] text-[var(--chart-neutral-mid)] hover:text-[var(--chart-neutral-dark)]'}`}
        >
          {pdfLoading
            ? <span className="text-[var(--chart-neutral-dark)] animate-pulse">กำลังอ่าน PDF…</span>
            : <span>ลาก PDF หรือคลิกเลือกไฟล์</span>}
        </div>
      </div>
    </div>

    {importResult && (
      <div className="shrink-0 px-4 sm:px-5 py-2.5 border-t border-[var(--color-border)] bg-[var(--color-card-bg-solid)] safe-area-pb">
        <span className={`text-sm font-semibold ${importResult.ok ? 'text-profit' : 'text-loss'}`}>
          {importResult.msg}
        </span>
      </div>
    )}
  </div>
</div>
  );
}
