/**
 * ดาวน์โหลด Blob เป็นไฟล์ — ไม่ใช้ window.open (กัน about:blank บน Safari)
 */

function sanitizeFilename(name: string): string {
  const base = name.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'download';
  return base;
}

function isSafariBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox/i.test(ua);
}

function clickDownloadAnchor(href: string, filename: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    if (a.parentNode) a.parentNode.removeChild(a);
  }, 200);
}

/** ดาวน์โหลดไฟล์จาก Blob — คืน Promise เมื่อ Safari ใช้ FileReader */
export function downloadBlobFile(blob: Blob, filename: string): Promise<void> {
  const name = sanitizeFilename(filename);

  const nav = navigator as Navigator & { msSaveOrOpenBlob?: (b: Blob, n: string) => boolean };
  if (typeof nav.msSaveOrOpenBlob === 'function') {
    nav.msSaveOrOpenBlob(blob, name);
    return Promise.resolve();
  }

  if (isSafariBrowser()) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result !== 'string') {
          reject(new Error('read blob failed'));
          return;
        }
        clickDownloadAnchor(reader.result, name);
        resolve();
      };
      reader.onerror = () => reject(new Error('read blob failed'));
      reader.readAsDataURL(blob);
    });
  }

  const url = URL.createObjectURL(blob);
  clickDownloadAnchor(url, name);
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return Promise.resolve();
}
