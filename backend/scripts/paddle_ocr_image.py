#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
อ่านรูปโพยด้วย PaddleOCR แล้วส่งออก JSON { "text": "...", "lines": [...] }
เรียงลำดับแบบอ่านซ้าย→ขวา บน→ล่าง จาก bounding box

ติดตั้ง (แนะนำ venv):
  cd backend && python3 -m venv .venv && source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
  pip install -r requirements-ocr.txt

macOS Apple Silicon อาจต้องดู https://www.paddlepaddle.org.cn/install/quick

ทดสอบ:
  python3 scripts/paddle_ocr_image.py /path/to/image.png
"""
from __future__ import annotations

import json
import os
import sys
import tempfile


def _preprocess_for_slip(img_path: str) -> str:
    """
    เน้นหมึกน้ำเงิน / เส้นมือบนกระดาษพิมพ์ตาราง — คืน path รูป PNG ชั่วคราว (หรือเดิมถ้าไม่มี numpy/PIL)
    """
    try:
        import numpy as np
        from PIL import Image, ImageFilter, ImageEnhance
    except ImportError:
        return img_path

    try:
        im = Image.open(img_path).convert("RGB")
        arr = np.asarray(im, dtype=np.float32)
        r = arr[:, :, 0]
        g = arr[:, :, 1]
        b = arr[:, :, 2]
        lum = 0.299 * r + 0.587 * g + 0.114 * b
        blue_ink = np.clip(b - np.maximum(r, g) * 0.93, 0, 255)
        dark_ink = np.clip(255.0 - lum - 18.0, 0, 255)
        ink = np.clip(blue_ink * 2.15 + dark_ink * 0.92, 0, 255)
        gray = np.clip(255.0 - ink, 0, 255).astype(np.uint8)
        out = Image.fromarray(gray, mode="L")
        out = ImageEnhance.Contrast(out).enhance(1.28)
        out = out.filter(ImageFilter.UnsharpMask(radius=2, percent=130, threshold=3))
        fd, tmp = tempfile.mkstemp(suffix=".png", prefix="paddle-ocrprep-")
        os.close(fd)
        out.save(tmp, format="PNG", optimize=True)
        return tmp
    except Exception:
        return img_path


def _cluster_lines(
    items: list[tuple[float, float, float, float, str, float]],
    row_tol: float = 22.0,
) -> list[list[tuple[float, str, float]]]:
    """รวมกล่องที่ top-y ใกล้กันเป็นแถวเดียวกัน แล้วเรียง x ในแถว"""
    if not items:
        return []
    items_sorted = sorted(items, key=lambda t: (t[0], t[1]))
    rows: list[list[tuple[float, str, float]]] = []
    current: list[tuple[float, str, float]] = []
    anchor_y: float | None = None

    for top, left, _right, _bottom, txt, conf in items_sorted:
        if anchor_y is None or abs(top - anchor_y) <= row_tol:
            current.append((left, txt, conf))
            if anchor_y is None:
                anchor_y = top
            else:
                anchor_y = (anchor_y * (len(current) - 1) + top) / len(current)
        else:
            current.sort(key=lambda t: t[0])
            rows.append(current)
            current = [(left, txt, conf)]
            anchor_y = top
    if current:
        current.sort(key=lambda t: t[0])
        rows.append(current)
    return rows


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: paddle_ocr_image.py <image_path>", "text": ""}))
        sys.exit(2)
    img_path = sys.argv[1]
    if not os.path.isfile(img_path):
        print(json.dumps({"error": f"not a file: {img_path}", "text": ""}))
        sys.exit(2)

    try:
        from paddleocr import PaddleOCR  # type: ignore
    except ImportError:
        print(
            json.dumps(
                {
                    "error": "paddleocr not installed — pip install -r backend/requirements-ocr.txt",
                    "text": "",
                },
                ensure_ascii=False,
            )
        )
        sys.exit(3)

    work_path = _preprocess_for_slip(img_path)
    cleanup_pre = work_path != img_path

    # lang='en' เน้นตัวเลข/Latin สำหรับโพย; ถ้าอ่านเลขพลาดลองเปลี่ยนเป็น 'ch'
    ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
    try:
        result = ocr.ocr(work_path, cls=True)
    finally:
        if cleanup_pre and os.path.isfile(work_path):
            try:
                os.remove(work_path)
            except OSError:
                pass

    if not result or not result[0]:
        print(json.dumps({"text": "", "lines": [], "engine": "paddleocr"}, ensure_ascii=False))
        return

    raw_items: list[tuple[float, float, float, float, str, float]] = []
    for block in result[0]:
        if not block:
            continue
        box, (txt, conf) = block
        if not txt or not str(txt).strip():
            continue
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) for p in box]
        top, left = min(ys), min(xs)
        right, bottom = max(xs), max(ys)
        raw_items.append((top, left, right, bottom, str(txt).strip(), float(conf)))

    row_groups = _cluster_lines(raw_items)
    text_lines: list[str] = []
    for row in row_groups:
        parts = [t[1] for t in row]
        # ต่อด้วยช่องว่าง — โพยแนวตารางมักต้องการแยกคอลัมน์
        text_lines.append(" ".join(parts))
    full_text = "\n".join(text_lines)

    out = {
        "text": full_text,
        "lines": text_lines,
        "engine": "paddleocr",
    }
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
