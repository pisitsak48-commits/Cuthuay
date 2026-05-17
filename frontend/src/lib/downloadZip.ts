import JSZip from 'jszip';

export type ZipEntry = { path: string; content: string | Blob | Uint8Array };

/** ดาวน์โหลดหลายไฟล์รวมเป็น .zip (เหมาะกับ Safari ที่โหลดหลายไฟล์พร้อมกันไม่ได้) */
export async function downloadZip(entries: ZipEntry[], zipFilename: string): Promise<void> {
  if (!entries.length) return;
  const zip = new JSZip();
  for (const { path, content } of entries) {
    zip.file(path, content);
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = zipFilename.endsWith('.zip') ? zipFilename : `${zipFilename}.zip`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
