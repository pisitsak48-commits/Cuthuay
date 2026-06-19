import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { getTraceId } from './trace';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
}

type ErrorEnvelope = {
  error: string;
  code: string;
  trace_id: string;
  details?: unknown;
  detail?: unknown;
  stack?: string;
};

export function canonicalCodeFromStatus(status: number): string {
  if (status === 400) return 'BAD_REQUEST';
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  return status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR';
}

function sendError(res: Response, status: number, payload: ErrorEnvelope): void {
  res.status(status).json(payload);
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const traceId = getTraceId(req);
  const route = (req.originalUrl.split('?')[0] ?? req.path) || '/';
  const method = req.method;
  const userId = req.user?.sub ?? null;

  if (err instanceof ZodError) {
    sendError(res, 400, {
      error: 'Validation error',
      code: 'VALIDATION_ERROR',
      trace_id: traceId,
      details: err.flatten().fieldErrors,
    });
    return;
  }

  const pg = err as { code?: string; detail?: string; constraint?: string; message?: string };

  // PostgreSQL unique violation
  if (pg.code === '23505') {
    sendError(res, 409, {
      error: 'Duplicate entry',
      code: 'DUPLICATE_ENTRY',
      trace_id: traceId,
      detail: pg.detail,
    });
    return;
  }

  // FK / CHECK — มักเกิดตอน import ข้อมูลจากเครื่องอื่น
  if (pg.code === '23503') {
    logger.warn('db_foreign_key_violation', {
      trace_id: traceId,
      route,
      method,
      status: 400,
      user_id: userId,
      pg_code: pg.code,
      pg_detail: pg.detail,
    });
    sendError(res, 400, {
      error: 'ข้อมูลอ้างอิงไม่มีในระบบ (เช่น dealer / customer)',
      code: 'FOREIGN_KEY_VIOLATION',
      trace_id: traceId,
      detail: pg.detail,
    });
    return;
  }
  if (pg.code === '23514') {
    logger.warn('db_check_violation', {
      trace_id: traceId,
      route,
      method,
      status: 400,
      user_id: userId,
      pg_code: pg.code,
      pg_detail: pg.detail,
    });
    sendError(res, 400, {
      error: 'ค่าไม่ตรงกับเงื่อนไขฐานข้อมูล',
      code: 'CHECK_VIOLATION',
      trace_id: traceId,
      detail: pg.detail,
    });
    return;
  }
  if (pg.code === '22P02') {
    logger.warn('db_invalid_input', {
      trace_id: traceId,
      route,
      method,
      status: 400,
      user_id: userId,
      pg_code: pg.code,
      pg_detail: pg.detail,
    });
    sendError(res, 400, {
      error: 'รูปแบบข้อมูลไม่ถูกต้อง',
      code: 'INVALID_INPUT_FORMAT',
      trace_id: traceId,
      detail: pg.detail,
    });
    return;
  }

  const status = err.statusCode ?? 500;
  const message = status < 500 ? err.message : 'Internal server error';
  const code = err.code ?? canonicalCodeFromStatus(status);

  if (status >= 500) {
    logger.error('unhandled_error', {
      trace_id: traceId,
      route,
      method,
      status,
      user_id: userId,
      message: err instanceof Error ? err.message : String(err),
      pg_code: pg.code,
      pg_detail: pg.detail,
    });
  }

  sendError(res, status, {
    error: message,
    code,
    trace_id: traceId,
    ...(env.NODE_ENV === 'development' && status >= 500 ? { stack: err.stack } : {}),
  });
}

export function notFound(req: Request, res: Response): void {
  sendError(res, 404, {
    error: 'Route not found',
    code: 'NOT_FOUND',
    trace_id: getTraceId(req),
  });
}

export function createError(message: string, statusCode = 500): AppError {
  const err: AppError = new Error(message);
  err.statusCode = statusCode;
  err.code = canonicalCodeFromStatus(statusCode);
  return err;
}

/** Legacy compatibility layer: map old `{ error: ... }` responses into canonical envelope. */
export function legacyErrorEnvelopeMiddleware(req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);
  res.json = ((body?: unknown) => {
    const status = res.statusCode;
    if (
      status >= 400 &&
      body &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      Object.prototype.hasOwnProperty.call(body, 'error')
    ) {
      const raw = body as Record<string, unknown>;
      if (!raw.code || !raw.trace_id) {
        const merged: Record<string, unknown> = {
          ...raw,
          code: String(raw.code ?? canonicalCodeFromStatus(status)),
          trace_id: String(raw.trace_id ?? getTraceId(req)),
        };
        return originalJson(merged);
      }
    }
    return originalJson(body);
  }) as Response['json'];
  next();
}
