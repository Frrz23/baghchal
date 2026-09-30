import { JUMPS, NEIGHBORS, NODE_COUNT, Piece, Side, TIGER_START } from './board';

export type { Piece, Side } from './board';

export interface GameState {
  board: Piece[];
  toMove: Side;
  goatsInHand: number;
  goatsCaptured: number;
}

export type Move =
  | { kind: 'place'; to: number }
  | { kind: 'step'; from: number; to: number }
  | { kind: 'jump'; from: number; over: number; to: number };

export type WinReason = 'captures' | 'tiger-blocked' | 'goats-locked' | 'repetition';

export type Outcome =
  | { kind: 'win'; winner: Side; reason: WinReason }
  | { kind: 'draw'; reason: 'repetition' };

export const GOAT_COUNT = 20;
export const CAPTURES_TO_WIN = 5;

export function initialState(): GameState {
  const board: Piece[] = new Array(NODE_COUNT).fill(null);
  for (const n of TIGER_START) board[n] = 'T';
  return { board, toMove: 'goat', goatsInHand: GOAT_COUNT, goatsCaptured: 0 };
}

export function legalMoves(s: GameState): Move[] {
  const moves: Move[] = [];
  if (s.toMove === 'goat') {
    if (s.goatsInHand > 0) {
      for (let i = 0; i < NODE_COUNT; i++) {
        if (s.board[i] === null) moves.push({ kind: 'place', to: i });
      }
    } else {
      for (let i = 0; i < NODE_COUNT; i++) {
        if (s.board[i] !== 'G') continue;
        for (const n of NEIGHBORS[i]) {
          if (s.board[n] === null) moves.push({ kind: 'step', from: i, to: n });
        }
      }
    }
  } else {
    for (let i = 0; i < NODE_COUNT; i++) {
      if (s.board[i] !== 'T') continue;
      for (const n of NEIGHBORS[i]) {
        if (s.board[n] === null) moves.push({ kind: 'step', from: i, to: n });
      }
      for (const j of JUMPS[i]) {
        if (s.board[j.over] === 'G' && s.board[j.to] === null) {
          moves.push({ kind: 'jump', from: i, over: j.over, to: j.to });
        }
      }
    }
  }
  return moves;
}

export function applyMove(s: GameState, m: Move): GameState {
  const board = s.board.slice();
  if (m.kind === 'place') {
    if (s.goatsInHand <= 0 || board[m.to] !== null) throw new Error('illegal place');
    board[m.to] = 'G';
    return { board, toMove: 'tiger', goatsInHand: s.goatsInHand - 1, goatsCaptured: s.goatsCaptured };
  }
  const piece = board[m.from];
  if (piece === null || board[m.to] !== null) throw new Error('illegal step');
  if (m.kind === 'step' && piece === 'G' && s.goatsInHand > 0) throw new Error('goats frozen');
  board[m.from] = null;
  board[m.to] = piece;
  if (m.kind === 'jump') {
    if (piece !== 'T' || board[m.over] !== 'G') throw new Error('illegal jump');
    board[m.over] = null;
    return {
      board,
      toMove: 'goat',
      goatsInHand: s.goatsInHand,
      goatsCaptured: s.goatsCaptured + 1,
    };
  }
  return {
    board,
    toMove: piece === 'T' ? 'goat' : 'tiger',
    goatsInHand: s.goatsInHand,
    goatsCaptured: s.goatsCaptured,
  };
}

export function positionKey(s: GameState): string {
  let key = '';
  for (const p of s.board) key += p === null ? '.' : p;
  return `${key}|${s.toMove[0]}|${s.goatsInHand}|${s.goatsCaptured}`;
}

export function movesMatch(a: Move, b: Move): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'place' && b.kind === 'place') return a.to === b.to;
  if (a.kind === 'step' && b.kind === 'step') return a.from === b.from && a.to === b.to;
  if (a.kind === 'jump' && b.kind === 'jump')
    return a.from === b.from && a.over === b.over && a.to === b.to;
  return false;
}

/**
 * Detects a terminal outcome for `s`.
 * `currentOccurrences` = how many times the CURRENT position has occurred in
 * the game so far, counting itself (engine: after incrementing its counter;
 * AI search: past counts + occurrences on the search path + itself).
 */
export function detectOutcome(
  s: GameState,
  currentOccurrences: number,
  moves: Move[] = legalMoves(s),
): Outcome | null {
  if (s.goatsCaptured >= CAPTURES_TO_WIN) {
    return { kind: 'win', winner: 'tiger', reason: 'captures' };
  }
  if (moves.length === 0) {
    if (s.toMove === 'tiger') return { kind: 'win', winner: 'goat', reason: 'tiger-blocked' };
    if (s.goatsInHand === 0) return { kind: 'win', winner: 'tiger', reason: 'goats-locked' };
  }
  if (currentOccurrences >= 3) {
    return { kind: 'draw', reason: 'repetition' };
  }
  return null;
}
