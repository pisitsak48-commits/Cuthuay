import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { JwtPayload } from '../models/types';
import { query } from '../config/database';

interface AuthenticatedSocket extends WebSocket {
  userId?: string;
  role?: string;
  isAlive?: boolean;
}

let wss: WebSocketServer | null = null;
const WS_PROTOCOL = 'cuthuay.v1';
const WS_AUTH_PREFIX = 'auth.jwt.';

function extractTokenFromProtocols(header: string | string[] | undefined): string | null {
  if (!header) return null;
  const raw = Array.isArray(header) ? header.join(',') : header;
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const authPart = parts.find((p) => p.startsWith(WS_AUTH_PREFIX));
  if (!authPart) return null;
  return authPart.slice(WS_AUTH_PREFIX.length);
}

export function initWebSocket(server: Server): void {
  wss = new WebSocketServer({
    server,
    path: '/ws',
    handleProtocols: (protocols) => {
      if (protocols.has(WS_PROTOCOL)) return WS_PROTOCOL;
      return false;
    },
  });

  wss.on('connection', (socket: AuthenticatedSocket, req) => {
    socket.isAlive = true;

    void (async () => {
      const token = extractTokenFromProtocols(req.headers['sec-websocket-protocol']);
      if (!token) {
        socket.close(1008, 'Authentication required');
        return;
      }

      try {
        const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
        if (payload.token_type && payload.token_type !== 'access') {
          socket.close(1008, 'Invalid token type');
          return;
        }
        const userRes = await query<{ id: string; role: string; is_active: boolean; token_version: number }>(
          'SELECT id, role, is_active, token_version FROM users WHERE id = $1',
          [payload.sub],
        );
        const user = userRes.rows[0];
        if (!user || !user.is_active) {
          socket.close(1008, 'User not found or inactive');
          return;
        }
        const tokenVersion = payload.tv ?? 0;
        if (tokenVersion !== Number(user.token_version ?? 0)) {
          socket.close(1008, 'Token revoked');
          return;
        }
        socket.userId = payload.sub;
        socket.role = payload.role;
      } catch {
        socket.close(1008, 'Invalid token');
        return;
      }

      socket.on('pong', () => {
        socket.isAlive = true;
      });

      socket.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'ping') {
            socket.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
          }
        } catch {
          // Ignore malformed messages
        }
      });

      socket.on('error', (err) => {
        console.error('[WS] socket error:', err.message);
      });

      socket.send(
        JSON.stringify({
          type: 'connected',
          data: { userId: socket.userId, ts: Date.now() },
        }),
      );
    })();
  });

  // Heartbeat — drop dead connections every 30s
  const interval = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((ws) => {
      const socket = ws as AuthenticatedSocket;
      if (!socket.isAlive) {
        socket.terminate();
        return;
      }
      socket.isAlive = false;
      socket.ping();
    });
  }, 30_000);

  wss.on('close', () => clearInterval(interval));

  console.log('[WS] WebSocket server initialised on path /ws');
}

/**
 * Broadcast a message to all authenticated connected clients.
 */
export function broadcast(payload: { type: string; data?: unknown }): void {
  if (!wss) return;
  const msg = JSON.stringify({ ...payload, ts: Date.now() });
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  });
}
