import { CLASSIC_RULESET, MovementMode, Ruleset } from './rules';

const MOVES: MovementMode[] = ['classic', 'orthogonal-only', 'no-backtrack'];

export interface Preset {
  id: string;
  labelKey: string;
  rules: Ruleset;
}

export const PRESETS: Preset[] = [
  {
    id: 'classic',
    labelKey: 'presetClassic',
    rules: { goatCount: 20, tigerCount: 4, capturesToWin: 5, movement: 'classic', suddenDeath: false },
  },
  {
    id: 'speed',
    labelKey: 'presetSpeed',
    rules: { goatCount: 20, tigerCount: 4, capturesToWin: 4, movement: 'classic', suddenDeath: false },
  },
  {
    id: 'fortress',
    labelKey: 'presetFortress',
    rules: { goatCount: 15, tigerCount: 4, capturesToWin: 5, movement: 'orthogonal-only', suddenDeath: false },
  },
  {
    id: 'titan',
    labelKey: 'presetTitan',
    rules: { goatCount: 20, tigerCount: 5, capturesToWin: 5, movement: 'classic', suddenDeath: false },
  },
  {
    id: 'sudden',
    labelKey: 'presetSudden',
    rules: { goatCount: 20, tigerCount: 4, capturesToWin: 5, movement: 'classic', suddenDeath: true },
  },
];

/** Clamps every field into its legal range and drops unknown fields. */
export function sanitizeRules(r: Ruleset): Ruleset {
  const goatCount = Math.min(20, Math.max(5, Math.round(r.goatCount)));
  const tigerCount: 4 | 5 = r.tigerCount === 5 ? 5 : 4;
  const capturesToWin = Math.min(Math.min(10, goatCount), Math.max(1, Math.round(r.capturesToWin)));
  const movement: MovementMode = MOVES.includes(r.movement) ? r.movement : 'classic';
  return { goatCount, tigerCount, capturesToWin, movement, suddenDeath: r.suddenDeath === true };
}

export function sameRules(a: Ruleset, b: Ruleset): boolean {
  const x = sanitizeRules(a);
  const y = sanitizeRules(b);
  return (
    x.goatCount === y.goatCount &&
    x.tigerCount === y.tigerCount &&
    x.capturesToWin === y.capturesToWin &&
    x.movement === y.movement &&
    x.suddenDeath === y.suddenDeath
  );
}

export function presetFor(r: Ruleset): Preset | null {
  return PRESETS.find((p) => sameRules(p.rules, r)) ?? null;
}

/** Compact clipboard-friendly code: `BC` + 5 chars
 *  goats-5 (hex) | tiger (0/1) | captures-1 (hex) | movement (0-2) | cap on (0/1). */
export function encodeRules(r: Ruleset): string {
  const s = sanitizeRules(r);
  const g = (s.goatCount - 5).toString(16);
  const t = s.tigerCount === 5 ? '1' : '0';
  const c = (s.capturesToWin - 1).toString(16);
  const m = String(MOVES.indexOf(s.movement));
  const d = s.suddenDeath ? '1' : '0';
  return `BC${g}${t}${c}${m}${d}`;
}

/** Strict decode; returns null on any malformed/illegal code. */
export function decodeRules(code: string): Ruleset | null {
  const m = /^BC([0-9a-fA-F])([01])([0-9a-fA-F])([012])([01])$/.exec(code.trim());
  if (!m) return null;
  const goatCount = parseInt(m[1], 16) + 5;
  const capturesToWin = parseInt(m[3], 16) + 1;
  if (goatCount > 20 || capturesToWin > Math.min(10, goatCount)) return null;
  return {
    goatCount,
    tigerCount: m[2] === '1' ? 5 : 4,
    capturesToWin,
    movement: MOVES[parseInt(m[4], 10)],
    suddenDeath: m[5] === '1',
  };
}

export { CLASSIC_RULESET };
