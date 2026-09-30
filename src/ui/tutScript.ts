import { GameState, Move, initialState } from '../game/rules';

export type TutSide = 'goat' | 'tiger';

export interface TutStep {
  /** i18n key shown before the piece is selected (or for one-tap steps). */
  text: string;
  /** i18n key shown after tapPiece was tapped; falls back to `text`. */
  text2?: string;
  /** Absolute crafted position loaded when entering the step; omitted = carry current state. */
  state?: GameState;
  /** Pulsing guide ring: the node to tap (place) or the piece to select. */
  hint?: number;
  /** Piece the user must select first (move/capture steps). */
  tapPiece?: number;
  /** The one move the user must perform to complete the step. */
  expect?: Move;
  /** Moves that play automatically (instruction shown first), then the step advances. */
  auto?: Move[];
  /** Entry delay in ms: first auto move (default 900) / info auto-advance (default 1600). */
  delay?: number;
  /** No interaction: auto-advances after `delay`. */
  info?: boolean;
  /** i18n key of a gold button that advances the step (no board interaction). */
  tapBtn?: string;
  /** Summary step: show goal + action buttons, no board interaction. */
  final?: boolean;
  /** i18n key for the goal text on a final step. */
  goalKey?: string;
}

export interface TutScenario {
  side: TutSide;
  steps: TutStep[];
}

const G = (n: number): GameState => {
  const board: GameState['board'] = new Array(25).fill(null);
  board[0] = 'T';
  board[4] = 'T';
  board[20] = 'T';
  board[24] = 'T';
  board[n] = 'G';
  return { board, toMove: 'tiger', goatsInHand: 19, goatsCaptured: 0 };
};

/** 20 goats on the board, only the centre empty — goat movement phase. */
const ALL_GOATS: GameState = (() => {
  const board: GameState['board'] = new Array(25).fill(null);
  board[0] = 'T';
  board[4] = 'T';
  board[20] = 'T';
  board[24] = 'T';
  for (let n = 0; n < 25; n++) if (board[n] === null) board[n] = 'G';
  board[12] = null;
  return { board, toMove: 'goat', goatsInHand: 0, goatsCaptured: 0 };
})();

/** T@A1 ready to jump the ringed goat at A2; column A below is blocked so the
    jump over A2→A3 is tiger 0's only legal move. */
const JUMP_READY: GameState = (() => {
  const board: GameState['board'] = new Array(25).fill(null);
  board[0] = 'T';
  board[4] = 'T';
  board[20] = 'T';
  board[24] = 'T';
  board[1] = 'G';
  board[5] = 'G';
  board[10] = 'G';
  return { board, toMove: 'tiger', goatsInHand: 15, goatsCaptured: 2 };
})();

export const TUT_SCENARIOS: Record<TutSide, TutScenario> = {
  goat: {
    side: 'goat',
    steps: [
      {
        text: 'tStepPlace',
        state: initialState(),
        hint: 12,
        expect: { kind: 'place', to: 12 },
      },
      { text: 'tStepWatch', auto: [{ kind: 'step', from: 0, to: 1 }], delay: 1400 },
      { text: 'tStepPlace2', hint: 13, expect: { kind: 'place', to: 13 } },
      { text: 'tStepRest', tapBtn: 'tStepRestBtn' },
      { text: 'tStepAllPlaced', state: ALL_GOATS, info: true, delay: 1600 },
      {
        text: 'tStepMoveGoat',
        text2: 'tStepMove',
        state: ALL_GOATS,
        hint: 11,
        tapPiece: 11,
        expect: { kind: 'step', from: 11, to: 12 },
      },
      { text: 'tStepBlocked', info: true, delay: 1700 },
      { text: 'tutGoalG', final: true, goalKey: 'tutGoalG' },
    ],
  },
  tiger: {
    side: 'tiger',
    steps: [
      {
        text: 'tStepSelectTiger',
        text2: 'tStepMove',
        state: G(12),
        hint: 0,
        tapPiece: 0,
        expect: { kind: 'step', from: 0, to: 1 },
      },
      {
        text: 'tStepJump',
        state: JUMP_READY,
        hint: 0,
        tapPiece: 0,
        expect: { kind: 'jump', from: 0, over: 1, to: 2 },
      },
      { text: 'tStepEaten', info: true, delay: 1700 },
      { text: 'tutGoalT', final: true, goalKey: 'tutGoalT' },
    ],
  },
};
