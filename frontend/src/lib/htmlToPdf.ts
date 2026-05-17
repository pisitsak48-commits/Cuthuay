/**
 * แปลง HTML fragment (สไตล์เดียวกับ preview พิมพ์) เป็นไฟล์ PDF แล้วดาวน์โหลด
 * หลาย .print-sheet → หนึ่งไฟล์หลายหน้า
 */

import { downloadBlobFile } from '@/lib/downloadBlob';
import {
  renderFragmentToPngDataUrl,
  splitPrintSheetHtml,
  type DownloadHtmlAsPngOpts,
} from '@/lib/htmlToPng';

const PX_TO_MM = 0.264583;

function sanitizeFilenamePart(s: string, maxLen: number): string {
  const t = s.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'export';
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

function loadImageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('image load failed'));
    img.src = dataUrl;
  });
}

function addImageFitA4(
  pdf: import('jspdf').jsPDF,
  dataUrl: string,
  imgW: number,
  imgH: number,
  pixelRatio: number,
): void {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const mmW = (imgW / pixelRatio) * PX_TO_MM;
  const mmH = (imgH / pixelRatio) * PX_TO_MM;
  const scale = Math.min(pageW / mmW, pageH / mmH);
  const w = mmW * scale;
  const h = mmH * scale;
  const x = (pageW - w) / 2;
  const y = (pageH - h) / 2;
  pdf.addImage(dataUrl, 'PNG', x, y, w, h, undefined, 'FAST');
}

export type DownloadHtmlAsPdfOpts = DownloadHtmlAsPngOpts;

/** เรนเดอร์ HTML เป็น PDF แล้วดาวน์โหลดทันที (ไม่เปิดแท็บ / ไม่เปิดกล่องพิมพ์) */
export async function downloadHtmlAsPdf(opts: DownloadHtmlAsPdfOpts): Promise<void> {
  const { bodyHtml, filenameBase, widthPx = 820, pixelRatio = 2 } = opts;
  const base = sanitizeFilenamePart(filenameBase, 80);
  const fragments = splitPrintSheetHtml(bodyHtml);

  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  for (let i = 0; i < fragments.length; i++) {
    if (i > 0) pdf.addPage();
    const dataUrl = await renderFragmentToPngDataUrl(fragments[i], widthPx, pixelRatio);
    const { w, h } = await loadImageSize(dataUrl);
    addImageFitA4(pdf, dataUrl, w, h, pixelRatio);
  }

  const blob = pdf.output('blob') as Blob;
  await downloadBlobFile(blob, `${base}.pdf`);
}
