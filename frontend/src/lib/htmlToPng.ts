/**
 * แปลง HTML fragment (สไตล์เดียวกับ preview พิมพ์) เป็นภาพ PNG แล้วสั่งดาวน์โหลด
 * ใช้ส่งไลน์เจ้ามือแทนการแคปหน้าจอ
 * หลาย .print-sheet → แยก PNG ต่อหน้าแล้วรวมเป็น .zip
 */

import { toPng } from 'html-to-image';
import { PRINT_DOCUMENT_STYLES } from '@/lib/printPreview';
import { themeHex } from '@/lib/printColorTokens';
import { appendPrintGoogleFontLinks, PRINT_ROOT_INLINE_STYLE } from '@/lib/printTypography';
import { downloadZip } from '@/lib/downloadZip';

function sanitizeFilenamePart(s: string, maxLen: number): string {
  const t = s.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'export';
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

export type DownloadHtmlAsPngOpts = {
  /** เนื้อใน (เช่น หลายบล็อก .print-sheet ต่อกัน) — ห้ามมี wrapper html/body */
  bodyHtml: string;
  filenameBase: string;
  /** ความกว้างเรนเดอร์ ~ใบ A4 บนแสดงผล */
  widthPx?: number;
  pixelRatio?: number;
};

/** แยก HTML เป็นหนึ่ง fragment ต่อ .print-sheet */
export function splitPrintSheetHtml(bodyHtml: string): string[] {
  const host = document.createElement('div');
  host.innerHTML = bodyHtml.trim();
  const sheets = host.querySelectorAll('.print-sheet');
  if (sheets.length === 0) return [bodyHtml];
  return Array.from(sheets).map((el) => el.outerHTML);
}

function triggerPngDownload(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function renderFragmentToPngDataUrl(
  fragmentHtml: string,
  widthPx: number,
  pixelRatio: number,
): Promise<string> {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = [
    'position:fixed',
    'left:-20000px',
    'top:0',
    `width:${widthPx}px`,
    `background:${themeHex.surface}`,
    'pointer-events:none',
    'overflow:visible',
  ].join(';');

  appendPrintGoogleFontLinks(host);

  const styleEl = document.createElement('style');
  styleEl.textContent = PRINT_DOCUMENT_STYLES;

  const root = document.createElement('div');
  root.className = 'print-root print-formal-doc';
  root.style.cssText = [
    'width:100%',
    PRINT_ROOT_INLINE_STYLE,
    `color:${themeHex.textPrimary}`,
    'box-sizing:border-box',
  ].join(';');
  root.innerHTML = fragmentHtml;

  host.appendChild(styleEl);
  host.appendChild(root);
  document.body.appendChild(host);

  try {
    await document.fonts.ready;
    return await toPng(root, {
      pixelRatio,
      backgroundColor: themeHex.surface,
      cacheBust: true,
    });
  } finally {
    document.body.removeChild(host);
  }
}

/** renderFragmentToPngDataUrl wrapper that accepts an options object (used by cut/page) */
export async function renderHtmlToPngDataUrl(opts: {
  bodyHtml: string;
  widthPx?: number;
  pixelRatio?: number;
}): Promise<string> {
  return renderFragmentToPngDataUrl(opts.bodyHtml, opts.widthPx ?? 820, opts.pixelRatio ?? 2);
}

/** Trigger browser download of a data URL with a given filename */
export function downloadDataUrlAsFile(dataUrl: string, filename: string): void {
  triggerPngDownload(dataUrl, filename);
}

/** Download multiple PNG entries as a ZIP file */
export async function downloadPngZip(
  entries: Array<{ dataUrl: string; filename: string }>,
  zipBase: string,
): Promise<void> {
  const zipEntries = await Promise.all(
    entries.map(async ({ dataUrl, filename }) => {
      const res = await fetch(dataUrl);
      const content = await res.blob();
      return { path: filename, content };
    }),
  );
  await downloadZip(zipEntries, zipBase);
}

export async function downloadHtmlAsPng(opts: DownloadHtmlAsPngOpts): Promise<void> {
  const { bodyHtml, filenameBase, widthPx = 820, pixelRatio = 2 } = opts;
  const base = sanitizeFilenamePart(filenameBase, 80);
  const fragments = splitPrintSheetHtml(bodyHtml);

  if (fragments.length <= 1) {
    const dataUrl = await renderFragmentToPngDataUrl(bodyHtml, widthPx, pixelRatio);
    triggerPngDownload(dataUrl, `${base}.png`);
    return;
  }

  const zipEntries: { path: string; content: Blob }[] = [];
  for (let i = 0; i < fragments.length; i++) {
    const dataUrl = await renderFragmentToPngDataUrl(fragments[i], widthPx, pixelRatio);
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const pageNo = String(i + 1).padStart(2, '0');
    zipEntries.push({ path: `${base}_หน้า${pageNo}.png`, content: blob });
  }
  await downloadZip(zipEntries, `${base}_ทุกหน้า`);
}
