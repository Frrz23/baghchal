import {
  GameState,
  Move,
  Outcome,
  applyMove,
  detectOutcome,
  initialState,
  legalMoves,
  movesMatch,
  positionKey,
} from './rules';

export class GameEngine {
  private state: GameState;
  private counts = new Map<string, number>();
  private stack: { move: Move; state: GameState }[] = [];
  outcome: Outcome | null = null;

  constructor(state: GameState = initialState()) {
    this.state = state;
    this.counts.set(positionKey(state), 1);
  }

  get current(): GameState {
    return this.state;
  }

  get historyLength(): number {
    return this.stack.length;
  }

  get moves(): Move[] {
    return this.stack.map((e) => e.move);
  }

  legalMoves(): Move[] {
    return legalMoves(this.state);
  }

  play(move: Move): void {
    if (this.outcome) throw new Error('game already over');
    const legal = legalMoves(this.state);
    const found = legal.find((m) => movesMatch(m, move));
    if (!found) throw new Error('illegal move');
    this.stack.push({ move: found, state: this.state });
    this.state = applyMove(this.state, found);
    const key = positionKey(this.state);
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    this.outcome = detectOutcome(this.state, count);
  }

  undo(): void {
    const entry = this.stack.pop();
    if (!entry) return;
    this.state = entry.state;
    const key = positionKey(this.state);
    const count = (this.counts.get(key) ?? 1) - 1;
    if (count <= 0) this.counts.delete(key);
    else this.counts.set(key, count);
    this.outcome = null;
  }

  /** Position counts for the AI search: history WITHOUT the current position's own occurrence. */
  searchCounts(): Map<string, number> {
    const copy = new Map(this.counts);
    const key = positionKey(this.state);
    const count = (copy.get(key) ?? 1) - 1;
    if (count <= 0) copy.delete(key);
    else copy.set(key, count);
    return copy;
  }
}
