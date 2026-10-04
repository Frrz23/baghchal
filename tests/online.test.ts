import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/game/engine';
import { Move } from '../src/game/rules';
import { CODE_ALPHABET, generateCode, parseClient, validCode } from '../src/online/protocol';
import { RoomCore } from '../src/online/roomCore';

function drain(core: RoomCore) {
  return core.takeQueue().map((e) => ({ target: e.target, msg: e.msg }));
}

function joinedPair(): { core: RoomCore; goatTok: string; tigerTok: string } {
  const core = new RoomCore('TEST');
  const g = core.join('create');
  expect(g.err).toBeNull();
  const t = core.join('join');
  expect(t.err).toBeNull();
  core.takeQueue();
  return { core, goatTok: g.token!, tigerTok: t.token! };
}

describe('room codes', () => {
  it('generates 4-char codes from the unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const c = generateCode();
      expect(c).toHaveLength(4);
      expect(validCode(c)).toBe(true);
      expect([...c].every((ch) => CODE_ALPHABET.includes(ch))).toBe(true);
    }
  });

  it('rejects malformed codes', () => {
    expect(validCode('ABCD')).toBe(true);
    expect(validCode('ABC')).toBe(false);
    expect(validCode('ABCDE')).toBe(false);
    expect(validCode('AB0I')).toBe(false); // excluded chars
  });
});

describe('parseClient', () => {
  it('accepts well-formed moves and leave', () => {
    expect(parseClient(JSON.stringify({ t: 'leave' }))).toEqual({ t: 'leave' });
    expect(parseClient(JSON.stringify({ t: 'move', move: { kind: 'place', to: 7 } }))).toEqual({
      t: 'move',
      move: { kind: 'place', to: 7 },
    });
    expect(parseClient(JSON.stringify({ t: 'move', move: { kind: 'step', from: 0, to: 1 } }))).toEqual({
      t: 'move',
      move: { kind: 'step', from: 0, to: 1 },
    });
    expect(
      parseClient(JSON.stringify({ t: 'move', move: { kind: 'jump', from: 0, over: 5, to: 10 } })),
    ).toEqual({ t: 'move', move: { kind: 'jump', from: 0, over: 5, to: 10 } });
  });

  it('rejects garbage', () => {
    expect(parseClient('not json')).toBeNull();
    expect(parseClient(JSON.stringify({ t: 'move' }))).toBeNull();
    expect(parseClient(JSON.stringify({ t: 'move', move: { kind: 'place', to: 'x' } }))).toBeNull();
    expect(parseClient(JSON.stringify({ t: 'move', move: { kind: 'jump', from: 0, to: 10 } }))).toBeNull();
    expect(parseClient(JSON.stringify({ t: 'nope' }))).toBeNull();
    expect(parseClient(42)).toBeNull();
  });
});

describe('RoomCore: seats', () => {
  it('create assigns goat and queues welcome + state to self', () => {
    const core = new RoomCore('AAAA');
    const r = core.join('create');
    expect(r.err).toBeNull();
    expect(r.seat).toBe('goat');
    const q = drain(core);
    expect(q).toHaveLength(2);
    expect(q[0]).toEqual({ target: 'self', msg: { t: 'welcome', code: 'AAAA', seat: 'goat', token: r.token } });
    expect(q[1].msg.t).toBe('state');
    expect(core.isEmpty).toBe(false);
  });

  it('second create on an occupied code is ROOM_TAKEN', () => {
    const core = new RoomCore('AAAA');
    core.join('create');
    expect(core.join('create').err).toBe('ROOM_TAKEN');
  });

  it('join assigns tiger and notifies both seats', () => {
    const core = new RoomCore('AAAA');
    core.join('create');
    const t = core.join('join');
    expect(t.err).toBeNull();
    expect(t.seat).toBe('tiger');
    const q = drain(core);
    const targets = q.map((e) => `${e.target}:${e.msg.t}`);
    expect(targets).toContain('self:welcome');
    expect(targets).toContain('self:state');
    expect(targets).toContain('self:opponent');
    expect(targets).toContain('opp:opponent');
  });

  it('third player gets ROOM_FULL; join on empty code gets BAD_CODE', () => {
    const empty = new RoomCore('AAAA');
    expect(empty.join('join').err).toBe('BAD_CODE');
    const full = new RoomCore('AAAA');
    full.join('create');
    full.join('join');
    expect(full.join('join').err).toBe('ROOM_FULL');
  });

  it('token reclaim restores the seat after disconnect', () => {
    const { core, tigerTok } = joinedPair();
    core.disconnect('tiger');
    expect(drain(core).some((e) => e.msg.t === 'opponent' && e.msg.connected === false)).toBe(true);
    const r = core.join('join', tigerTok);
    expect(r.err).toBeNull();
    expect(r.seat).toBe('tiger');
    expect(core.isEmpty).toBe(false);
    expect(core.join('join', 'wrong-token').err).toBe('BAD_CODE');
  });
});

describe('RoomCore: moves', () => {
  it('rejects moves before the opponent joins', () => {
    const core = new RoomCore('AAAA');
    core.join('create');
    expect(core.move('goat', { kind: 'place', to: 7 })).toBe('NOT_YOUR_TURN');
  });

  it('rejects wrong-turn and illegal moves, accepts legal ones', () => {
    const { core } = joinedPair();
    expect(core.move('tiger', { kind: 'place', to: 7 })).toBe('NOT_YOUR_TURN');
    expect(core.move('goat', { kind: 'step', from: 0, to: 1 })).toBe('BAD_MOVE');
    expect(core.move('goat', { kind: 'place', to: 7 })).toBeNull();
    const q = drain(core);
    expect(q).toHaveLength(1);
    expect(q[0].target).toBe('all');
    const st = q[0].msg;
    expect(st.t).toBe('state');
    if (st.t === 'state') {
      expect(st.moves).toHaveLength(1);
      expect(st.toMove).toBe('tiger');
      expect(st.outcome).toBeNull();
    }
  });

  it('rejects moves after the game is over', () => {
    const { core } = joinedPair();
    const mirror = new GameEngine();
    // deterministic first-legal play until an outcome appears (draw by
    // repetition or a win); core and mirror stay in lockstep
    let guard = 0;
    while (!core.outcome && guard++ < 2000) {
      const legal = mirror.legalMoves();
      expect(legal.length).toBeGreaterThan(0);
      const m: Move = legal[0];
      const seat = mirror.current.toMove;
      expect(core.move(seat, m)).toBeNull();
      mirror.play(m);
    }
    expect(core.outcome).not.toBeNull();
    const last = mirror.legalMoves()[0];
    if (last) expect(core.move(mirror.current.toMove, last)).toBe('GAME_OVER');
    expect(core.moves).toEqual(mirror.moves);
  });

  it('a 5-capture-style jump sequence is validated by shared rules', () => {
    const { core } = joinedPair();
    expect(core.move('goat', { kind: 'place', to: 5 })).toBeNull();
    expect(core.move('tiger', { kind: 'jump', from: 0, over: 5, to: 10 })).toBeNull();
    const q = drain(core);
    const st = q[q.length - 1].msg;
    expect(st.t).toBe('state');
    if (st.t === 'state') expect(st.moves).toHaveLength(2);
  });
});

describe('RoomCore: snapshot', () => {
  it('restores seats, tokens and move history exactly', () => {
    const { core, goatTok, tigerTok } = joinedPair();
    expect(core.move('goat', { kind: 'place', to: 7 })).toBeNull();
    const snap = core.snapshot();
    expect(snap.goat?.token).toBe(goatTok);
    expect(snap.tiger?.token).toBe(tigerTok);

    const restored = new RoomCore('TEST', snap);
    expect(restored.moves).toEqual(core.moves);
    expect(restored.toMove).toBe(core.toMove);
    expect(restored.isEmpty).toBe(false);
    expect(restored.join('join', tigerTok).seat).toBe('tiger'); // reclaim works after restore
    expect(restored.join('join').err).toBe('ROOM_FULL'); // seats persisted
    expect(restored.move('tiger', { kind: 'step', from: 0, to: 1 })).toBeNull(); // game continues
    const mirror = new GameEngine();
    for (const m of core.moves) mirror.play(m);
    expect(restored.moves[restored.moves.length - 1]).toEqual({ kind: 'step', from: 0, to: 1 });
    expect(mirror.current.board[7]).toBe('G');
  });

  it('isEmpty reflects both sockets closed', () => {
    const { core } = joinedPair();
    core.disconnect('goat');
    expect(core.isEmpty).toBe(false);
    core.disconnect('tiger');
    expect(core.isEmpty).toBe(true);
  });
});
