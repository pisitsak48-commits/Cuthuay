# Debian (glibc) — PaddlePaddle ไม่รองรับ musl ของ Alpine
# แนะนำ build สำหรับ linux/amd64: docker build --platform linux/amd64 -t aurax-api .
FROM node:20-bookworm-slim AS builder
WORKDIR /app
# ถ้า NODE_ENV=production ตอน build, `npm ci` จะไม่ลง devDependencies → ไม่มี typescript / tsc พัง
ENV NODE_ENV=development
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# ไลบรารีระบบสำหรับ paddle / opencv / numpy
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    libglib2.0-0 \
    libgl1 \
    libgomp1 \
    libsm6 \
    libxext6 \
    libxrender1 \
  && rm -rf /var/lib/apt/lists/*

COPY requirements-ocr.txt ./requirements-ocr.txt
RUN python3 -m venv /opt/ocr-venv \
  && /opt/ocr-venv/bin/pip install --no-cache-dir --upgrade pip setuptools wheel \
  && /opt/ocr-venv/bin/pip install --no-cache-dir -r ./requirements-ocr.txt

# โหลดโมเดลระหว่าง build — คำขอ OCR แรกใน container จะไม่รอดาวน์โหลด
RUN /opt/ocr-venv/bin/python3 -c \
  "from paddleocr import PaddleOCR; PaddleOCR(use_angle_cls=True, lang='en', show_log=False)"

ENV PADDLE_OCR_PYTHON=/opt/ocr-venv/bin/python3

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/assets ./assets
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package.json .
RUN mkdir -p /app/reports
EXPOSE 4000
CMD ["node", "dist/index.js"]
