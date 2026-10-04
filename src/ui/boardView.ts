import { NODE_COUNT, MovementMode, colOf, connected, rowOf } from '../game/board';
import { GameState, Move } from '../game/rules';
import tigerArt from '../assets/tiger.svg';
import goatArt from '../assets/goat.svg';

const PAD = 50;
const STEP = 100;

const artFor = (p: 'T' | 'G'): string => (p === 'T' ? tigerArt : goatArt);
const artMarkup = (p: 'T' | 'G'): string =>
  `<image class="piece-art" href="${artFor(p)}" x="-22" y="-22" width="44" height="44"/>`;

const nodeX = (n: number): number => PAD + colOf(n) * STEP;
const nodeY = (n: number): number => PAD + rowOf(n) * STEP;

export interface Target {
  to: number;
  capture: boolean;
  over?: number;
}

export interface BoardOptions {
  selected: number | null;
  targets: Target[];
  placing: boolean;
  last: Move | null;
  fx: Move | null;
  /** Line drawing: only draw diagonal lines when the movement rules allow them. */
  movement?: MovementMode;
  /** Tutorial: pulsing guide ring on this node. */
  hint?: number;
  /** Tutorial: shake the guiding ring (hint if present, else the selection ring). */
  shake?: boolean;
  /** Tutorial: guide arrow from one node to another (drawn above the pieces). */
  arrow?: { from: number; to: number };
}

function pieceMarkup(n: number, p: 'T' | 'G', fx: string, style: string): string {
  return (
    `<g class="piece" transform="translate(${nodeX(n)} ${nodeY(n)})">` +
    `<g class="${fx}"${style}>` +
    `<circle class="${p === 'T' ? 'piece-tiger' : 'piece-goat'}" r="30"/>` +
    artMarkup(p) +
    '</g></g>'
  );
}

export function renderBoard(s: GameState, opts: BoardOptions): string {
  const parts: string[] = [];
  parts.push('<svg class="board" viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg">');
  parts.push('<rect class="board-bg" x="0" y="0" width="500" height="500" rx="20"/>');

  for (let a = 0; a < NODE_COUNT; a++) {
    for (let b = a + 1; b < NODE_COUNT; b++) {
      if (!connected(a, b)) continue;
      if (
        opts.movement === 'orthogonal-only' &&
        rowOf(a) !== rowOf(b) &&
        colOf(a) !== colOf(b)
      ) {
        continue;
      }
      parts.push(
        `<line class="board-line" x1="${nodeX(a)}" y1="${nodeY(a)}" x2="${nodeX(b)}" y2="${nodeY(b)}"/>`,
      );
    }
  }

  for (let n = 0; n < NODE_COUNT; n++) {
    parts.push(`<circle class="node" cx="${nodeX(n)}" cy="${nodeY(n)}" r="7"/>`);
  }

  if (opts.placing) {
    for (let n = 0; n < NODE_COUNT; n++) {
      if (s.board[n] !== null) continue;
      parts.push(`<circle class="place-dot" cx="${nodeX(n)}" cy="${nodeY(n)}" r="16"/>`);
    }
  }

  if (opts.last) {
    const seen = new Set<number>();
    for (const n of [opts.last.kind === 'place' ? undefined : opts.last.from, opts.last.to]) {
      if (n === undefined || seen.has(n)) continue;
      seen.add(n);
      parts.push(`<circle class="last-dot" cx="${nodeX(n)}" cy="${nodeY(n)}" r="26"/>`);
    }
  }

  for (const target of opts.targets) {
    if (target.capture && target.over !== undefined) {
      parts.push(
        `<circle class="prey" cx="${nodeX(target.over)}" cy="${nodeY(target.over)}" r="36"/>`,
      );
    }
    parts.push(
      `<circle class="${target.capture ? 'target target-capture' : 'target'}" cx="${nodeX(target.to)}" cy="${nodeY(target.to)}" r="18"/>`,
    );
  }

  if (opts.selected !== null) {
    const shakeCls = opts.shake && opts.hint === undefined ? ' shake' : '';
    parts.push(
      `<circle class="selected${shakeCls}" cx="${nodeX(opts.selected)}" cy="${nodeY(opts.selected)}" r="40"/>`,
    );
  }

  if (opts.hint !== undefined) {
    const shakeCls = opts.shake ? ' shake' : '';
    parts.push(
      `<circle class="hint-ring${shakeCls}" cx="${nodeX(opts.hint)}" cy="${nodeY(opts.hint)}" r="40"/>`,
    );
  }

  const fx = opts.fx;
  for (let n = 0; n < NODE_COUNT; n++) {
    const p = s.board[n];
    if (p === null) continue;
    let cls = '';
    let style = '';
    if (fx && fx.kind === 'place' && fx.to === n) {
      cls = 'fx-place';
    } else if (fx && (fx.kind === 'step' || fx.kind === 'jump') && fx.to === n) {
      cls = 'fx-move';
      const dx = nodeX(fx.from) - nodeX(n);
      const dy = nodeY(fx.from) - nodeY(n);
      style = ` style="--dx:${dx}px;--dy:${dy}px"`;
    }
    parts.push(pieceMarkup(n, p, cls, style));
  }

  if (fx && fx.kind === 'jump') {
    parts.push(
      `<g class="piece" transform="translate(${nodeX(fx.over)} ${nodeY(fx.over)})">` +
        '<g class="ghost-fx">' +
        '<circle class="piece-goat" r="30"/>' +
        artMarkup('G') +
        '</g></g>',
    );
  }

  if (opts.arrow) {
    const { from, to } = opts.arrow;
    parts.push(
      `<line class="tut-arrow" x1="${nodeX(from)}" y1="${nodeY(from)}" x2="${nodeX(to)}" y2="${nodeY(to)}"/>`,
    );
  }

  for (let n = 0; n < NODE_COUNT; n++) {
    parts.push(
      `<circle class="hit" data-act="node" data-node="${n}" cx="${nodeX(n)}" cy="${nodeY(n)}" r="44"/>`,
    );
  }

  parts.push('</svg>');
  return parts.join('');
}
