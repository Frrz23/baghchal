import process from 'node:process';
import { afterAll, test } from 'vitest';
import { Difficulty, chooseMove } from '../src/game/ai';
import { GameEngine } from '../src/game/engine';
import { PRESETS } from '../src/game/presets';
import { CLASSIC_RULESET, Outcome, Ruleset, Side } from '../src/game/rules';

type Bucket = 'win-captures' | 'win-blocked' | 'win-locked' | 'win-sudden' | 'draw-repetition' | 'ply-cap';

interface GameResult {
  pairing: string;
  game: number;
  seed: number;
  goat: Difficulty;
  tiger: Difficulty;
  winner: Side | null;
  bucket: Bucket;
  plies: number;
  elapsedMs: number;
}

const PLY_CAP = 300;

/** MATCH_PRESET selects the ruleset: classic (default) or a preset id. */
function rulesForRun(): Ruleset {
  const want = process.env.MATCH_PRESET ?? 'classic';
  if (want === 'classic') return CLASSIC_RULESET;
  const p = PRESETS.find((x) => x.id === want);
  if (!p) {
    throw new Error(
      `unknown MATCH_PRESET="${want}" (use one of: classic, ${PRESETS.map((x) => x.id).join(', ')})`,
    );
  }
  return p.rules;
}

const RULES = rulesForRun();

const PAIRS: [Difficulty, Difficulty][] = [
  ['easy', 'medium'],
  ['easy', 'hard'],
  ['medium', 'hard'],
  ['hard', 'hard'],
  ['medium', 'medium'],
];

const DIFFS: Difficulty[] = ['easy', 'medium', 'hard'];

const originalRandom = Math.random;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseSeeds(): number[] {
  const list = process.env.MATCH_SEEDS;
  if (list !== undefined && list.trim() !== '') {
    return list
      .split(',')
      .map((s) => Number(s.trim()) >>> 0)
      .filter((_, i, arr) => arr.indexOf(arr[i]) === i);
  }
  const runsRaw = Number(process.env.MATCH_RUNS ?? '1');
  const runs = Number.isFinite(runsRaw) && runsRaw >= 1 ? Math.floor(runsRaw) : 1;
  const baseEnv = process.env.MATCH_SEED;
  const base =
    baseEnv !== undefined && baseEnv !== ''
      ? Number(baseEnv) >>> 0
      : Math.floor(originalRandom() * 4294967296) >>> 0;
  return Array.from({ length: runs }, (_, i) => (base + i) >>> 0);
}

const SEEDS = parseSeeds();

afterAll(() => {
  Math.random = originalRandom;
});

const nowMs = (): number => performance.now();

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function classify(o: Outcome): Bucket {
  if (o.kind === 'draw') return 'draw-repetition';
  switch (o.reason) {
    case 'captures':
      return 'win-captures';
    case 'tiger-blocked':
      return 'win-blocked';
    case 'goats-locked':
      return 'win-locked';
    case 'sudden-death':
      return 'win-sudden';
    default:
      throw new Error(`unexpected win reason: ${o.reason}`);
  }
}

async function playGame(
  pairing: string,
  game: number,
  seed: number,
  goat: Difficulty,
  tiger: Difficulty,
  think: Map<Difficulty, number[]>,
): Promise<GameResult> {
  const engine = new GameEngine(undefined, RULES);
  // sudden-death presets terminate at their own ply cap; give it margin over
  // the harness watchdog so the ruleset adjudicates instead of the harness flag
  const harnessCap = RULES.suddenDeath ? (RULES.plyCap ?? 400) + 50 : PLY_CAP;
  const start = nowMs();
  while (!engine.outcome && engine.historyLength < harnessCap) {
    const diff = engine.current.toMove === 'goat' ? goat : tiger;
    const t0 = nowMs();
    const move = chooseMove(
      engine.current,
      diff,
      engine.searchCounts(),
      RULES,
      engine.historyLength,
    );
    think.get(diff)!.push(nowMs() - t0);
    engine.play(move);
    await tick(); // keep the vitest worker's RPC channel serviced during long searches
  }
  const elapsedMs = nowMs() - start;
  if (!engine.outcome) {
    console.warn(
      `WARN [ply-cap] pairing="${pairing}" game=${game} seed=${seed} goat=${goat} tiger=${tiger} plies=${engine.historyLength}`,
    );
    return {
      pairing,
      game,
      seed,
      goat,
      tiger,
      winner: null,
      bucket: 'ply-cap',
      plies: engine.historyLength,
      elapsedMs,
    };
  }
  const o = engine.outcome;
  return {
    pairing,
    game,
    seed,
    goat,
    tiger,
    winner: o.kind === 'win' ? o.winner : null,
    bucket: classify(o),
    plies: engine.historyLength,
    elapsedMs,
  };
}

function describe(r: GameResult): string {
  if (r.bucket === 'ply-cap') return 'PLY-CAP (suspicious)';
  if (r.winner === null) return 'draw (repetition)';
  const role = r.winner === 'goat' ? 'goats' : 'tigers';
  const diff = r.winner === 'goat' ? r.goat : r.tiger;
  return `${role} win ${r.bucket.slice(4)} [${diff}]`;
}

const pairKey = (a: Difficulty, b: Difficulty): string => [a, b].sort().join('|');

function wilson(wins: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const p = wins / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

interface RoleStats {
  total: number;
  dec: number;
  tw: number;
  gw: number;
  dr: number;
  pc: number;
}

function roleStats(games: GameResult[]): RoleStats {
  const dec = games.filter((g) => g.bucket.startsWith('win-'));
  return {
    total: games.length,
    dec: dec.length,
    tw: dec.filter((g) => g.winner === 'tiger').length,
    gw: dec.filter((g) => g.winner === 'goat').length,
    dr: games.filter((g) => g.bucket === 'draw-repetition').length,
    pc: games.filter((g) => g.bucket === 'ply-cap').length,
  };
}

const pct = (x: number, n: number): string => (n === 0 ? 'n/a' : `${((x / n) * 100).toFixed(1)}%`);

test('AI self-play match across difficulties', async () => {
  const presetTag = process.env.MATCH_PRESET ?? 'classic';
  console.log(`AI MATCH preset="${presetTag}" seeds=[${SEEDS.join(', ')}] (reproduce with MATCH_SEEDS=${SEEDS.join(',')})`);
  console.log('note: Easy/Medium are deterministic per seed; Hard is wall-clock bounded (1500ms/move), so games involving Hard may differ across runs');
  console.log('per seed: easy vs medium x2, easy vs hard x2, medium vs hard x2, hard vs hard x1, medium vs medium x1');

  const think = new Map<Difficulty, number[]>();
  for (const d of DIFFS) think.set(d, []);
  const all: GameResult[] = [];
  const byPair = new Map<string, GameResult[]>();
  const multi = SEEDS.length > 1;

  const t0 = nowMs();
  for (const seed of SEEDS) {
    Math.random = mulberry32(seed);
    if (multi) console.log(`\n=== seed ${seed} ===`);
    for (const [a, b] of PAIRS) {
      const pairing = `${a} vs ${b}`;
      const n = a === b ? 1 : 2;
      const note = a === b ? 'same-diff baseline, 1 game (role swap would replay identically)' : `${n} games, sides swapped`;
      console.log(`\n-- ${pairing} (${note}) --`);
      const key = pairKey(a, b);
      for (let g = 1; g <= n; g++) {
        const goat = g % 2 === 1 ? a : b;
        const tiger = g % 2 === 1 ? b : a;
        const r = await playGame(pairing, g, seed, goat, tiger, think);
        all.push(r);
        byPair.set(key, [...(byPair.get(key) ?? []), r]);
        const seedTag = multi ? ` [seed ${seed}]` : '';
        console.log(`  G${g} goat=${goat} tiger=${tiger} -> ${describe(r)}  plies=${r.plies}  ${(r.elapsedMs / 1000).toFixed(1)}s${seedTag}`);
      }
    }
  }

  const advisory: string[] = [];
  const scoreOf = (games: GameResult[], d: Difficulty): number => {
    let s = 0;
    for (const g of games) {
      if (g.bucket === 'ply-cap' || g.winner === null) s += 0.5;
      else if ((g.winner === 'goat' ? g.goat : g.tiger) === d) s += 1;
    }
    return s;
  };
  const check = (stronger: Difficulty, weaker: Difficulty): void => {
    const games = byPair.get(pairKey(stronger, weaker)) ?? [];
    const sS = scoreOf(games, stronger);
    const sW = scoreOf(games, weaker);
    const line = `${stronger} vs ${weaker}: score ${sS} - ${sW}`;
    if (sS > sW) advisory.push(`PASS       ${line} (${stronger} outscores)`);
    else if (sS === sW) advisory.push(`WARN close ${line}`);
    else advisory.push(`WARN UPSET ${line} (${weaker} outscores ${stronger}!)`);
  };
  check('medium', 'easy');
  check('hard', 'easy');
  check('hard', 'medium');

  const baseline = byPair.get(pairKey('medium', 'medium')) ?? [];
  const caps = baseline.filter((g) => g.bucket === 'ply-cap').length;
  advisory.push(
    caps === 0
      ? 'PASS       medium vs medium baseline: terminated normally (0 ply-caps)'
      : `WARN       medium vs medium baseline: ${caps} ply-cap hit - looping that repetition should have caught`,
  );

  const hh = byPair.get(pairKey('hard', 'hard')) ?? [];
  const hhStats = roleStats(hh);
  advisory.push(
    `INFO       hard vs hard (descriptive, role outcomes): goat wins ${hhStats.gw}, tiger wins ${hhStats.tw}, draws ${hhStats.dr}`,
  );

  const overall = roleStats(all);
  const withHard = roleStats(all.filter((g) => g.pairing.includes('hard')));
  const noHard = roleStats(all.filter((g) => !g.pairing.includes('hard')));
  const [lo, hi] = wilson(overall.tw, overall.dec);

  console.log(`\n=== aggregate: ${SEEDS.length} seed(s), ${all.length} games ===`);
  console.log(
    `win reasons: captures ${overall.dec ? all.filter((g) => g.bucket === 'win-captures').length : 0} (tiger) | ` +
      `goats-locked ${all.filter((g) => g.bucket === 'win-locked').length} (tiger) | ` +
      `tiger-blocked ${all.filter((g) => g.bucket === 'win-blocked').length} (goat) | ` +
      `sudden-death ${all.filter((g) => g.bucket === 'win-sudden').length} | ` +
      `draw-repetition ${overall.dr} | ply-cap ${overall.pc}`,
  );
  console.log(
    `decisive ${overall.dec} | tiger share ${pct(overall.tw, overall.dec)} | Wilson 95% CI [${(lo * 100).toFixed(1)}%, ${(hi * 100).toFixed(1)}%]`,
  );
  console.log(`  with hard:    ${withHard.dec} decisive, tiger share ${pct(withHard.tw, withHard.dec)}`);
  console.log(`  without hard: ${noHard.dec} decisive, tiger share ${pct(noHard.tw, noHard.dec)}`);
  console.log('by pairing (role wins):');
  for (const [a, b] of PAIRS) {
    const s = roleStats(byPair.get(pairKey(a, b)) ?? []);
    const pad = `${a} vs ${b}`.padEnd(18);
    console.log(`  ${pad} ${String(s.total).padStart(3)} games: tiger ${s.tw} / goat ${s.gw} / draw ${s.dr}${s.pc ? ` / ply-cap ${s.pc}` : ''}`);
  }

  console.log('\nthink time: ' + DIFFS.map((d) => {
    const arr = think.get(d)!;
    if (arr.length === 0) return `${d}: no moves`;
    const avg = arr.reduce((s, x) => s + x, 0) / arr.length;
    return `${d} avg ${avg.toFixed(1)}ms max ${Math.max(...arr).toFixed(0)}ms (${arr.length} moves)`;
  }).join(' | '));

  const order: Bucket[] = ['win-captures', 'win-blocked', 'win-locked', 'win-sudden', 'draw-repetition', 'ply-cap'];
  const counts = new Map<Bucket, number>();
  for (const g of all) counts.set(g.bucket, (counts.get(g.bucket) ?? 0) + 1);
  console.log('outcomes: ' + order.map((b) => `${b} ${counts.get(b) ?? 0}`).join(' | '));

  console.log('\nadvisory:');
  for (const a of advisory) console.log(`  ${a}`);

  const share = overall.dec === 0 ? 0 : overall.tw / overall.dec;
  let verdict: string;
  if (overall.dec === 0) {
    verdict = 'INCONCLUSIVE (no decisive games)';
  } else if (share >= 0.6 && lo > 0.5) {
    verdict = `TUNE - tiger share ${pct(overall.tw, overall.dec)} >= 60% and Wilson lower bound ${(lo * 100).toFixed(1)}% > 50%`;
  } else if (lo <= 0.5 && hi >= 0.5) {
    verdict = `INCONCLUSIVE - tiger share ${pct(overall.tw, overall.dec)} (CI ${(lo * 100).toFixed(1)}-${(hi * 100).toFixed(1)}%) straddles 50%; rerun with MATCH_RUNS=20 to narrow, or ship with a wide-CI note`;
  } else if (hi < 0.5) {
    verdict = `ACCEPT - tiger share ${pct(overall.tw, overall.dec)} (CI entirely below 50%, goat-favoring); no tiger-bias action`;
  } else {
    verdict = `ACCEPT - tiger share ${pct(overall.tw, overall.dec)} (CI ${(lo * 100).toFixed(1)}-${(hi * 100).toFixed(1)}%) below the 60% action threshold`;
  }
  console.log(`\nVERDICT: ${verdict}`);
  console.log(`MATCH OK: ${all.length} games, ${SEEDS.length} seed(s), elapsed ${((nowMs() - t0) / 1000).toFixed(0)}s`);
});
