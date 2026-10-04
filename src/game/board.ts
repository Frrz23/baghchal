export type Piece = 'T' | 'G' | null;
export type Side = 'tiger' | 'goat';
export type MovementMode = 'classic' | 'orthogonal-only' | 'no-backtrack';

export const SIZE = 5;
export const NODE_COUNT = SIZE * SIZE;

export const rowOf = (n: number): number => Math.floor(n / SIZE);
export const colOf = (n: number): number => n % SIZE;
export const nodeAt = (r: number, c: number): number => r * SIZE + c;

export function connected(a: number, b: number): boolean {
  const dr = Math.abs(rowOf(a) - rowOf(b));
  const dc = Math.abs(colOf(a) - colOf(b));
  if (dr + dc === 1) return true;
  if (dr === 1 && dc === 1) return (rowOf(a) + colOf(a)) % 2 === 0;
  return false;
}

export const NEIGHBORS: readonly (readonly number[])[] = (() => {
  const out: number[][] = [];
  for (let a = 0; a < NODE_COUNT; a++) {
    const list: number[] = [];
    for (let b = 0; b < NODE_COUNT; b++) {
      if (b !== a && connected(a, b)) list.push(b);
    }
    out.push(list);
  }
  return out;
})();

export interface Jump {
  over: number;
  to: number;
}

export const JUMPS: readonly (readonly Jump[])[] = (() => {
  const out: Jump[][] = [];
  for (let a = 0; a < NODE_COUNT; a++) {
    const list: Jump[] = [];
    for (const mid of NEIGHBORS[a]) {
      const to = mid + (mid - a);
      if (to < 0 || to >= NODE_COUNT) continue;
      if (!connected(mid, to)) continue;
      if (Math.abs(rowOf(to) - rowOf(mid)) > 1 || Math.abs(colOf(to) - colOf(mid)) > 1) continue;
      list.push({ over: mid, to });
    }
    out.push(list);
  }
  return out;
})();

export const TIGER_START: readonly number[] = [nodeAt(0, 0), nodeAt(0, 4), nodeAt(4, 0), nodeAt(4, 4)];
