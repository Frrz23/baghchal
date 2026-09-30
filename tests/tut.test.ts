import { describe, expect, it } from 'vitest';
import { JUMPS, NODE_COUNT, connected } from '../src/game/board';
import {
  GameState,
  applyMove,
  detectOutcome,
  initialState,
  legalMoves,
  movesMatch,
} from '../src/game/rules';
import { TUT_SCENARIOS, TutStep } from '../src/ui/tutScript';

const SIDES = ['goat', 'tiger'] as const;

function refNodes(step: TutStep): number[] {
  const refs: number[] = [];
  if (step.hint !== undefined) refs.push(step.hint);
  if (step.tapPiece !== undefined) refs.push(step.tapPiece);
  if (step.expect) {
    refs.push(step.expect.to);
    if (step.expect.kind !== 'place') refs.push(step.expect.from);
  }
  for (const m of step.auto ?? []) {
    if (m.kind !== 'place') refs.push(m.from);
    refs.push(m.to);
  }
  return refs;
}

describe('tutorial scenarios', () => {
  for (const side of SIDES) {
    const sc = TUT_SCENARIOS[side];

    describe(side, () => {
      it('starts with a crafted state and ends in a final goal step', () => {
        expect(sc.steps[0].state, 'first step must carry its state').toBeDefined();
        expect(sc.steps.length).toBeGreaterThanOrEqual(4);
        const last = sc.steps[sc.steps.length - 1];
        expect(last.final, 'track must end on a final step').toBe(true);
        expect(last.goalKey).toBeDefined();
        expect(sc.steps.filter((s) => s.final)).toHaveLength(1);
      });

      it('crafted states satisfy the piece-count invariants', () => {
        for (const [i, step] of sc.steps.entries()) {
          if (!step.state) continue;
          const s: GameState = step.state;
          expect(s.board, `step ${i} board size`).toHaveLength(NODE_COUNT);
          const tigers = s.board.filter((p) => p === 'T').length;
          const goats = s.board.filter((p) => p === 'G').length;
          expect(tigers, `step ${i} always 4 tigers`).toBe(4);
          expect(goats + s.goatsInHand + s.goatsCaptured, `step ${i} goats add to 20`).toBe(20);
          expect(s.goatsCaptured, `step ${i} under the win threshold`).toBeLessThan(5);
        }
      });

      it('every referenced node is in range and tapPiece holds the right piece', () => {
        for (const [i, step] of sc.steps.entries()) {
          for (const n of refNodes(step)) {
            expect(n, `step ${i} node ref`).toBeGreaterThanOrEqual(0);
            expect(n, `step ${i} node ref`).toBeLessThan(NODE_COUNT);
          }
          if (step.tapPiece !== undefined) {
            expect(step.state, `step ${i} selection step carries state`).toBeDefined();
            const want = side === 'goat' ? 'G' : 'T';
            expect(step.state!.board[step.tapPiece], `step ${i} tapPiece piece`).toBe(want);
          }
        }
      });

      it('walks the whole track: expected + auto moves are all legal', () => {
        let state: GameState = initialState();
        for (const [i, step] of sc.steps.entries()) {
          if (step.state) state = step.state;
          if (step.expect) {
            const found = legalMoves(state).find((m) => movesMatch(m, step.expect!));
            expect(found, `step ${i}: expected move must be legal`).toBeDefined();
            if (step.expect.kind === 'step') {
              const { from, to } = step.expect;
              expect(connected(from, to), `step ${i}: step is adjacent`).toBe(true);
            }
            if (step.expect.kind === 'jump') {
              const { from, over, to } = step.expect;
              expect(
                JUMPS[from].some((j) => j.over === over && j.to === to),
                `step ${i}: jump exists in JUMPS`,
              ).toBe(true);
              expect(state.board[over], `step ${i}: prey is a goat`).toBe('G');
              expect(state.board[to], `step ${i}: landing is empty`).toBeNull();
            }
            state = applyMove(state, step.expect);
          }
          for (const [j, m] of (step.auto ?? []).entries()) {
            const found = legalMoves(state).find((m2) => movesMatch(m2, m));
            expect(found, `step ${i}: auto move ${j} must be legal`).toBeDefined();
            state = applyMove(state, m);
          }
          if (step.final) expect(step.expect, 'final step has no pending tap').toBeUndefined();
        }
      });

      if (side === 'goat') {
        it('fast-forward tap precedes the all-placed fill', () => {
          const i = sc.steps.findIndex((s) => s.tapBtn !== undefined);
          expect(i, 'goat track has a fast-forward step').toBeGreaterThan(1);
          for (let j = 0; j < i; j++) {
            const st = sc.steps[j].state;
            if (!st) continue;
            const filled = st.board.filter(Boolean).length;
            expect(filled, `step ${j} must stay small before the tap`).toBeLessThan(10);
          }
          const next = sc.steps[i + 1];
          expect(next?.state, 'fill loads on the step after the tap').toBeDefined();
          expect(next?.info, 'fill step narrates the swap').toBe(true);
          expect(next!.state!.board.filter(Boolean).length, 'fill puts 24 pieces on').toBe(24);
        });

        it('goat finale is a real tiger-blocked win', () => {
          let state: GameState = initialState();
          for (const step of sc.steps) {
            if (step.state) state = step.state;
            if (step.expect) state = applyMove(state, step.expect);
            for (const m of step.auto ?? []) state = applyMove(state, m);
          }
          expect(detectOutcome(state, 1)).toEqual({
            kind: 'win',
            winner: 'goat',
            reason: 'tiger-blocked',
          });
        });
      }
    });
  }
});
