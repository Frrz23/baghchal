import { Difficulty, chooseMove } from './ai';
import { GameState, Move, Ruleset } from './rules';

interface Request {
  id: number;
  state: GameState;
  difficulty: Difficulty;
  pastCounts: Map<string, number>;
  rules: Ruleset;
  plies: number;
}

const worker = self as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null;
  postMessage: (data: { id: number; move: Move }) => void;
};

worker.onmessage = (e: MessageEvent<Request>) => {
  const { id, state, difficulty, pastCounts, rules, plies } = e.data;
  try {
    const move = chooseMove(state, difficulty, pastCounts, rules, plies);
    worker.postMessage({ id, move });
  } catch (err) {
    console.error('AI failed', err);
  }
};
