/// <reference types="@cloudflare/workers-types" />
import { RoomCore } from './roomCore';
import { CoreSnapshot } from './roomCore';
import { generateCode, parseClient, ServerMsg, validCode } from './protocol';

export interface Env {
  ROOMS: DurableObjectNamespace;
}

const ROOM_TTL_MS = 10 * 60 * 1000;

interface SocketMeta {
  code: string;
  seat: 'goat' | 'tiger';
}

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(msg));
  } else {
    console.log('drop: socket not open (readyState=' + ws.readyState + ') for ' + msg.t);
  }
}

function seatOf(ws: WebSocket): SocketMeta | null {
  const meta = ws.deserializeAttachment() as SocketMeta | null;
  return meta && typeof meta.code === 'string' ? meta : null;
}

/**
 * Authoritative room: two seats, server-validated moves via the shared
 * GameEngine (byte-identical rules to local play). State persists to the
 * DO's SQLite storage so evicted rooms survive; empty rooms close after a
 * 10-minute grace alarm.
 */
export class Room {
  private ctx: DurableObjectState;
  private core: RoomCore | null = null;

  constructor(ctx: DurableObjectState, _env: Env) {
    this.ctx = ctx;
  }

  private async ensureCore(code: string): Promise<RoomCore> {
    if (!this.core) {
      const snap = (await this.ctx.storage.get('room')) as CoreSnapshot | undefined;
      this.core = snap && snap.code === code ? new RoomCore(code, snap) : new RoomCore(code);
    }
    return this.core;
  }

  private async persist(): Promise<void> {
    if (!this.core) return;
    await this.ctx.storage.put('room', this.core.snapshot());
    if (this.core.isEmpty) await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
    else await this.ctx.storage.deleteAlarm();
  }

  private sockets(): WebSocket[] {
    return this.ctx.getWebSockets();
  }

  /** Drains the core queue; `selfWs` resolves 'self' targets for this call. */
  private flush(selfWs: WebSocket | null): void {
    if (!this.core) return;
    for (const ev of this.core.takeQueue()) {
      console.log('flush target=' + ev.target + ' msg=' + ev.msg.t + ' sockets=' + this.sockets().length);
      if (ev.target === 'self') {
        if (selfWs) send(selfWs, ev.msg);
        continue;
      }
      const selfSeat = selfWs ? seatOf(selfWs)?.seat : null;
      for (const ws of this.sockets()) {
        const meta = seatOf(ws);
        if (!meta) continue;
        if (ev.target === 'all' || (selfSeat && meta.seat !== selfSeat)) send(ws, ev.msg);
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Baghchal room server (WebSocket only)', { status: 200 });
    }
    const url = new URL(request.url);
    const code = (url.searchParams.get('code') || '').toUpperCase();
    if (!validCode(code)) return new Response('bad room code', { status: 400 });
    const mode = url.searchParams.has('create') ? 'create' : 'join';
    const token = url.searchParams.get('token') || undefined;

    const core = await this.ensureCore(code);
    // Fail BEFORE accepting the socket so the worker can retry a colliding create.
    if (mode === 'create' && core.hasRoom) return new Response('room exists', { status: 409 });
    if (mode === 'join' && !core.hasRoom) return new Response('no such room', { status: 404 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);

    const res = core.join(mode, token);
    if (res.err) {
      send(server, { t: 'error', err: res.err });
      server.close(4000, res.err);
      return new Response(null, { status: 101, webSocket: client });
    }
    server.serializeAttachment({ code, seat: res.seat } satisfies SocketMeta);
    this.flush(server);
    await this.persist();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    const meta = seatOf(ws);
    if (!meta || !this.core) {
      send(ws, { t: 'error', err: 'BAD_MSG' });
      return;
    }
    const msg = parseClient(message);
    if (!msg) {
      send(ws, { t: 'error', err: 'BAD_MSG' });
      return;
    }
    if (msg.t === 'leave') {
      ws.close(1000, 'leave');
      return;
    }
    const err = this.core.move(meta.seat, msg.move);
    console.log('move seat=' + meta.seat + ' move=' + JSON.stringify(msg.move) + ' err=' + err);
    if (err) {
      send(ws, { t: 'error', err });
      return;
    }
    this.flush(ws);
    await this.persist();
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const meta = seatOf(ws);
    if (meta && this.core) {
      this.core.disconnect(meta.seat);
      this.flush(null);
      await this.persist();
    }
  }

  async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
    /* close handler follows for most errors */
  }

  async alarm(): Promise<void> {
    if (this.core && this.core.hasRoom && this.core.isEmpty) {
      await this.ctx.storage.deleteAll();
      this.core = null;
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Baghchal online', { status: 200 });
    }
    if (!url.searchParams.get('code')) {
      // create flow: pick a free code, retry on collision (DO answers 409 pre-accept)
      for (let i = 0; i < 8; i++) {
        const code = generateCode();
        const u = new URL(url);
        u.searchParams.set('code', code);
        const res = await env.ROOMS.getByName(code).fetch(new Request(u, request));
        if (res.status === 409) continue;
        return res;
      }
      return new Response('code space busy', { status: 503 });
    }
    const code = (url.searchParams.get('code') || '').toUpperCase();
    if (!validCode(code)) return new Response('bad room code', { status: 400 });
    const u = new URL(url);
    u.searchParams.set('code', code);
    return env.ROOMS.getByName(code).fetch(new Request(u, request));
  },
};
