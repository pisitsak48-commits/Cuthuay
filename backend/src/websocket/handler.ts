import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { JwtPayload } from '../models/types';

interface AuthenticatedSocket extends WebSocket {
  userId?: string;
  role?: string;
  isAlive?: boolean;
}

let wss: WebSocketServer | null = null;

export function initWebSocket(server: Server): void {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket: AuthenticatedSocket, req) => {
    socket.isAlive = true;

    // Authenticate via token in query string: ws://host/ws?token=xxx
    const url = new URL(req.url ?? '', `http://localhost`);
    const token = url.searchParams.get('token');
    if (!token) {
      socket.close(1008, 'Authentication required');
      return;
    }

    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
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
        // Echo ping/pong for keep-alive
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

    // Send welcome message
    socket.send(
      JSON.stringify({
        type: 'connected',
        data: { userId: socket.userId, ts: Date.now() },
      }),
    );
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
