/**
 * เตรียมรูปโพยถ่ายมือก่อน OCR — ขยายความละเอียด, เน้นหมึกน้ำเงิน, ลดพื้นหลังตารางพิมพ์
 * ใช้ทั้งก่อนส่ง Paddle/Google Vision และก่อน Tesseract ในเครื่อง
 */

function boxBlurGray(src: Uint8ClampedArray, w: number, h: number, out: Uint8ClampedArray): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          s += src[yy * w + xx];
          n++;
        }
      }
      out[y * w + x] = n > 0 ? Math.round(s / n) : 0;
    }
  }
}

/** ขยาย contrast ตามเปอร์ไทล์ของฮิสโตแกรม (ลดฮาโลรอบตัวอักษรจากเงาพื้นหลัง) */
function normalizeLevels(gray: Uint8ClampedArray, w: number, h: number): void {
  const hist = new Uint32Array(256);
  const n = w * h;
  for (let i = 0; i < n; i++) hist[gray[i]]++;

  let acc = 0;
  let low = 0;
  const pLow = Math.max(1, Math.floor(n * 0.04));
  const pHigh = Math.max(1, Math.floor(n * 0.97));
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= pLow) {
      low = v;
      break;
    }
  }
  acc = 0;
  let high = 255;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= n - pHigh) {
      high = v;
      break;
    }
  }
  if (high <= low + 8) return;
  const range = high - low;
  for (let i = 0; i < n; i++) {
    const v = gray[i];
    const t = ((v - low) / range) * 255;
    gray[i] = Math.max(0, Math.min(255, Math.round(t)));
  }
}

/**
 * @param file รูปต้นทาง
 * @returns PNG blob สำหรับ recognize / อัปโหลด API
 */
export async function preprocessImageForOcr(file: File | Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  try {
    const maxEdge = 3400;
    const minScale = 2.4;
    const scale = Math.max(minScale, Math.min(3.2, maxEdge / Math.max(bmp.width, bmp.height)));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file instanceof File ? file : new Blob([await file.arrayBuffer()], { type: 'image/jpeg' });

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);

    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const gray = new Uint8ClampedArray(w * h);
    const blur = new Uint8ClampedArray(w * h);

    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const blueInk = Math.max(0, b - Math.max(r, g) * 0.93);
      const darkInk = Math.max(0, 255 - lum - 18);
      const ink = Math.min(255, blueInk * 2.15 + darkInk * 0.92);
      gray[p] = Math.max(0, Math.min(255, Math.round(255 - ink)));
    }

    normalizeLevels(gray, w, h);

    boxBlurGray(gray, w, h, blur);
    for (let p = 0; p < w * h; p++) {
      const v = gray[p];
      const b = blur[p];
      const sharpened = Math.min(255, Math.max(0, v + (v - b) * 1.15));
      gray[p] = sharpened;
    }

    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const v = gray[p];
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
    }
    ctx.putImageData(imgData, 0, 0);

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
        'image/png',
        0.96,
      );
    });
  } finally {
    bmp.close();
  }
}

/** สร้างไฟล์ PNG จาก pipeline เดียวกัน — ใช้อัปโหลด `/bets/ocr-image` */
export async function makeOcrUploadFile(source: File): Promise<File> {
  const blob = await preprocessImageForOcr(source);
  const base =
    source.name.replace(/\.(heic|heif|webp|jpe?g|jpeg)$/i, '') || 'slip';
  return new File([blob], `${base}-ocrprep.png`, { type: 'image/png' });
}
