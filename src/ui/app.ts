import { Difficulty } from '../game/ai';
import { playSound, setSoundEnabled, SoundName } from '../game/audio';
import { GameEngine } from '../game/engine';
import { Move, Outcome, Side, legalMoves } from '../game/rules';
import { colOf, rowOf } from '../game/board';
import { renderBoard, Target } from './boardView';
import { lang, num, setLang, t } from './i18n';

type Screen = 'menu' | 'side' | 'game';
type Mode = 'ai' | 'local';

interface AiResponse {
  id: number;
  move: Move;
}

const COLS = 'ABCDE';
const nodeName = (n: number): string => COLS[colOf(n)] + (rowOf(n) + 1);

function moveLabel(m: Move): string {
  if (m.kind === 'place') return nodeName(m.to);
  if (m.kind === 'step') return `${nodeName(m.from)}-${nodeName(m.to)}`;
  return `${nodeName(m.from)}×${nodeName(m.to)}`;
}

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const DIFF_KEYS: Record<Difficulty, string> = {
  easy: 'diffEasy',
  medium: 'diffMedium',
  hard: 'diffHard',
};

function loadBool(key: string, fallback: boolean): boolean {
  const v = localStorage.getItem(key);
  return v === null ? fallback : v === '1';
}

export class App {
  private root: HTMLElement;
  private engine = new GameEngine();
  private screen: Screen = 'menu';
  private mode: Mode = 'ai';
  private playerSide: Side = 'goat';
  private difficulty: Difficulty = (localStorage.getItem('difficulty') as Difficulty) || 'medium';
  private soundOn = loadBool('sound', true);
  private showLastMove = loadBool('lastMove', true);
  private selected: number | null = null;
  private thinking = false;
  private paused = false;
  private gameId = 0;
  private pendingFx: Move | null = null;
  private worker: Worker;

  constructor(root: HTMLElement) {
    this.root = root;
    if (!DIFFICULTIES.includes(this.difficulty)) this.difficulty = 'medium';
    setSoundEnabled(this.soundOn);
    this.worker = new Worker(new URL('../game/aiWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<AiResponse>) => this.onAiResponse(e.data);
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.render();
  }

  private sound(name: SoundName): void {
    if (this.soundOn) playSound(name);
  }

  private onClick(e: Event): void {
    const el = (e.target as Element).closest('[data-act]');
    if (!el) return;
    const act = el.getAttribute('data-act');
    if (act === 'node') {
      this.onNode(Number(el.getAttribute('data-node')));
      return;
    }
    switch (act) {
      case 'pick-ai':
        this.screen = 'side';
        this.sound('tap');
        this.render();
        break;
      case 'side': {
        const side = el.getAttribute('data-side') as Side;
        this.sound('tap');
        this.newGame('ai', side);
        break;
      }
      case 'local':
        this.sound('tap');
        this.newGame('local', 'goat');
        break;
      case 'menu':
        this.sound('tap');
        this.goMenu();
        break;
      case 'pause':
        if (this.screen === 'game' && !this.engine.outcome) {
          this.sound('tap');
          this.paused = true;
          this.render();
        }
        break;
      case 'resume':
        this.sound('tap');
        this.paused = false;
        this.render();
        this.maybeAi();
        break;
      case 'new':
        this.sound('tap');
        this.newGame(this.mode, this.playerSide);
        break;
      case 'undo':
        this.doUndo();
        break;
      case 'diff': {
        const d = el.getAttribute('data-diff') as Difficulty;
        if (DIFFICULTIES.includes(d)) {
          this.difficulty = d;
          localStorage.setItem('difficulty', d);
          this.sound('tap');
          this.render();
        }
        break;
      }
      case 'lang':
        setLang(lang() === 'ne' ? 'en' : 'ne');
        this.sound('tap');
        this.render();
        break;
      case 'sound':
        this.soundOn = !this.soundOn;
        setSoundEnabled(this.soundOn);
        localStorage.setItem('sound', this.soundOn ? '1' : '0');
        if (this.soundOn) this.sound('tap');
        this.render();
        break;
      case 'lastmove':
        this.showLastMove = !this.showLastMove;
        localStorage.setItem('lastMove', this.showLastMove ? '1' : '0');
        this.sound('tap');
        this.render();
        break;
    }
  }

  private goMenu(): void {
    this.gameId++;
    this.screen = 'menu';
    this.thinking = false;
    this.paused = false;
    this.selected = null;
    this.pendingFx = null;
    this.render();
  }

  private newGame(mode: Mode, side: Side): void {
    this.mode = mode;
    this.playerSide = side;
    this.engine = new GameEngine();
    this.selected = null;
    this.thinking = false;
    this.paused = false;
    this.pendingFx = null;
    this.gameId++;
    this.screen = 'game';
    this.render();
    this.maybeAi();
  }

  private doUndo(): void {
    if (this.thinking || this.engine.historyLength === 0) return;
    this.engine.undo();
    if (this.mode === 'ai') {
      while (this.engine.historyLength > 0 && this.engine.current.toMove !== this.playerSide) {
        this.engine.undo();
      }
    }
    this.selected = null;
    this.pendingFx = null;
    this.sound('tap');
    this.render();
  }

  private humanTurn(): boolean {
    return this.mode === 'local' || this.engine.current.toMove === this.playerSide;
  }

  private onNode(n: number): void {
    if (this.screen !== 'game' || this.paused || this.engine.outcome || this.thinking) return;
    if (!this.humanTurn()) return;
    const st = this.engine.current;
    const piece = st.board[n];
    const own = st.toMove === 'tiger' ? 'T' : 'G';

    if (st.toMove === 'goat' && st.goatsInHand > 0) {
      if (piece === null) this.play({ kind: 'place', to: n });
      return;
    }

    if (this.selected === null) {
      if (piece === own) {
        this.selected = n;
        this.sound('tap');
        this.render();
      }
      return;
    }

    const move = legalMoves(st).find(
      (m) => (m.kind === 'step' || m.kind === 'jump') && m.from === this.selected && m.to === n,
    );
    if (move) {
      this.play(move);
      return;
    }
    if (piece === own) {
      this.selected = n;
      this.sound('tap');
    } else {
      this.selected = null;
    }
    this.render();
  }

  private play(move: Move): void {
    this.engine.play(move);
    this.selected = null;
    this.pendingFx = move;
    this.soundForMove(move);
    this.soundIfOver();
    this.render();
    this.maybeAi();
  }

  private soundForMove(m: Move): void {
    if (m.kind === 'jump') this.sound('capture');
    else if (m.kind === 'place') this.sound('place');
    else this.sound('move');
  }

  private soundIfOver(): void {
    if (!this.engine.outcome) return;
    this.sound(this.engine.outcome.kind === 'draw' ? 'draw' : 'win');
  }

  private maybeAi(): void {
    if (this.mode !== 'ai' || this.engine.outcome || this.thinking) return;
    if (this.engine.current.toMove === this.playerSide) return;
    this.thinking = true;
    this.render();
    const id = this.gameId;
    window.setTimeout(() => {
      if (id !== this.gameId) return;
      if (this.paused) {
        this.thinking = false;
        this.render();
        return;
      }
      this.worker.postMessage({
        id,
        state: this.engine.current,
        difficulty: this.difficulty,
        pastCounts: this.engine.searchCounts(),
      });
    }, 350);
  }

  private onAiResponse(data: AiResponse): void {
    if (data.id !== this.gameId) return;
    this.thinking = false;
    if (!this.engine.outcome) {
      try {
        this.engine.play(data.move);
        this.soundForMove(data.move);
        this.pendingFx = data.move;
      } catch (err) {
        console.error('AI played an illegal move', err);
      }
    }
    this.selected = null;
    this.soundIfOver();
    this.render();
  }

  private targets(): Target[] {
    if (this.selected === null) return [];
    return legalMoves(this.engine.current)
      .filter((m) => (m.kind === 'step' || m.kind === 'jump') && m.from === this.selected)
      .map((m) =>
        m.kind === 'jump'
          ? { to: m.to, capture: true, over: m.over }
          : { to: m.to, capture: false },
      );
  }

  private lastMove(): Move | null {
    const moves = this.engine.moves;
    return moves.length > 0 ? moves[moves.length - 1] : null;
  }

  private hintText(): string {
    if (this.thinking) return t('thinking');
    const st = this.engine.current;
    if (st.toMove === 'goat' && st.goatsInHand > 0) return t('hintPlace');
    if (this.selected === null) return t('hintSelect');
    return t('hintMove');
  }

  private turnText(): string {
    if (this.thinking) return t('thinking');
    return this.engine.current.toMove === 'goat' ? t('turnGoat') : t('turnTiger');
  }

  private resultText(o: Outcome): string {
    if (o.kind === 'draw') return t('draw');
    if (this.mode === 'ai') return o.winner === this.playerSide ? t('youWin') : t('youLose');
    return o.winner === 'goat' ? t('goatWins') : t('tigerWins');
  }

  private reasonText(o: Outcome): string {
    if (o.kind === 'draw') return t('rRepeat');
    switch (o.reason) {
      case 'captures':
        return t('rCaptures');
      case 'tiger-blocked':
        return t('rBlocked');
      case 'goats-locked':
        return t('rLocked');
      case 'repetition':
        return t('rRepeat');
    }
  }

  private controlsView(withSound = true, withLastMove = false): string {
    const soundIcon = this.soundOn ? '🔊' : '🔇';
    return `
      <div class="controls${withSound ? '' : ' game-controls'}">
        ${withLastMove ? `<button class="chip-btn${this.showLastMove ? ' active' : ''}" data-act="lastmove">${t('lastMove')}</button>` : ''}
        <button class="chip-btn" data-act="lang">${t('langBtn')}</button>
        ${withSound ? `<button class="chip-btn" data-act="sound" aria-label="sound">${soundIcon}</button>` : ''}
      </div>`;
  }

  private menuView(): string {
    return `
      ${this.controlsView()}
      <div class="menu">
        <div class="menu-art">🐅<span>🐐</span></div>
        <h1 class="title">${t('title')}</h1>
        <p class="subtitle">${t('subtitle')}</p>
        <p class="pieces-line">${t('piecesLine')}</p>
        <div class="menu-buttons">
          <button class="btn btn-primary" data-act="pick-ai">${t('modeAI')}</button>
          <button class="btn" data-act="local">${t('modeLocal')}</button>
        </div>
      </div>`;
  }

  private difficultyChips(): string {
    return DIFFICULTIES.map(
      (d) =>
        `<button class="chip-btn ${d === this.difficulty ? 'active' : ''}" data-act="diff" data-diff="${d}">${t(DIFF_KEYS[d])}</button>`,
    ).join('');
  }

  private sideView(): string {
    const chips = this.difficultyChips();
    return `
      ${this.controlsView()}
      <div class="menu">
        <p class="prompt-label">${t('diffLabel')}</p>
        <div class="chips">${chips}</div>
        <h2 class="prompt">${t('sidePick')}</h2>
        <div class="menu-buttons">
          <button class="btn btn-goat" data-act="side" data-side="goat">🐐 ${t('asGoat')}</button>
          <button class="btn btn-tiger" data-act="side" data-side="tiger">🐅 ${t('asTiger')}</button>
          <button class="btn btn-ghost" data-act="menu">${t('back')}</button>
        </div>
      </div>`;
  }

  private chipFor(m: Move, i: number): string {
    const side = i % 2 === 0 ? 'goat' : 'tiger';
    const emoji = side === 'goat' ? '🐐' : '🐅';
    const cls = m.kind === 'jump' ? ' capture' : '';
    return `<span class="chip ${side}${cls}" title="${t(m.kind)}">${emoji} ${moveLabel(m)}</span>`;
  }

  private lastMoveView(): string {
    const off = this.showLastMove ? '' : ' off';
    const moves = this.engine.moves;
    if (moves.length === 0) return `<div class="last-move empty${off}"></div>`;
    const m = moves[moves.length - 1];
    const emoji = (moves.length - 1) % 2 === 0 ? '🐐' : '🐅';
    const cls = m.kind === 'jump' ? ' capture' : '';
    return `<div class="last-move${cls}${off}" aria-label="${t('lastMove')}"><span class="last-move-label">${t('lastMove')}:</span> ${emoji} ${moveLabel(m)}</div>`;
  }

  private moveListView(): string {
    if (!this.showLastMove) return '';
    const moves = this.engine.moves;
    if (moves.length === 0) return `<p class="pause-empty">${t('movesLabel')}: —</p>`;
    const chips = moves.map((m, i) => this.chipFor(m, i)).join('');
    return `<div class="history pause-history" aria-label="${t('movesLabel')}">${chips}</div>`;
  }

  private pauseOverlay(): string {
    return `
      <div class="overlay">
        <div class="card pause-card">
          <h2>⏸ ${t('paused')}</h2>
          ${this.moveListView()}
          <div class="menu-buttons">
            <button class="btn btn-primary" data-act="resume">${t('resume')}</button>
            <button class="btn" data-act="new">${t('reset')}</button>
            <button class="btn btn-ghost" data-act="menu">${t('menu')}</button>
          </div>
          <p class="prompt-label">${t('diffLabel')}</p>
          <div class="chips">${this.difficultyChips()}</div>
          ${this.controlsView(true, true)}
        </div>
      </div>`;
  }

  private gameView(): string {
    const st = this.engine.current;
    const outcome = this.engine.outcome;
    const fx = this.pendingFx;
    this.pendingFx = null;
    const placing =
      !outcome && !this.thinking && this.humanTurn() && st.toMove === 'goat' && st.goatsInHand > 0;
    const board = renderBoard(st, {
      selected: this.selected,
      targets: this.targets(),
      placing,
      last: this.showLastMove ? this.lastMove() : null,
      fx,
    });
    const turnEmoji = st.toMove === 'goat' ? '🐐' : '🐅';
    const canUndo = !outcome && !this.thinking && this.engine.historyLength > 0;
    const overlay = outcome
      ? `<div class="overlay">
           <div class="card">
             <div class="result">${outcome.kind === 'win' ? (outcome.winner === 'goat' ? '🐐' : '🐅') : '⚖️'}</div>
             <h2>${this.resultText(outcome)}</h2>
             <p class="reason">${this.reasonText(outcome)}</p>
             <div class="menu-buttons">
               <button class="btn btn-primary" data-act="new">${t('newGame')}</button>
               <button class="btn btn-ghost" data-act="menu">${t('menu')}</button>
             </div>
           </div>
         </div>`
      : this.paused
        ? this.pauseOverlay()
        : '';
    return `
      <div class="game">
        ${this.controlsView(false)}
        <header class="topbar">
          <div class="turn ${st.toMove}"><span class="turn-emoji">${turnEmoji}</span>${this.turnText()}</div>
          <div class="counts">
            <span>🐐 ${t('inHand')} ${num(st.goatsInHand)}</span>
            <span>✕ ${t('captured')} ${num(st.goatsCaptured)}</span>
          </div>
        </header>
        <div class="board-wrap">${board}</div>
        <div class="hint">${this.hintText()}</div>
        ${this.lastMoveView()}
        <div class="game-actions">
          <button class="btn btn-ghost" data-act="undo" ${canUndo ? '' : 'disabled'}>${t('undo')}</button>
          <button class="chip-btn" data-act="sound" aria-label="sound">${this.soundOn ? '🔊' : '🔇'}</button>
          <button class="btn btn-ghost" data-act="pause">${t('menu')}</button>
        </div>
      </div>
      ${overlay}`;
  }

  private render(): void {
    this.root.dataset.screen = this.screen;
    if (this.screen === 'menu') this.root.innerHTML = this.menuView();
    else if (this.screen === 'side') this.root.innerHTML = this.sideView();
    else this.root.innerHTML = this.gameView();
    const history = this.root.querySelector('.history:not(.empty)');
    if (history) history.scrollLeft = history.scrollWidth;
  }
}
