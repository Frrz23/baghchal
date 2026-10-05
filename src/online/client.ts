import { WS_BASE } from './config';
import { ClientMsg, ServerMsg } from './protocol';

export interface ConnHandlers {
  onMsg: (m: ServerMsg) => void;
  onClose: () => void;
}

/**
 * Thin WebSocket wrapper: one connection at a time, JSON messages in/out.
 * A deliberate `close()` never triggers `onClose` (the app closed on purpose);
 * only remote/server-side closes do.
 */
export class OnlineConn {
  private ws: WebSocket | null = null;
  private h: ConnHandlers;

  constructor(handlers: ConnHandlers) {
    this.h = handlers;
  }

  /** `query` is appended to `<WS_BASE>/room?…` (e.g. `create=1`). */
  connect(query: string): void {
    this.close();
    if (!WS_BASE) {
      // no deploy configured (dev build without VITE_WS_URL): surface as close
      queueMicrotask(() => this.h.onClose());
      return;
    }
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${WS_BASE}/room?${query}`);
    } catch {
      queueMicrotask(() => this.h.onClose());
      return;
    }
    this.ws = ws;
    ws.onmessage = (e: MessageEvent) => {
      if (typeof e.data !== 'string') return;
      let m: ServerMsg;
      try {
        m = JSON.parse(e.data) as ServerMsg;
      } catch {
        console.error('online: malformed frame', e.data);
        return;
      }
      try {
        this.h.onMsg(m);
      } catch (err) {
        console.error('online: message handler failed', m.t, err);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // stale socket after close()/reconnect
      this.ws = null;
      this.h.onClose();
    };
    ws.onerror = () => {
      /* close event follows */
    };
  }

  get open(): boolean {
    return this.ws !== null && this.ws.readyState === 1;
  }

  send(m: ClientMsg): void {
    if (this.open) this.ws!.send(JSON.stringify(m));
  }

  close(): void {
    const ws = this.ws;
    this.ws = null; // detach first: onclose then sees a stale socket
    if (ws && ws.readyState <= 1) ws.close();
  }
}
