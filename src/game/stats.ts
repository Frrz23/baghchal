import type { Side, WinReason } from './rules';

const STORE_KEY = 'statsStore';

export type StatsDifficulty = 'easy' | 'medium' | 'hard';

export interface StatsData {
  games: number;
  winsGoat: number;
  winsTiger: number;
  draws: number;
  aiGames: number;
  localGames: number;
  winsLocal: number;
  onlineGames: number;
  winsOnline: number;
  vsHardWins: number;
  winCaptures: number;
  winBlocked: number;
  winLocked: number;
  winSudden: number;
  goatsCaptured: number;
  cleanGoatWins: number;
  bestWinPlies: number | null;
}

export interface GameEvent {
  mode: 'ai' | 'local' | 'online';
  difficulty: StatsDifficulty | null;
  /** Human's side in vs-AI games; null for local two-player. */
  playerSide: Side | null;
  winner: Side | null;
  reason: WinReason;
  plies: number;
  captures: number;
}

export interface StatsStore {
  v: 1;
  stats: StatsData;
  /** achievement id -> unlocked-at epoch ms */
  ach: Record<string, number>;
}

export interface AchDef {
  id: string;
  emoji: string;
  nameKey: string;
  descKey: string;
  when: (s: StatsData) => boolean;
}

const wins = (s: StatsData): number => s.winsGoat + s.winsTiger;

export const ACHIEVEMENTS: AchDef[] = [
  { id: 'firstWin', emoji: '🏆', nameKey: 'achFirstWin', descKey: 'achFirstWinD', when: (s) => wins(s) >= 1 },
  { id: 'winGoat', emoji: '🐐', nameKey: 'achWinGoat', descKey: 'achWinGoatD', when: (s) => s.winsGoat >= 1 },
  { id: 'winTiger', emoji: '🐅', nameKey: 'achWinTiger', descKey: 'achWinTigerD', when: (s) => s.winsTiger >= 1 },
  { id: 'wins10', emoji: '🔟', nameKey: 'achWins10', descKey: 'achWins10D', when: (s) => wins(s) >= 10 },
  { id: 'wins50', emoji: '🎉', nameKey: 'achWins50', descKey: 'achWins50D', when: (s) => wins(s) >= 50 },
  { id: 'vsHard', emoji: '💪', nameKey: 'achVsHard', descKey: 'achVsHardD', when: (s) => s.vsHardWins >= 1 },
  { id: 'capWin', emoji: '🍖', nameKey: 'achCapWin', descKey: 'achCapWinD', when: (s) => s.winCaptures >= 1 },
  { id: 'blockWin', emoji: '🧱', nameKey: 'achBlockWin', descKey: 'achBlockWinD', when: (s) => s.winBlocked >= 1 },
  { id: 'lockWin', emoji: '🔒', nameKey: 'achLockWin', descKey: 'achLockWinD', when: (s) => s.winLocked >= 1 },
  { id: 'suddenWin', emoji: '⚡', nameKey: 'achSuddenWin', descKey: 'achSuddenWinD', when: (s) => s.winSudden >= 1 },
  { id: 'perfect', emoji: '🌟', nameKey: 'achPerfect', descKey: 'achPerfectD', when: (s) => s.cleanGoatWins >= 1 },
  { id: 'localWin', emoji: '🤝', nameKey: 'achLocalWin', descKey: 'achLocalWinD', when: (s) => s.winsLocal >= 1 },
  { id: 'onlineWin', emoji: '🌐', nameKey: 'achOnlineWin', descKey: 'achOnlineWinD', when: (s) => s.winsOnline >= 1 },
];

export function emptyStats(): StatsData {
  return {
    games: 0,
    winsGoat: 0,
    winsTiger: 0,
    draws: 0,
    aiGames: 0,
    localGames: 0,
    winsLocal: 0,
    onlineGames: 0,
    winsOnline: 0,
    vsHardWins: 0,
    winCaptures: 0,
    winBlocked: 0,
    winLocked: 0,
    winSudden: 0,
    goatsCaptured: 0,
    cleanGoatWins: 0,
    bestWinPlies: null,
  };
}

export function emptyStore(): StatsStore {
  return { v: 1, stats: emptyStats(), ach: {} };
}

/** Applies one finished-game event; returns the new store plus ids newly unlocked. */
export function recordGame(store: StatsStore, ev: GameEvent): { store: StatsStore; unlocked: string[] } {
  const s: StatsData = { ...store.stats, bestWinPlies: store.stats.bestWinPlies };
  const isLocal = ev.mode === 'local';
  const isOnline = ev.mode === 'online';
  const playerWon = ev.winner !== null && (isLocal || ev.winner === ev.playerSide);
  const wonAsGoat = playerWon && (isLocal ? ev.winner === 'goat' : ev.playerSide === 'goat');
  const wonAsTiger = playerWon && (isLocal ? ev.winner === 'tiger' : ev.playerSide === 'tiger');

  s.games++;
  if (isLocal) s.localGames++;
  else if (isOnline) s.onlineGames++;
  else s.aiGames++;
  if (ev.captures > 0) s.goatsCaptured += ev.captures;
  if (wonAsGoat) {
    s.winsGoat++;
    if (ev.captures === 0) s.cleanGoatWins++;
  } else if (wonAsTiger) {
    s.winsTiger++;
  }
  if (playerWon && isLocal) s.winsLocal++;
  if (playerWon && isOnline) s.winsOnline++;
  if (playerWon && !isLocal && !isOnline && ev.difficulty === 'hard') s.vsHardWins++;
  if (ev.winner === null) s.draws++;

  if (playerWon) {
    if (ev.reason === 'captures') s.winCaptures++;
    else if (ev.reason === 'tiger-blocked') s.winBlocked++;
    else if (ev.reason === 'goats-locked') s.winLocked++;
    else if (ev.reason === 'sudden-death') s.winSudden++;
    if (s.bestWinPlies === null || ev.plies < s.bestWinPlies) s.bestWinPlies = ev.plies;
  }

  const ach: Record<string, number> = { ...store.ach };
  const unlocked: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!(a.id in ach) && a.when(s)) {
      ach[a.id] = Date.now();
      unlocked.push(a.id);
    }
  }
  return { store: { v: 1, stats: s, ach }, unlocked };
}

/** Parses persisted JSON; anything malformed falls back to a fresh store. */
export function parseStore(raw: string | null): StatsStore {
  if (!raw) return emptyStore();
  try {
    const o = JSON.parse(raw) as StatsStore;
    if (!o || o.v !== 1 || typeof o.stats !== 'object' || o.stats === null || typeof o.ach !== 'object' || !o.ach) {
      return emptyStore();
    }
    const base = emptyStats();
    const stats: StatsData = { ...base };
    const rawStats = o.stats as unknown as Record<string, unknown>;
    for (const k of Object.keys(base) as (keyof StatsData)[]) {
      const v = rawStats[k];
      if (k === 'bestWinPlies') stats.bestWinPlies = typeof v === 'number' ? v : null;
      else if (typeof v === 'number' && isFinite(v) && v >= 0) stats[k] = v;
    }
    const ach: Record<string, number> = {};
    const rawAch = o.ach as unknown as Record<string, unknown>;
    for (const a of ACHIEVEMENTS) {
      const t = rawAch[a.id];
      if (typeof t === 'number' && isFinite(t)) ach[a.id] = t;
    }
    return { v: 1, stats, ach };
  } catch {
    return emptyStore();
  }
}

export function serializeStore(s: StatsStore): string {
  return JSON.stringify(s);
}

export function loadStore(): StatsStore {
  try {
    return parseStore(localStorage.getItem(STORE_KEY));
  } catch {
    return emptyStore();
  }
}

export function saveStore(s: StatsStore): void {
  try {
    localStorage.setItem(STORE_KEY, serializeStore(s));
  } catch {
    /* storage unavailable: stats stay session-only */
  }
}
