import { NEIGHBORS } from './board';
import {
  CLASSIC_RULESET,
  GameState,
  Move,
  Outcome,
  Ruleset,
  applyMove,
  detectOutcome,
  legalMoves,
  positionKey,
} from './rules';

export type Difficulty = 'easy' | 'medium' | 'hard';

const WIN_SCORE = 1_000_000;

const positional: number[] = NEIGHBORS.map((n) => n.length);

function countMoves(s: GameState, side: 'tiger' | 'goat', rules: Ruleset): number {
  return legalMoves({ ...s, toMove: side }, rules).length;
}

function countJumps(s: GameState, rules: Ruleset): number {
  if (s.toMove !== 'tiger') {
    return legalMoves({ ...s, toMove: 'tiger' }, rules).filter((m) => m.kind === 'jump').length;
  }
  return legalMoves(s, rules).filter((m) => m.kind === 'jump').length;
}

function evaluate(s: GameState, rules: Ruleset): number {
  // Scale by ruleset; classic (5 captures, 20 goats) keeps the exact v1 weights.
  // sqrt softens the low-capture-target ramp: linear (5/c) made tigers
  // hyper-aggressive at 3-4 captures and every short race ended 100% tiger.
  const captureValue = 90 * Math.sqrt(5 / rules.capturesToWin);
  const handValue = 3 * (20 / rules.goatCount);
  let score = s.goatsCaptured * captureValue;
  score += countMoves(s, 'tiger', rules) * 4;
  score -= countMoves(s, 'goat', rules) * 1.5;
  score -= s.goatsInHand * handValue;
  score += countJumps(s, rules) * 6;
  let tigerPos = 0;
  let goatPos = 0;
  for (let n = 0; n < 25; n++) {
    if (s.board[n] === 'T') tigerPos += positional[n];
    else if (s.board[n] === 'G') goatPos += positional[n];
  }
  score += tigerPos * 0.4;
  score -= goatPos * 0.4;
  return score;
}

function terminalScore(o: Outcome, ply: number): number {
  if (o.kind === 'draw') return 0;
  const s = WIN_SCORE - ply;
  return o.winner === 'tiger' ? s : -s;
}

function orderMoves(moves: Move[]): Move[] {
  const score = (m: Move): number => {
    if (m.kind === 'jump') return 1000;
    return positional[m.to];
  };
  return moves
    .map((m, i) => ({ m, i, s: score(m) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.m);
}

interface Ctx {
  past: ReadonlyMap<string, number>;
  noise: number;
  deadline: number;
  nodes: number;
}

const TIMEOUT = Symbol('ai-timeout');

function checkDeadline(ctx: Ctx): void {
  if (ctx.deadline > 0 && ++ctx.nodes % 1024 === 0 && now() > ctx.deadline) throw TIMEOUT;
}

function search(
  s: GameState,
  depth: number,
  ply: number,
  alpha: number,
  beta: number,
  path: string[],
  ctx: Ctx,
  rules: Ruleset,
  basePlies: number,
): number {
  checkDeadline(ctx);
  const key = positionKey(s);
  const moves = legalMoves(s, rules);
  let occurrences = (ctx.past.get(key) ?? 0) + 1;
  for (const k of path) if (k === key) occurrences++;
  const outcome = detectOutcome(s, occurrences, moves, rules, basePlies + ply);
  if (outcome) return terminalScore(outcome, ply);
  if (depth === 0) {
    let v = evaluate(s, rules);
    if (ctx.noise > 0) v += (Math.random() * 2 - 1) * ctx.noise;
    return v;
  }
  path.push(key);
  const ordered = orderMoves(moves);
  let value: number;
  if (s.toMove === 'tiger') {
    value = -Infinity;
    for (const m of ordered) {
      const v = search(
        applyMove(s, m, rules),
        depth - 1,
        ply + 1,
        alpha,
        beta,
        path,
        ctx,
        rules,
        basePlies,
      );
      if (v > value) value = v;
      if (value > alpha) alpha = value;
      if (alpha >= beta) break;
    }
  } else {
    value = Infinity;
    for (const m of ordered) {
      const v = search(
        applyMove(s, m, rules),
        depth - 1,
        ply + 1,
        alpha,
        beta,
        path,
        ctx,
        rules,
        basePlies,
      );
      if (v < value) value = v;
      if (value < beta) beta = value;
      if (alpha >= beta) break;
    }
  }
  path.pop();
  return value;
}

function chooseAtDepth(
  state: GameState,
  depth: number,
  ctx: Ctx,
  preferred: Move | null,
  rules: Ruleset,
  basePlies: number,
): { move: Move; value: number } {
  const moves = orderMoves(legalMoves(state, rules));
  if (preferred) {
    const idx = moves.findIndex((m) => sameMove(m, preferred));
    if (idx > 0) moves.unshift(...moves.splice(idx, 1));
  }
  const path: string[] = [positionKey(state)];
  let best = moves[0];
  let bestValue = state.toMove === 'tiger' ? -Infinity : Infinity;
  let alpha = -Infinity;
  let beta = Infinity;
  for (const m of moves) {
    const v = search(applyMove(state, m, rules), depth - 1, 1, alpha, beta, path, ctx, rules, basePlies);
    if (state.toMove === 'tiger') {
      if (v > bestValue) {
        bestValue = v;
        best = m;
      }
      if (v > alpha) alpha = v;
    } else {
      if (v < bestValue) {
        bestValue = v;
        best = m;
      }
      if (v < beta) beta = v;
    }
    if (alpha >= beta) break;
  }
  return { move: best, value: bestValue };
}

function sameMove(a: Move, b: Move): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'place' && b.kind === 'place') return a.to === b.to;
  if (a.kind === 'step' && b.kind === 'step') return a.from === b.from && a.to === b.to;
  if (a.kind === 'jump' && b.kind === 'jump')
    return a.from === b.from && a.over === b.over && a.to === b.to;
  return false;
}

const now = (): number => typeof performance !== 'undefined' ? performance.now() : Date.now();

export function chooseMove(
  state: GameState,
  difficulty: Difficulty,
  pastCounts: ReadonlyMap<string, number>,
  rules: Ruleset = CLASSIC_RULESET,
  plies = 0,
): Move {
  const moves = legalMoves(state, rules);
  if (moves.length === 0) throw new Error('no legal moves');
  if (moves.length === 1) return moves[0];

  const ctx: Ctx = { past: pastCounts, noise: 0, deadline: 0, nodes: 0 };
  let maxDepth: number;
  let budgetMs = 0;
  switch (difficulty) {
    case 'easy':
      maxDepth = 2;
      ctx.noise = 30;
      break;
    case 'medium':
      maxDepth = 5;
      break;
    case 'hard':
      maxDepth = 9;
      budgetMs = 1500;
      break;
  }

  const start = now();
  if (budgetMs > 0) ctx.deadline = start + budgetMs;
  let best = moves[0];
  for (let depth = 1; depth <= maxDepth; depth++) {
    try {
      const result = chooseAtDepth(state, depth, ctx, best, rules, plies);
      best = result.move;
    } catch (e) {
      if (e === TIMEOUT) break;
      throw e;
    }
    if (budgetMs > 0 && now() - start > budgetMs) break;
  }
  return best;
}
