import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
}

export function errorHandler(
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation error',
      details: err.flatten().fieldErrors,
    });
    return;
  }

  const pg = err as { code?: string; detail?: string; constraint?: string; message?: string };

  // PostgreSQL unique violation
  if (pg.code === '23505') {
    res.status(409).json({ error: 'Duplicate entry', detail: pg.detail });
    return;
  }

  // FK / CHECK — มักเกิดตอน import ข้อมูลจากเครื่องอื่น
  if (pg.code === '23503') {
    console.error('[PG FK]', pg.message, pg.detail);
    res.status(400).json({
      error: 'ข้อมูลอ้างอิงไม่มีในระบบ (เช่น dealer / customer)',
      detail: pg.detail,
    });
    return;
  }
  if (pg.code === '23514') {
    console.error('[PG CHECK]', pg.message, pg.detail);
    res.status(400).json({ error: 'ค่าไม่ตรงกับเงื่อนไขฐานข้อมูล', detail: pg.detail });
    return;
  }
  if (pg.code === '22P02') {
    console.error('[PG invalid input]', pg.message, pg.detail);
    res.status(400).json({ error: 'รูปแบบข้อมูลไม่ถูกต้อง', detail: pg.detail });
    return;
  }

  const status = err.statusCode ?? 500;
  const message = status < 500 ? err.message : 'Internal server error';

  if (status >= 500) {
    console.error('[Error]', err instanceof Error ? err.message : err, pg.code, pg.detail);
  }

  res.status(status).json({
    error: message,
    ...(env.NODE_ENV === 'development' && status >= 500 ? { stack: err.stack } : {}),
  });
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Route not found' });
}

export function createError(message: string, statusCode = 500): AppError {
  const err: AppError = new Error(message);
  err.statusCode = statusCode;
  return err;
}
