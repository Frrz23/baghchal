import { describe, expect, it } from 'vitest';
import { JUMPS, NEIGHBORS, NODE_COUNT, TIGER_START, connected } from '../src/game/board';
import { GameEngine } from '../src/game/engine';
import {
  GameState,
  Move,
  Piece,
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
}): GameState {
  const board: Piece[] = new Array(NODE_COUNT).fill(null);
  for (const n of opts.tigers) board[n] = 'T';
  for (const n of opts.goats) board[n] = 'G';
  return {
    board,
    toMove: opts.toMove,
    goatsInHand: opts.inHand,
    goatsCaptured: opts.captured ?? 0,
  };
}

const ALL_BUT = (exclude: number[]): number[] =>
  Array.from({ length: NODE_COUNT }, (_, i) => i).filter((i) => !exclude.includes(i));

describe('board topology', () => {
  it('degrees match the alquerque pattern', () => {
    expect(NEIGHBORS[12].length).toBe(8); // center
    expect(NEIGHBORS[0].length).toBe(3); // corner
    expect(NEIGHBORS[1].length).toBe(3); // top edge, odd parity
    expect(NEIGHBORS[2].length).toBe(5); // top edge midpoint
    expect(NEIGHBORS[11].length).toBe(4); // inner odd
    expect(NEIGHBORS[6].length).toBe(8); // inner even
  });

  it('diagonals only connect even-parity nodes', () => {
    expect(connected(0, 6)).toBe(true); // even node diagonal
    expect(connected(12, 6)).toBe(true);
    expect(connected(1, 7)).toBe(false); // odd node has no diagonals
    expect(connected(11, 7)).toBe(false);
  });

  it('jumps go two steps along a connected line', () => {
    expect(JUMPS[12].length).toBe(8);
    expect(JUMPS[0].length).toBe(3);
    for (const list of JUMPS) {
      for (const j of list) {
        expect(connected(j.over, j.to)).toBe(true);
      }
    }
  });

  it('tigers start on the four corners', () => {
    expect([...TIGER_START]).toEqual([0, 4, 20, 24]);
  });
});

describe('initial state and placement phase', () => {
  it('starts with 4 tigers, 20 goats in hand, goat to move', () => {
    const s = initialState();
    expect(s.toMove).toBe('goat');
    expect(s.goatsInHand).toBe(20);
    expect(s.goatsCaptured).toBe(0);
    expect(s.board.filter((p) => p === 'T')).toHaveLength(4);
    expect(s.board.filter((p) => p === 'G')).toHaveLength(0);
  });

  it('goat places on any empty point (21 options at start)', () => {
    const moves = legalMoves(initialState());
    expect(moves).toHaveLength(21);
    expect(moves.every((m) => m.kind === 'place')).toBe(true);
  });

  it('tigers can move immediately after the first goat is placed', () => {
    const s = applyMove(initialState(), { kind: 'place', to: 12 });
    expect(s.toMove).toBe('tiger');
    const moves = legalMoves(s);
    expect(moves.every((m) => m.kind === 'step')).toBe(true);
    expect(moves).toHaveLength(12); // 4 corner tigers x 3 empty neighbours
  });

  it('placed goats stay frozen until all 20 are on the board', () => {
    let s = initialState();
    for (let i = 0; i < 3; i++) {
      const place = legalMoves(s).find((m) => m.kind === 'place')!;
      s = applyMove(s, place);
      s = applyMove(s, legalMoves(s)[0]);
    }
    expect(s.goatsInHand).toBe(17);
    expect(s.toMove).toBe('goat');
    expect(legalMoves(s).every((m) => m.kind === 'place')).toBe(true);
  });
});

describe('tiger captures', () => {
  it('jumps a goat and removes it', () => {
    const s = build({ tigers: [0, 4, 20, 24], goats: [1], inHand: 19, toMove: 'tiger' });
    const jump = legalMoves(s).find((m) => m.kind === 'jump');
    expect(jump).toEqual({ kind: 'jump', from: 0, over: 1, to: 2 });
    const after = applyMove(s, jump!);
    expect(after.board[1]).toBeNull();
    expect(after.board[2]).toBe('T');
    expect(after.goatsCaptured).toBe(1);
    expect(after.toMove).toBe('goat');
  });

  it('cannot jump over a tiger or into an occupied landing', () => {
    const overTiger = build({
      tigers: [0, 1, 4, 20],
      goats: [],
      inHand: 20,
      toMove: 'tiger',
    });
    expect(legalMoves(overTiger).filter((m) => m.kind === 'jump')).toHaveLength(0);

    const blockedLanding = build({
      tigers: [0, 4, 20, 24],
      goats: [1, 2],
      inHand: 18,
      toMove: 'tiger',
    });
    expect(legalMoves(blockedLanding).filter((m) => m.kind === 'jump')).toHaveLength(0);
  });
});

describe('win conditions', () => {
  it('tiger wins at 5 captures', () => {
    const s = build({
      tigers: [0, 4, 20, 24],
      goats: [1],
      inHand: 19,
      captured: 4,
      toMove: 'tiger',
    });
    const engine = new GameEngine(s);
    engine.play({ kind: 'jump', from: 0, over: 1, to: 2 });
    expect(engine.outcome).toEqual({ kind: 'win', winner: 'tiger', reason: 'captures' });
  });

  it('goat wins when every tiger is immobilized', () => {
    // corner tigers fully surrounded, every jump landing occupied:
    // steps {1,5,6, 3,9,8, 15,21,16, 23,19,18} + landings {2,10,12,14,22}
    const goats = ALL_BUT([0, 4, 20, 24, 7, 11, 13, 17]);
    const s = build({ tigers: [0, 4, 20, 24], goats, inHand: 3, toMove: 'tiger' });
    expect(goats).toHaveLength(17);
    expect(legalMoves(s)).toHaveLength(0);
    expect(detectOutcome(s, 1)).toEqual({ kind: 'win', winner: 'goat', reason: 'tiger-blocked' });
  });

  it('tiger wins when all goats are locked after placement', () => {
    const goats = ALL_BUT([0, 1, 5, 6, 4]);
    const s = build({ tigers: [4, 1, 5, 6], goats, inHand: 0, toMove: 'goat' });
    expect(goats).toHaveLength(20);
    expect(legalMoves(s)).toHaveLength(0);
    expect(detectOutcome(s, 1)).toEqual({ kind: 'win', winner: 'tiger', reason: 'goats-locked' });
  });
});

describe('repetition draw', () => {
  it('third occurrence of a position is a draw', () => {
    const s = build({
      tigers: [0, 4, 20, 24],
      goats: [2, 3, 5, 6, 7, 8, 9, 11, 15, 16, 17, 18, 19, 21, 22, 23],
      inHand: 0,
      toMove: 'goat',
    });
    const engine = new GameEngine(s);
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
    for (let i = 0; i < shuffle.length; i++) {
      engine.play(shuffle[i]);
      if (i < shuffle.length - 1) expect(engine.outcome).toBeNull();
    }
    expect(engine.outcome).toEqual({ kind: 'draw', reason: 'repetition' });
  });

  it('position key includes side to move and counters', () => {
    const a = initialState();
    const b = applyMove(a, { kind: 'place', to: 12 });
    expect(positionKey(a)).not.toBe(positionKey(b));
    expect(positionKey(a)).toMatch(/\|g\|20\|0$/);
  });
});

describe('undo', () => {
  it('restores the previous state and clears the outcome', () => {
    const s = build({
      tigers: [0, 4, 20, 24],
      goats: [1],
      inHand: 19,
      captured: 4,
      toMove: 'tiger',
    });
    const engine = new GameEngine(s);
    engine.play({ kind: 'jump', from: 0, over: 1, to: 2 });
    expect(engine.outcome).not.toBeNull();
    engine.undo();
    expect(engine.outcome).toBeNull();
    expect(engine.current.goatsCaptured).toBe(4);
    expect(engine.current.board[1]).toBe('G');
    expect(engine.current.board[0]).toBe('T');
  });
});
