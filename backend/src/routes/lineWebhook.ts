import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { env } from '../config/env';
import { loadLineSettings, processLineTextMessage, appendWebhookLog } from '../services/lineTextImport';

/**
 * LINE Messaging API — Webhook
 * ลงทะเบียน URL แบบ HTTPS: .../api/line/webhook
 */
const router = Router();

type LineTextEvent = {
  type: string;
  message?: { type: string; id?: string; text?: string };
  source?: { type?: string; groupId?: string; userId?: string };
};

router.post('/', async (req: Request, res: Response) => {
  const secret = env.LINE_CHANNEL_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'LINE_CHANNEL_SECRET is not configured' });
  }

  const signature = req.get('x-line-signature');
  if (!signature) {
    return res.status(401).send('Missing signature');
  }

  const raw = req.body;
  if (!Buffer.isBuffer(raw)) {
    return res.status(500).send('Webhook expects raw body');
  }

  const hash = crypto.createHmac('sha256', secret).update(raw).digest('base64');
  if (hash !== signature) {
    return res.status(401).send('Invalid signature');
  }

  let payload: { events?: LineTextEvent[] };
  try {
    payload = JSON.parse(raw.toString('utf8')) as { events?: LineTextEvent[] };
  } catch {
    return res.status(400).send('Invalid JSON');
  }

  let settings;
  try {
    settings = await loadLineSettings();
  } catch {
    return res.status(500).send('Settings load failed');
  }

  if (!settings.webhook_enabled) {
    return res.status(200).send('OK');
  }

  for (const ev of payload.events ?? []) {
    if (ev.type !== 'message' || ev.message?.type !== 'text' || !ev.message.text) {
      continue;
    }

    const text = ev.message.text;
    const groupId = ev.source?.groupId ?? '';
    const userId = ev.source?.userId ?? '';
    const messageId = ev.message.id ?? null;
    const preview = text.replace(/\s+/g, ' ').slice(0, 400);

    let logStatus = 'ok';
    let inserted = 0;
    let errDetail: string | null = null;

    try {
      const result = await processLineTextMessage({
        text,
        groupId,
        userId,
        messageId: messageId ?? undefined,
        settings,
      });
      logStatus = result.status;
      inserted = result.inserted;
      errDetail = result.detail ?? null;

      if (
        result.detail === 'not_bet_text'
        || result.detail === 'auto_import_disabled'
      ) {
        continue;
      }
    } catch (e) {
      logStatus = 'error';
      errDetail = e instanceof Error ? e.message : String(e);
    }

    try {
      await appendWebhookLog({
        message_id: messageId,
        group_id: groupId || null,
        user_id: userId || null,
        text_preview: preview,
        status: logStatus,
        inserted_count: inserted,
        error_detail: errDetail,
      });
    } catch {
      /* ignore log failure */
    }
  }

  res.status(200).send('OK');
});

export default router;
