'use client';

function wsBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.hostname}:4000`;
  }
  return process.env.NEXT_PUBLIC_WS_URL ?? 'ws://127.0.0.1:4000';
}

export type WsMessage = {
  type: string;
  data?: unknown;
  ts: number;
};

type MessageHandler = (msg: WsMessage) => void;

class RealtimeClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<MessageHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  connect(token: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.intentionalClose = false;

    this.ws = new WebSocket(`${wsBaseUrl()}/ws?token=${encodeURIComponent(token)}`);

    this.ws.onopen = () => {
      console.debug('[WS] connected');
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    };

    this.ws.onmessage = (evt) => {
      try {
        const msg: WsMessage = JSON.parse(evt.data);
        const set = this.handlers.get(msg.type);
        if (set) set.forEach((h) => h(msg));
        // Also fire wildcard handlers
        const wild = this.handlers.get('*');
        if (wild) wild.forEach((h) => h(msg));
      } catch {
        // ignore
      }
    };

    this.ws.onclose = () => {
      if (!this.intentionalClose) {
        console.debug('[WS] disconnected — reconnecting in 3s...');
        this.reconnectTimer = setTimeout(() => this.connect(token), 3_000);
      }
    };

    this.ws.onerror = (err) => {
      console.error('[WS] error', err);
    };
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  on(type: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    // Return unsubscribe function
    return () => this.handlers.get(type)?.delete(handler);
  }

  send(type: string, data?: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    }
  }
}

export const wsClient = new RealtimeClient();
