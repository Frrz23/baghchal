import { GameEngine } from '../game/engine';
import { Move, Outcome, Side } from '../game/rules';
import { RoomError, ServerMsg } from './protocol';

export interface SeatInfo {
  token: string;
  connected: boolean;
}

export interface CoreSnapshot {
  code: string;
  moves: Move[];
  goat: SeatInfo | null;
  tiger: SeatInfo | null;
}

export type JoinResult =
  | { seat: Side; token: string; err: null }
  | { seat: null; token: null; err: RoomError };

export type CoreEvent = { target: 'self' | 'opp' | 'all'; msg: ServerMsg };

function newToken(): string {
  return crypto.randomUUID();
}

/**
 * Authoritative room state machine. Pure (no sockets, no storage): the DO
 * wrapper feeds it join/move/disconnect events and routes the queued events
 * back out. All moves go through the shared GameEngine, so validation is
 * byte-identical to local play.
 */
export class RoomCore {
  readonly code: string;
  private engine: GameEngine;
  private goat: SeatInfo | null;
  private tiger: SeatInfo | null;
  private queue: CoreEvent[] = [];

  constructor(code: string, snap?: CoreSnapshot) {
    this.code = code;
    this.engine = new GameEngine();
    this.goat = null;
    this.tiger = null;
    if (snap) {
      this.goat = snap.goat;
      this.tiger = snap.tiger;
      for (const m of snap.moves) this.engine.play(m);
    }
  }

  get moves(): Move[] {
    return this.engine.moves;
  }

  get outcome(): Outcome | null {
    return this.engine.outcome;
  }

  get toMove(): Side {
    return this.engine.current.toMove;
  }

  get isEmpty(): boolean {
    return !this.goat?.connected && !this.tiger?.connected;
  }

  get hasRoom(): boolean {
    return this.goat !== null || this.tiger !== null;
  }

  /** Handles create / join / token reclaim. Queues welcome + state events. */
  join(mode: 'create' | 'join', token?: string): JoinResult {
    if (mode === 'create') {
      if (this.hasRoom) return { seat: null, token: null, err: 'ROOM_TAKEN' };
      const t = newToken();
      this.goat = { token: t, connected: true };
      this.queue.push({ target: 'self', msg: { t: 'welcome', code: this.code, seat: 'goat', token: t } });
      this.pushState('self');
      return { seat: 'goat', token: t, err: null };
    }
    // reclaim an existing seat by token
    if (token) {
      let seat: Side | null = null;
      if (this.goat?.token === token) seat = 'goat';
      else if (this.tiger?.token === token) seat = 'tiger';
      if (!seat) return { seat: null, token: null, err: 'BAD_CODE' };
      const info = seat === 'goat' ? this.goat! : this.tiger!;
      info.connected = true;
      this.queue.push({ target: 'self', msg: { t: 'welcome', code: this.code, seat, token } });
      this.afterSeatChange(seat);
      return { seat, token, err: null };
    }
    // fresh join
    if (!this.hasRoom) return { seat: null, token: null, err: 'BAD_CODE' };
    if (this.tiger) return { seat: null, token: null, err: 'ROOM_FULL' };
    const t = newToken();
    this.tiger = { token: t, connected: true };
    this.queue.push({ target: 'self', msg: { t: 'welcome', code: this.code, seat: 'tiger', token: t } });
    this.afterSeatChange('tiger');
    return { seat: 'tiger', token: t, err: null };
  }

  /** Applies a move from `seat`; queues a broadcast state event on success. */
  move(seat: Side, move: Move): RoomError | null {
    if (this.engine.outcome) return 'GAME_OVER';
    if (!this.goat?.connected || !this.tiger?.connected) return 'NOT_YOUR_TURN';
    if (this.engine.current.toMove !== seat) return 'NOT_YOUR_TURN';
    try {
      this.engine.play(move);
    } catch {
      return 'BAD_MOVE';
    }
    this.pushState('all');
    return null;
  }

  disconnect(seat: Side): void {
    const s = seat === 'goat' ? this.goat : this.tiger;
    if (!s || !s.connected) return;
    s.connected = false;
    this.queue.push({ target: 'all', msg: { t: 'opponent', connected: false } });
  }

  snapshot(): CoreSnapshot {
    return {
      code: this.code,
      moves: this.moves,
      goat: this.goat ? { ...this.goat } : null,
      tiger: this.tiger ? { ...this.tiger } : null,
    };
  }

  takeQueue(): CoreEvent[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  private afterSeatChange(seat: Side): void {
    this.pushState('self');
    this.queue.push({ target: 'self', msg: { t: 'opponent', connected: this.otherConnected(seat) } });
    this.queue.push({ target: 'opp', msg: { t: 'opponent', connected: true } });
  }

  private otherConnected(seat: Side): boolean {
    const other = seat === 'goat' ? this.tiger : this.goat;
    return other?.connected === true;
  }

  private pushState(target: 'self' | 'opp' | 'all'): void {
    this.queue.push({
      target,
      msg: { t: 'state', moves: this.moves, toMove: this.toMove, outcome: this.engine.outcome },
    });
  }
}
