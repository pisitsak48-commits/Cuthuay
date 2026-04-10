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
import dealersRouter   from './routes/dealers';

const app = express();
const server = http.createServer(app);

// ─── Security & Middleware ────────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
  }),
);
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false }));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
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

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(env.PORT, () => {
  console.log(`\n🚀 CutHuay API running on http://localhost:${env.PORT}`);
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
