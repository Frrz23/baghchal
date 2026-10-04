import { describe, expect, it } from 'vitest';
import { chooseMove } from '../src/game/ai';
import { NODE_COUNT, TIGER_START, connected, rowOf, colOf } from '../src/game/board';
import { GameEngine } from '../src/game/engine';
import {
  PRESETS,
  decodeRules,
  encodeRules,
  presetFor,
  sanitizeRules,
  sameRules,
} from '../src/game/presets';
import {
  CAPTURES_TO_WIN,
  CLASSIC_RULESET,
  GOAT_COUNT,
  GameState,
  Move,
  Piece,
  Ruleset,
  Side,
  applyMove,
  detectOutcome,
  initialState,
  legalMoves,
  positionKey,
} from '../src/game/rules';

function build(opts: {
  tigers: number[];
  goats: number[];
  inHand: number;
  captured?: number;
  toMove: Side;
  cameFrom?: (number | null)[];
}): GameState {
  const board: Piece[] = new Array(NODE_COUNT).fill(null);
  for (const n of opts.tigers) board[n] = 'T';
  for (const n of opts.goats) board[n] = 'G';
  return {
    board,
    toMove: opts.toMove,
    goatsInHand: opts.inHand,
    goatsCaptured: opts.captured ?? 0,
    ...(opts.cameFrom ? { cameFrom: opts.cameFrom } : {}),
  };
}

const ORTHO: Ruleset = { ...CLASSIC_RULESET, movement: 'orthogonal-only' };
const NOBACK: Ruleset = { ...CLASSIC_RULESET, movement: 'no-backtrack' };
const TITAN: Ruleset = { ...CLASSIC_RULESET, tigerCount: 5 };
const ALL_NODES = Array.from({ length: NODE_COUNT }, (_, i) => i);

describe('ruleset parameterization', () => {
  it('classic ruleset matches the v1 constants exactly', () => {
    expect(CLASSIC_RULESET.goatCount).toBe(GOAT_COUNT);
    expect(CLASSIC_RULESET.capturesToWin).toBe(CAPTURES_TO_WIN);
    expect(CLASSIC_RULESET.tigerCount).toBe(4);
    expect(CLASSIC_RULESET.movement).toBe('classic');
    expect(CLASSIC_RULESET.suddenDeath).toBe(false);
  });

  it('initialState honors goatCount', () => {
    const s = initialState({ ...CLASSIC_RULESET, goatCount: 10 });
    expect(s.goatsInHand).toBe(10);
    expect(s.board.filter((p) => p === 'T')).toHaveLength(4);
  });

  it('fifth tiger starts on the centre', () => {
    const s = initialState(TITAN);
    expect(s.board.filter((p) => p === 'T')).toHaveLength(5);
    expect(s.board[12]).toBe('T');
    expect(positionKey(initialState(TITAN))).not.toBe(positionKey(initialState(CLASSIC_RULESET)));
  });

  it('captures win at a custom target', () => {
    const rules: Ruleset = { ...CLASSIC_RULESET, capturesToWin: 3 };
    const s = build({ tigers: [0, 4, 20, 24], goats: [1], inHand: 19, captured: 2, toMove: 'tiger' });
    const engine = new GameEngine(s, rules);
    engine.play({ kind: 'jump', from: 0, over: 1, to: 2 });
    expect(engine.outcome).toEqual({ kind: 'win', winner: 'tiger', reason: 'captures' });
  });

  it('tiger wins by blocking with five tigers on the board', () => {
    const tigers = [0, 4, 12, 20, 24];
    const goats = ALL_NODES.filter((n) => !tigers.includes(n));
    const s = build({ tigers, goats, inHand: 0, toMove: 'tiger' });
    expect(legalMoves(s, TITAN)).toHaveLength(0);
    expect(detectOutcome(s, 1, undefined, TITAN)).toEqual({
      kind: 'win',
      winner: 'goat',
      reason: 'tiger-blocked',
    });
  });

  it('tiger wins by locking five goats with a small herd', () => {
    const rules: Ruleset = { ...CLASSIC_RULESET, goatCount: 5, capturesToWin: 5 };
    const s = build({ tigers: [1, 5, 6, 4], goats: [0], inHand: 0, toMove: 'goat' });
    expect(legalMoves(s, rules)).toHaveLength(0);
    expect(detectOutcome(s, 1, undefined, rules)).toEqual({
      kind: 'win',
      winner: 'tiger',
      reason: 'goats-locked',
    });
  });

  it('AI returns a legal move under custom rules', () => {
    const engine = new GameEngine(undefined, ORTHO);
    const move = chooseMove(engine.current, 'medium', engine.searchCounts(), ORTHO, 0);
    expect(legalMoves(engine.current, ORTHO)).toContainEqual(move);
  });
});

describe('orthogonal-only movement', () => {
  it('blocks diagonal steps', () => {
    const s = build({ tigers: [0, 4, 20, 24], goats: [], inHand: 20, toMove: 'tiger' });
    const classic = legalMoves(s).filter((m) => m.kind === 'step' && m.from === 0);
    expect(classic.map((m) => (m.kind === 'step' ? m.to : -1)).sort((a, b) => a - b)).toEqual([
      1, 5, 6,
    ]);
    const ortho = legalMoves(s, ORTHO).filter((m) => m.kind === 'step' && m.from === 0);
    expect(ortho.map((m) => (m.kind === 'step' ? m.to : -1)).sort((a, b) => a - b)).toEqual([1, 5]);
  });

  it('blocks jumps with a diagonal leg', () => {
    const s = build({ tigers: [0, 4, 20, 24], goats: [1, 5, 6], inHand: 17, toMove: 'tiger' });
    const jumps = legalMoves(s, ORTHO).filter((m) => m.kind === 'jump' && m.from === 0);
    const targets = jumps.map((m) => (m.kind === 'jump' ? m.to : -1));
    expect(targets).toContain(2); // 0-1-2 horizontal
    expect(targets).toContain(10); // 0-5-10 vertical

    // centre tiger jumping diagonally over 6 to 0: allowed classic, banned ortho
    const centre = build({ tigers: [12, 4, 20, 24], goats: [6], inHand: 19, toMove: 'tiger' });
    expect(legalMoves(centre).filter((m) => m.kind === 'jump' && m.from === 12)).toContainEqual({
      kind: 'jump',
      from: 12,
      over: 6,
      to: 0,
    });
    expect(legalMoves(centre, ORTHO).filter((m) => m.kind === 'jump' && m.from === 12)).toHaveLength(
      0,
    );
  });

  it('the orthogonal graph stays connected', () => {
    const seen = new Set<number>([0]);
    const queue = [0];
    while (queue.length > 0) {
      const cur = queue.pop()!;
      for (let n = 0; n < NODE_COUNT; n++) {
        if (n === cur || seen.has(n) || !connected(cur, n)) continue;
        if (rowOf(cur) !== rowOf(n) && colOf(cur) !== colOf(n)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    expect(seen.size).toBe(NODE_COUNT);
  });

  it('board view line count drops only the diagonals', () => {
    let total = 0;
    let diagonals = 0;
    for (let a = 0; a < NODE_COUNT; a++) {
      for (let b = a + 1; b < NODE_COUNT; b++) {
        if (!connected(a, b)) continue;
        total++;
        if (rowOf(a) !== rowOf(b) && colOf(a) !== colOf(b)) diagonals++;
      }
    }
    expect(total - diagonals).toBeGreaterThan(0);
    expect(diagonals).toBeGreaterThan(0);
  });
});

describe('no-backtrack movement', () => {
  it('initial state carries the cameFrom array only in no-backtrack mode', () => {
    expect(initialState(NOBACK).cameFrom).toHaveLength(NODE_COUNT);
    expect(initialState(CLASSIC_RULESET).cameFrom).toBeUndefined();
  });

  it('a piece may not return to the node it just left', () => {
    const cameFrom = new Array<number | null>(NODE_COUNT).fill(null);
    cameFrom[5] = 0; // the piece at 5 arrived from 0
    const s = build({ tigers: [5, 4, 20, 24], goats: [], inHand: 20, toMove: 'tiger', cameFrom });
    const steps = legalMoves(s, NOBACK).filter((m) => m.kind === 'step' && m.from === 5);
    const tos = steps.map((m) => (m.kind === 'step' ? m.to : -1));
    expect(tos).not.toContain(0);
    expect(tos.length).toBeGreaterThan(0);
    expect(legalMoves(s).filter((m) => m.kind === 'step' && m.from === 5 && m.to === 0)).toHaveLength(1);
  });

  it('applyMove records where each piece came from', () => {
    const s = initialState(NOBACK);
    const after = applyMove(s, { kind: 'place', to: 12 }, NOBACK);
    expect(after.cameFrom?.[12]).toBeNull(); // placement is a fresh arrival
    const tiger = legalMoves(after, NOBACK).find((m) => m.kind === 'step')!;
    const moved = applyMove(after, tiger, NOBACK);
    if (tiger.kind !== 'step') throw new Error('expected a step');
    expect(moved.cameFrom?.[tiger.to]).toBe(tiger.from);
    expect(moved.cameFrom?.[tiger.from]).toBeNull();
  });

  it('positionKey folds in cameFrom only when it exists', () => {
    const a = build({ tigers: [0, 4, 20, 24], goats: [], inHand: 20, toMove: 'tiger' });
    const b = build({
      tigers: [0, 4, 20, 24],
      goats: [],
      inHand: 20,
      toMove: 'tiger',
      cameFrom: new Array<number | null>(NODE_COUNT).fill(null),
    });
    expect(positionKey(a)).not.toBe(positionKey(b));
    const c = build({
      tigers: [0, 4, 20, 24],
      goats: [],
      inHand: 20,
      toMove: 'tiger',
      cameFrom: (() => {
        const cf = new Array<number | null>(NODE_COUNT).fill(null);
        cf[0] = 1;
        return cf;
      })(),
    });
    expect(positionKey(b)).not.toBe(positionKey(c));
  });

  it('undo restores the previous cameFrom', () => {
    const engine = new GameEngine(initialState(NOBACK), NOBACK);
    const before = positionKey(engine.current);
    const move = legalMoves(engine.current, NOBACK).find((m) => m.kind === 'place')!;
    engine.play(move);
    expect(positionKey(engine.current)).not.toBe(before);
    engine.undo();
    expect(positionKey(engine.current)).toBe(before);
  });
});

describe('sudden-death cap', () => {
  it('adjudicates at the cap: captures decide, tie goes to goats', () => {
    const rules: Ruleset = { ...CLASSIC_RULESET, suddenDeath: true, plyCap: 400 };
    const s = build({ tigers: [0, 4, 20, 24], goats: [1], inHand: 19, captured: 2, toMove: 'goat' });
    expect(detectOutcome(s, 1, undefined, rules, 400)).toEqual({
      kind: 'win',
      winner: 'tiger',
      reason: 'sudden-death',
    });
    const tied = build({ tigers: [0, 4, 20, 24], goats: [], inHand: 20, toMove: 'goat' });
    expect(detectOutcome(tied, 1, undefined, rules, 400)).toEqual({
      kind: 'win',
      winner: 'goat',
      reason: 'sudden-death',
    });
  });

  it('stays silent below the cap and with the cap disabled', () => {
    const on: Ruleset = { ...CLASSIC_RULESET, suddenDeath: true, plyCap: 400 };
    const s = build({ tigers: [0, 4, 20, 24], goats: [], inHand: 20, toMove: 'goat' });
    expect(detectOutcome(s, 1, undefined, on, 399)).toBeNull();
    expect(detectOutcome(s, 1, undefined, CLASSIC_RULESET, 100_000)).toBeNull();
  });

  it('engine terminates on a short custom cap', () => {
    const rules: Ruleset = { ...CLASSIC_RULESET, suddenDeath: true, plyCap: 6 };
    const engine = new GameEngine(undefined, rules);
    const scripted: Move[] = [
      { kind: 'place', to: 12 },
      { kind: 'step', from: 0, to: 5 },
      { kind: 'place', to: 1 },
      { kind: 'step', from: 4, to: 3 },
      { kind: 'place', to: 2 },
      { kind: 'step', from: 20, to: 15 },
    ];
    for (let i = 0; i < scripted.length; i++) {
      engine.play(scripted[i]);
      if (i < scripted.length - 1) expect(engine.outcome).toBeNull();
    }
    expect(engine.outcome).toEqual({ kind: 'win', winner: 'goat', reason: 'sudden-death' });
  });

  it('repetition still ends the game before the cap', () => {
    const rules: Ruleset = { ...CLASSIC_RULESET, suddenDeath: true, plyCap: 400 };
    const s = build({
      tigers: [0, 4, 20, 24],
      goats: [2, 3, 5, 6, 7, 8, 9, 11, 15, 16, 17, 18, 19, 21, 22, 23],
      inHand: 0,
      toMove: 'goat',
    });
    const engine = new GameEngine(s, rules);
    const shuffle: Move[] = [
      { kind: 'step', from: 16, to: 10 },
      { kind: 'step', from: 0, to: 1 },
      { kind: 'step', from: 10, to: 16 },
      { kind: 'step', from: 1, to: 0 },
      { kind: 'step', from: 16, to: 10 },
      { kind: 'step', from: 0, to: 1 },
      { kind: 'step', from: 10, to: 16 },
      { kind: 'step', from: 1, to: 0 },
    ];
    for (const m of shuffle) engine.play(m);
    expect(engine.outcome).toEqual({ kind: 'draw', reason: 'repetition' });
  });
});

describe('presets and share codes', () => {
  it('five presets, all distinct', () => {
    expect(PRESETS).toHaveLength(5);
    for (let i = 0; i < PRESETS.length; i++) {
      for (let j = i + 1; j < PRESETS.length; j++) {
        expect(sameRules(PRESETS[i].rules, PRESETS[j].rules)).toBe(false);
      }
    }
    expect(presetFor(CLASSIC_RULESET)?.id).toBe('classic');
    expect(presetFor({ ...CLASSIC_RULESET, goatCount: 12 })).toBeNull();
  });

  it('every preset round-trips through its share code', () => {
    for (const p of PRESETS) {
      const code = encodeRules(p.rules);
      expect(code).toMatch(/^BC[0-9a-f][01][0-9a-f][012][01]$/);
      expect(decodeRules(code)).toEqual(sanitizeRules(p.rules));
    }
  });

  it('classic encodes to BCf0400', () => {
    expect(encodeRules(CLASSIC_RULESET)).toBe('BCf0400');
    expect(decodeRules('BCf0400')).toEqual(CLASSIC_RULESET);
  });

  it('rejects malformed and illegal codes', () => {
    expect(decodeRules('')).toBeNull();
    expect(decodeRules('XXf0400')).toBeNull();
    expect(decodeRules('BC99999')).toBeNull(); // tiger field must be 0/1
    expect(decodeRules('BCzzzzz')).toBeNull(); // movement must be 0-2
    expect(decodeRules('BC00900')).toBeNull(); // 10 captures with only 5 goats
    expect(decodeRules('BCf04000')).toBeNull(); // too long
    expect(decodeRules('BC01211')).not.toBeNull(); // 5 goats, 5 tigers, 3 captures, ortho, cap on
  });

  it('sanitize clamps out-of-range drafts', () => {
    const r = sanitizeRules({
      goatCount: 99,
      tigerCount: 7 as unknown as 5,
      capturesToWin: -3,
      movement: 'sideways' as unknown as 'classic',
      suddenDeath: true,
    });
    expect(r).toEqual({
      goatCount: 20,
      tigerCount: 4,
      capturesToWin: 1,
      movement: 'classic',
      suddenDeath: true,
    });
  });

  it('encode clamps captures to the herd size so codes stay decodable', () => {
    const r: Ruleset = { ...CLASSIC_RULESET, goatCount: 5, capturesToWin: 10 };
    const code = encodeRules(r);
    const back = decodeRules(code);
    expect(back).not.toBeNull();
    expect(back!.capturesToWin).toBeLessThanOrEqual(back!.goatCount);
  });

  it('TIGER_START still holds four corners for classic', () => {
    expect([...TIGER_START]).toEqual([0, 4, 20, 24]);
  });
});
