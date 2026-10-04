import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  GameEvent,
  StatsStore,
  emptyStore,
  parseStore,
  recordGame,
  serializeStore,
} from '../src/game/stats';

function ev(over: Partial<GameEvent> = {}): GameEvent {
  return {
    mode: 'ai',
    difficulty: 'medium',
    playerSide: 'goat',
    winner: 'goat',
    reason: 'tiger-blocked',
    plies: 60,
    captures: 2,
    ...over,
  };
}

function play(store: StatsStore, over: Partial<GameEvent> = {}): { store: StatsStore; unlocked: string[] } {
  return recordGame(store, ev(over));
}

describe('recordGame', () => {
  it('starts from an empty store', () => {
    const s = emptyStore();
    expect(s.v).toBe(1);
    expect(s.stats.games).toBe(0);
    expect(s.stats.bestWinPlies).toBeNull();
    expect(s.ach).toEqual({});
  });

  it('counts a human win as the played side only', () => {
    let r = play(emptyStore(), { winner: 'goat', playerSide: 'goat' });
    expect(r.store.stats.winsGoat).toBe(1);
    expect(r.store.stats.winsTiger).toBe(0);
    expect(r.store.stats.aiGames).toBe(1);
    // human on goat loses (AI tiger wins) -> no player win, but the game happened
    r = play(r.store, { winner: 'tiger', playerSide: 'goat', reason: 'captures' });
    expect(r.store.stats.winsTiger).toBe(0);
    expect(r.store.stats.games).toBe(2);
    expect(r.store.stats.winCaptures).toBe(0); // player did not win it
  });

  it('counts draws and local games', () => {
    let r = play(emptyStore(), { winner: null, reason: 'repetition' });
    expect(r.store.stats.draws).toBe(1);
    r = play(r.store, { mode: 'local', difficulty: null, playerSide: null, winner: 'tiger', reason: 'captures' });
    expect(r.store.stats.localGames).toBe(1);
    expect(r.store.stats.winsTiger).toBe(1); // local: either side is a human
    expect(r.store.stats.winsLocal).toBe(1);
    expect(r.store.stats.winCaptures).toBe(1);
  });

  it('tracks win methods, captures total and fastest win', () => {
    let r = play(emptyStore(), { plies: 80, reason: 'tiger-blocked' });
    expect(r.store.stats.winBlocked).toBe(1);
    expect(r.store.stats.bestWinPlies).toBe(80);
    r = play(r.store, { plies: 55, reason: 'goats-locked', winner: 'tiger', playerSide: 'tiger' });
    expect(r.store.stats.winLocked).toBe(1);
    expect(r.store.stats.bestWinPlies).toBe(55);
    r = play(r.store, { plies: 90, reason: 'sudden-death', winner: 'tiger', playerSide: 'tiger' });
    expect(r.store.stats.winSudden).toBe(1);
    expect(r.store.stats.bestWinPlies).toBe(55); // min, not last
    expect(r.store.stats.goatsCaptured).toBe(6);
  });

  it('credits beating the hard AI on either side', () => {
    let r = play(emptyStore(), { difficulty: 'hard', winner: 'tiger', playerSide: 'tiger', reason: 'captures' });
    expect(r.store.stats.vsHardWins).toBe(1);
    r = play(r.store, { difficulty: 'hard', winner: 'goat', playerSide: 'goat' });
    expect(r.store.stats.vsHardWins).toBe(2);
    r = play(r.store, { difficulty: 'hard', winner: 'tiger', playerSide: 'goat' });
    expect(r.store.stats.vsHardWins).toBe(2); // lost as goat
  });

  it('counts flawless goat wins (zero captures conceded)', () => {
    let r = play(emptyStore(), { winner: 'goat', playerSide: 'goat', captures: 0 });
    expect(r.store.stats.cleanGoatWins).toBe(1);
    r = play(r.store, { winner: 'goat', playerSide: 'goat', captures: 3 });
    expect(r.store.stats.cleanGoatWins).toBe(1);
    // tiger win with 0 captures is not a goat win
    r = play(r.store, { winner: 'tiger', playerSide: 'tiger', captures: 0, reason: 'goats-locked' });
    expect(r.store.stats.cleanGoatWins).toBe(1);
  });
});

describe('achievements', () => {
  it('unlocks matching achievements exactly once', () => {
    const first = play(emptyStore());
    expect(first.unlocked).toContain('firstWin');
    expect(first.unlocked).toContain('winGoat');
    expect(first.unlocked).toContain('blockWin');
    const again = play(first.store, { winner: null, reason: 'repetition' });
    expect(again.unlocked).toEqual([]);
    expect(Object.keys(again.store.ach).sort()).toEqual(first.unlocked.slice().sort());
  });

  it('unlocks side-specific achievements from their own wins', () => {
    const r = play(emptyStore(), { winner: 'tiger', playerSide: 'tiger', reason: 'captures' });
    expect(r.unlocked).toContain('winTiger');
    expect(r.unlocked).toContain('capWin');
    expect(r.unlocked).toContain('firstWin');
    expect(r.unlocked).not.toContain('winGoat');
  });

  it('thresholds at 10 wins', () => {
    let r = { store: emptyStore(), unlocked: [] as string[] };
    for (let i = 0; i < 9; i++) {
      r = play(r.store);
      expect(r.unlocked).not.toContain('wins10');
    }
    r = play(r.store);
    expect(r.unlocked).toContain('wins10');
  });

  it('exposes 13 achievements with unique ids', () => {
    expect(ACHIEVEMENTS).toHaveLength(13);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(13);
  });
});

describe('online mode', () => {
  it('counts online games and credits your seat’s win', () => {
    let r = play(emptyStore(), { mode: 'online', difficulty: null, playerSide: 'tiger', winner: 'tiger', reason: 'captures' });
    expect(r.store.stats.onlineGames).toBe(1);
    expect(r.store.stats.winsOnline).toBe(1);
    expect(r.store.stats.aiGames).toBe(0);
    expect(r.store.stats.winsTiger).toBe(1);
    expect(r.store.stats.vsHardWins).toBe(0); // difficulty is null online
    expect(r.unlocked).toContain('onlineWin');
    // loss as goat: counted as a game, not a win
    r = play(r.store, { mode: 'online', difficulty: null, playerSide: 'goat', winner: 'tiger', reason: 'captures' });
    expect(r.store.stats.onlineGames).toBe(2);
    expect(r.store.stats.winsOnline).toBe(1);
    expect(r.unlocked).toEqual([]); // achievements only unlock once
  });

  it('counts online draws', () => {
    const r = play(emptyStore(), { mode: 'online', difficulty: null, playerSide: 'goat', winner: null, reason: 'repetition' });
    expect(r.store.stats.onlineGames).toBe(1);
    expect(r.store.stats.draws).toBe(1);
    expect(r.store.stats.winsOnline).toBe(0);
  });

  it('keeps online wins out of the local-win achievement', () => {
    const r = play(emptyStore(), { mode: 'online', difficulty: null, playerSide: 'goat', winner: 'goat' });
    expect(r.unlocked).not.toContain('localWin');
    expect(r.unlocked).toContain('onlineWin');
  });
});

describe('persistence', () => {
  it('round-trips through serialize/parse', () => {
    let r = play(emptyStore());
    r = play(r.store, { winner: 'tiger', playerSide: 'tiger', reason: 'captures', plies: 44 });
    const parsed = parseStore(serializeStore(r.store));
    expect(parsed).toEqual(r.store);
  });

  it('falls back to empty on garbage or wrong version', () => {
    expect(parseStore(null).stats.games).toBe(0);
    expect(parseStore('not json').stats.games).toBe(0);
    expect(parseStore('{}').stats.games).toBe(0);
    expect(parseStore('{"v":2,"stats":{},"ach":{}}').stats.games).toBe(0);
  });

  it('drops out-of-range fields but keeps valid ones', () => {
    const raw = JSON.stringify({
      v: 1,
      stats: { games: 3, winsGoat: -5, winsTiger: 2, bestWinPlies: 'x', draws: 1 },
      ach: { firstWin: 123, bogus: 9 },
    });
    const s = parseStore(raw);
    expect(s.stats.games).toBe(3);
    expect(s.stats.winsGoat).toBe(0); // negative rejected
    expect(s.stats.winsTiger).toBe(2);
    expect(s.stats.bestWinPlies).toBeNull(); // non-number -> null
    expect(s.ach).toEqual({ firstWin: 123 }); // unknown achievement dropped
  });
});
