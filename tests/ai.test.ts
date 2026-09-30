import { describe, expect, it } from 'vitest';
import { Difficulty, chooseMove } from '../src/game/ai';
import { NODE_COUNT } from '../src/game/board';
import { GameEngine } from '../src/game/engine';
import { Piece, legalMoves, movesMatch } from '../src/game/rules';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

describe('chooseMove', () => {
  it('always returns a legal move from the start position', () => {
    for (const d of DIFFICULTIES) {
      const engine = new GameEngine();
      const move = chooseMove(engine.current, d, engine.searchCounts());
      expect(engine.legalMoves().some((m) => movesMatch(m, move))).toBe(true);
    }
  });

  it('takes a free capture as tiger', () => {
    for (const d of ['medium', 'hard'] as Difficulty[]) {
      const engine = new GameEngine({
        board: (() => {
          const b: Piece[] = new Array(NODE_COUNT).fill(null);
          b[0] = 'T';
          b[4] = 'T';
          b[20] = 'T';
          b[24] = 'T';
          b[1] = 'G';
          return b;
        })(),
        toMove: 'tiger',
        goatsInHand: 19,
        goatsCaptured: 0,
      });
      const move = chooseMove(engine.current, d, engine.searchCounts());
      expect(move.kind).toBe('jump');
      expect(move).toMatchObject({ from: 0, over: 1, to: 2 });
    }
  });

  it('medium goat prefers the centre in the opening', () => {
    const engine = new GameEngine();
    const move = chooseMove(engine.current, 'medium', engine.searchCounts());
    expect(move).toEqual({ kind: 'place', to: 12 });
  });

  it('runs a full self-play game without crashing', () => {
    const engine = new GameEngine();
    let plies = 0;
    while (!engine.outcome && plies < 120) {
      const move = chooseMove(engine.current, 'easy', engine.searchCounts());
      expect(engine.legalMoves().some((m) => movesMatch(m, move))).toBe(true);
      engine.play(move);
      plies++;
    }
    expect(plies).toBeGreaterThan(0);
    if (!engine.outcome) {
      // repetition or capture wins should normally end far earlier; hitting the
      // cap is allowed but the game must have been legal throughout
      expect(engine.historyLength).toBe(120);
    }
  });

  it('goat side has moves chosen legally during placement', () => {
    const engine = new GameEngine();
    for (let i = 0; i < 5; i++) {
      const goatMove = chooseMove(engine.current, 'medium', engine.searchCounts());
      expect(legalMoves(engine.current)).toContainEqual(goatMove);
      engine.play(goatMove);
      const tigerMove = chooseMove(engine.current, 'medium', engine.searchCounts());
      engine.play(tigerMove);
    }
    expect(engine.current.goatsInHand).toBe(15);
  });
});
