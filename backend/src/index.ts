import './config/env'; // validate env first
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { env } from './config/env';
import { pool } from './config/database';
import { errorHandler, notFound } from './middleware/errorHandler';
import { initWebSocket } from './websocket/handler';

import authRouter      from './routes/auth';
import betsRouter      from './routes/bets';
import roundsRouter    from './routes/rounds';
import cutRouter       from './routes/cut';
import limitsRouter    from './routes/limits';
import reportsRouter   from './routes/reports';
import customersRouter from './routes/customers';
import dealersRouter        from './routes/dealers';
const app = express();
const server = http.createServer(app);

// ─── Security & Middleware ────────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(helmet());
const corsOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
app.use(
  cors({
    origin: corsOrigins.length <= 1 ? (corsOrigins[0] ?? true) : corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
    skip: (req) => req.originalUrl.startsWith('/api/line/webhook'),
  }),
);
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
const jsonBodyDefault = express.json({ limit: '5mb' });
const jsonBodyLarge = express.json({ limit: '100mb' });
app.use((req, res, next) => {
  const pathOnly = (req.originalUrl.split('?')[0] ?? '') as string;
  const allowLargeBody =
    (req.method === 'POST' || req.method === 'PUT') &&
    (pathOnly === '/api/rounds/import' || pathOnly === '/api/rounds/import-preview');
  (allowLargeBody ? jsonBodyLarge : jsonBodyDefault)(req, res, next);
});
app.use(express.urlencoded({ extended: false }));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// หน้าเว็บจริงอยู่พอร์ต frontend (3000) — แค่บอกทางเมื่อเปิดพอร์ต API โดยตรง
app.get('/', (_req, res) => {
  res.json({
    name: 'AuraX API',
    hint: 'เปิดแอปที่พอร์ต 3000 (frontend); เส้นทาง API อยู่ภายใต้ /api/...',
    health: '/health',
    example: '/api/auth/setup-status',
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',      authRouter);
app.use('/api/bets',      betsRouter);
app.use('/api/rounds',    roundsRouter);
app.use('/api/cut',       cutRouter);
app.use('/api/limits',    limitsRouter);
app.use('/api/reports',   reportsRouter);
app.use('/api/customers', customersRouter);
app.use('/api/dealers',   dealersRouter);

// ─── 404 + Error Handling ─────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── WebSocket ────────────────────────────────────────────────────────────────
initWebSocket(server);

// ─── Security config sanity check ────────────────────────────────────────────
if (env.COOKIE_AUTH_ENABLED && !env.CSRF_ENABLED) {
  console.warn(
    '\n⚠️  WARNING: COOKIE_AUTH_ENABLED=true but CSRF_ENABLED=false.' +
    ' Cookie-based auth without CSRF protection is vulnerable to CSRF attacks.' +
    ' Set CSRF_ENABLED=true in production.\n',
  );
}

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(env.PORT, () => {
  console.log(`\n🚀 AuraX API running on http://localhost:${env.PORT}`);
  console.log(`   WebSocket: ws://localhost:${env.PORT}/ws`);
  console.log(`   Mode: ${env.NODE_ENV}\n`);
});

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`\n[${signal}] Shutting down gracefully...`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

export default app;
