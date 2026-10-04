import {
  JUMPS,
  MovementMode,
  NEIGHBORS,
  NODE_COUNT,
  Piece,
  Side,
  TIGER_START,
  colOf,
  nodeAt,
  rowOf,
} from './board';

export type { MovementMode, Piece, Side } from './board';

export interface GameState {
  board: Piece[];
  toMove: Side;
  goatsInHand: number;
  goatsCaptured: number;
  /** no-backtrack only: cameFrom[i] = node the piece at i arrived from.
      Presence of this array implies the no-backtrack movement mode is active
      and is folded into positionKey. */
  cameFrom?: (number | null)[];
}

export type Move =
  | { kind: 'place'; to: number }
  | { kind: 'step'; from: number; to: number }
  | { kind: 'jump'; from: number; over: number; to: number };

export type WinReason = 'captures' | 'tiger-blocked' | 'goats-locked' | 'repetition' | 'sudden-death';

export type Outcome =
  | { kind: 'win'; winner: Side; reason: WinReason }
  | { kind: 'draw'; reason: 'repetition' };

export interface Ruleset {
  goatCount: number;
  tigerCount: 4 | 5;
  capturesToWin: number;
  movement: MovementMode;
  /** 400-ply cap (or plyCap override): adjudicate instead of playing on. */
  suddenDeath: boolean;
  plyCap?: number;
}

export const PLY_CAP = 400;

export const CLASSIC_RULESET: Ruleset = {
  goatCount: 20,
  tigerCount: 4,
  capturesToWin: 5,
  movement: 'classic',
  suddenDeath: false,
};

export const GOAT_COUNT = 20;
export const CAPTURES_TO_WIN = 5;

const NO_BACKTRACK = (mode: MovementMode): boolean => mode === 'no-backtrack';

function stepAllowed(from: number, to: number, rules: Ruleset): boolean {
  if (!NEIGHBORS[from].includes(to)) return false;
  if (rules.movement === 'orthogonal-only') {
    return rowOf(from) === rowOf(to) || colOf(from) === colOf(to);
  }
  return true;
}

function jumpAllowed(from: number, over: number, to: number, rules: Ruleset): boolean {
  if (rules.movement !== 'orthogonal-only') return true;
  const rowLine = rowOf(from) === rowOf(over) && rowOf(over) === rowOf(to);
  const colLine = colOf(from) === colOf(over) && colOf(over) === colOf(to);
  return rowLine || colLine;
}

export function initialState(rules: Ruleset = CLASSIC_RULESET): GameState {
  const board: Piece[] = new Array(NODE_COUNT).fill(null);
  for (const n of TIGER_START) board[n] = 'T';
  if (rules.tigerCount === 5) board[nodeAt(2, 2)] = 'T';
  const state: GameState = {
    board,
    toMove: 'goat',
    goatsInHand: rules.goatCount,
    goatsCaptured: 0,
  };
  if (NO_BACKTRACK(rules.movement)) state.cameFrom = new Array(NODE_COUNT).fill(null);
  return state;
}

export function legalMoves(s: GameState, rules: Ruleset = CLASSIC_RULESET): Move[] {
  const moves: Move[] = [];
  const cameFrom = NO_BACKTRACK(rules.movement) ? s.cameFrom ?? null : null;
  if (s.toMove === 'goat') {
    if (s.goatsInHand > 0) {
      for (let i = 0; i < NODE_COUNT; i++) {
        if (s.board[i] === null) moves.push({ kind: 'place', to: i });
      }
    } else {
      for (let i = 0; i < NODE_COUNT; i++) {
        if (s.board[i] !== 'G') continue;
        for (const n of NEIGHBORS[i]) {
          if (s.board[n] !== null) continue;
          if (!stepAllowed(i, n, rules)) continue;
          if (cameFrom && cameFrom[i] === n) continue;
          moves.push({ kind: 'step', from: i, to: n });
        }
      }
    }
  } else {
    for (let i = 0; i < NODE_COUNT; i++) {
      if (s.board[i] !== 'T') continue;
      for (const n of NEIGHBORS[i]) {
        if (s.board[n] !== null) continue;
        if (!stepAllowed(i, n, rules)) continue;
        if (cameFrom && cameFrom[i] === n) continue;
        moves.push({ kind: 'step', from: i, to: n });
      }
      for (const j of JUMPS[i]) {
        if (s.board[j.over] !== 'G' || s.board[j.to] !== null) continue;
        if (!jumpAllowed(i, j.over, j.to, rules)) continue;
        if (cameFrom && cameFrom[i] === j.to) continue;
        moves.push({ kind: 'jump', from: i, over: j.over, to: j.to });
      }
    }
  }
  return moves;
}

export function applyMove(s: GameState, m: Move, rules: Ruleset = CLASSIC_RULESET): GameState {
  const board = s.board.slice();
  const trackBack = NO_BACKTRACK(rules.movement);
  const cameFrom = trackBack ? (s.cameFrom ?? new Array(NODE_COUNT).fill(null)).slice() : undefined;
  if (m.kind === 'place') {
    if (s.goatsInHand <= 0 || board[m.to] !== null) throw new Error('illegal place');
    board[m.to] = 'G';
    if (cameFrom) cameFrom[m.to] = null;
    return {
      board,
      toMove: 'tiger',
      goatsInHand: s.goatsInHand - 1,
      goatsCaptured: s.goatsCaptured,
      ...(cameFrom ? { cameFrom } : {}),
    };
  }
  const piece = board[m.from];
  if (piece === null || board[m.to] !== null) throw new Error('illegal step');
  if (m.kind === 'step' && piece === 'G' && s.goatsInHand > 0) throw new Error('goats frozen');
  board[m.from] = null;
  board[m.to] = piece;
  if (cameFrom) {
    cameFrom[m.from] = null;
    cameFrom[m.to] = m.from;
  }
  if (m.kind === 'jump') {
    if (piece !== 'T' || board[m.over] !== 'G') throw new Error('illegal jump');
    board[m.over] = null;
    if (cameFrom) cameFrom[m.over] = null;
    return {
      board,
      toMove: 'goat',
      goatsInHand: s.goatsInHand,
      goatsCaptured: s.goatsCaptured + 1,
      ...(cameFrom ? { cameFrom } : {}),
    };
  }
  return {
    board,
    toMove: piece === 'T' ? 'goat' : 'tiger',
    goatsInHand: s.goatsInHand,
    goatsCaptured: s.goatsCaptured,
    ...(cameFrom ? { cameFrom } : {}),
  };
}

export function positionKey(s: GameState): string {
  let key = '';
  for (const p of s.board) key += p === null ? '.' : p;
  key += `|${s.toMove[0]}|${s.goatsInHand}|${s.goatsCaptured}`;
  if (s.cameFrom) {
    let cf = '';
    for (const c of s.cameFrom) cf += c === null ? '*' : c.toString(36);
    key += `|${cf}`;
  }
  return key;
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
 * `plies` = total moves played so far (engine stack + search ply); required
 * for the sudden-death cap when rules.suddenDeath is set.
 */
export function detectOutcome(
  s: GameState,
  currentOccurrences: number,
  moves?: Move[],
  rules: Ruleset = CLASSIC_RULESET,
  plies?: number,
): Outcome | null {
  const ms = moves ?? legalMoves(s, rules);
  if (s.goatsCaptured >= rules.capturesToWin) {
    return { kind: 'win', winner: 'tiger', reason: 'captures' };
  }
  if (ms.length === 0) {
    if (s.toMove === 'tiger') return { kind: 'win', winner: 'goat', reason: 'tiger-blocked' };
    if (s.goatsInHand === 0) return { kind: 'win', winner: 'tiger', reason: 'goats-locked' };
  }
  if (currentOccurrences >= 3) {
    return { kind: 'draw', reason: 'repetition' };
  }
  if (rules.suddenDeath && plies !== undefined && plies >= (rules.plyCap ?? PLY_CAP)) {
    return { kind: 'win', winner: s.goatsCaptured > 0 ? 'tiger' : 'goat', reason: 'sudden-death' };
  }
  return null;
}
