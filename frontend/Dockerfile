# bookworm-slim (glibc) — Alpine/musl ทำให้ @next/swc-linux-arm64-gnu โหลดไม่ได้ (__res_init)
FROM node:20-bookworm-slim AS builder
WORKDIR /app
# rewrite /api → ชื่อ service ใน docker-compose (เครือข่ายภายใน)
ARG BACKEND_INTERNAL_URL=http://backend:4000
ENV BACKEND_INTERNAL_URL=$BACKEND_INTERNAL_URL
COPY package*.json ./
# ECONNRESET ระหว่างโหลดจาก registry — retry + cache + timeout ยาวขึ้น
RUN npm config set fetch-retries 5 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm config set fetch-timeout 300000
RUN --mount=type=cache,target=/root/.npm \
    sh -c 'for n in 1 2 3 4 5; do npm ci && exit 0; echo "npm ci attempt $n failed, retrying..."; sleep 15; done; exit 1'
COPY . .
# ฟอนต์โหลดตอนรันผ่าน <link> ใน layout — ไม่ต้องมีเน็ตตอน build (next/font/google เคยพังในห้อง Docker)
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json .
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["npm", "start"]
