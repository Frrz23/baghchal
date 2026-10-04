import { Move, Outcome, Side } from '../game/rules';

/** Room codes: 4 chars, unambiguous alphabet (no 0/O/1/I/L), 32^4 space. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LEN = 4;

export function generateCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return s;
}

export function validCode(code: string): boolean {
  return code.length === CODE_LEN && [...code].every((c) => CODE_ALPHABET.includes(c));
}

export type ClientMsg = { t: 'move'; move: Move } | { t: 'leave' };

export type ServerMsg =
  | { t: 'welcome'; code: string; seat: Side; token: string }
  | { t: 'error'; err: RoomError }
  | { t: 'state'; moves: Move[]; toMove: Side; outcome: Outcome | null }
  | { t: 'opponent'; connected: boolean }
  | { t: 'bye'; reason: 'closed' };

export type RoomError =
  | 'BAD_MSG'
  | 'ROOM_TAKEN'
  | 'ROOM_FULL'
  | 'BAD_CODE'
  | 'NOT_YOUR_TURN'
  | 'BAD_MOVE'
  | 'GAME_OVER';

export function parseClient(raw: unknown): ClientMsg | null {
  if (typeof raw !== 'string') return null;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object') return null;
  const m = o as Record<string, unknown>;
  if (m.t === 'leave') return { t: 'leave' };
  if (m.t === 'move' && m.move && typeof m.move === 'object') {
    const mv = m.move as Record<string, unknown>;
    if (mv.kind === 'place' && typeof mv.to === 'number') return { t: 'move', move: m.move as Move };
    if (mv.kind === 'step' && typeof mv.from === 'number' && typeof mv.to === 'number') {
      return { t: 'move', move: m.move as Move };
    }
    if (mv.kind === 'jump' && typeof mv.from === 'number' && typeof mv.to === 'number' && typeof mv.over === 'number') {
      return { t: 'move', move: m.move as Move };
    }
  }
  return null;
}
