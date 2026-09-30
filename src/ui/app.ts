import { Difficulty } from '../game/ai';
import { playSound, setSoundEnabled, SoundName } from '../game/audio';
import { GameEngine } from '../game/engine';
import {
  GameState,
  Move,
  Outcome,
  Side,
  applyMove,
  initialState,
  legalMoves,
} from '../game/rules';
import { colOf, rowOf } from '../game/board';
import { renderBoard, Target } from './boardView';
import { lang, num, setLang, t } from './i18n';
import { TUT_SCENARIOS, TutSide } from './tutScript';

type Screen = 'menu' | 'side' | 'game' | 'tut';
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
  private tutorial = !loadBool('tutSeen', false);
  private selected: number | null = null;
  private thinking = false;
  private paused = false;
  private gameId = 0;
  private pendingFx: Move | null = null;
  private worker: Worker;
  /* learn screen (interactive tutorial). tutRun is a cancellation token: every
     tut-owned timeout captures it at schedule time and returns before touching
     state if it went stale (exit/scenario switch/new game bumps it). */
  private tutRun = 0;
  private tutPhase: 'choose' | 'run' = 'choose';
  private tutSide: TutSide = 'goat';
  private tutIdx = 0;
  private tutState: GameState | null = null;
  private tutSelected: number | null = null;
  private tutShake = false;
  private tutBusy = false;
  private tutFx: Move | null = null;

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
      if (this.screen === 'tut') this.onTutNode(Number(el.getAttribute('data-node')));
      else this.onNode(Number(el.getAttribute('data-node')));
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
      case 'tut':
        this.sound('tap');
        this.tutorial = true;
        this.render();
        break;
      case 'tut-close':
        this.tutorial = false;
        localStorage.setItem('tutSeen', '1');
        this.sound('tap');
        this.render();
        break;
      case 'tut-next':
        this.sound('tap');
        this.tutorial = false;
        localStorage.setItem('tutSeen', '1');
        this.enterTut();
        break;
      case 'tut-side': {
        const side = el.getAttribute('data-side') as TutSide;
        if (side !== 'goat' && side !== 'tiger') break;
        this.sound('tap');
        this.startScenario(side);
        break;
      }
      case 'tut-other':
        this.sound('tap');
        this.startScenario(this.tutSide === 'goat' ? 'tiger' : 'goat');
        break;
      case 'tut-ff':
        this.sound('tap');
        this.advanceTut();
        break;
      case 'tut-start':
        this.sound('tap');
        this.exitTut();
        this.screen = 'side';
        this.render();
        break;
    }
  }

  private goMenu(): void {
    this.exitTut();
    this.gameId++;
    this.screen = 'menu';
    this.thinking = false;
    this.paused = false;
    this.selected = null;
    this.pendingFx = null;
    this.render();
  }

  private newGame(mode: Mode, side: Side): void {
    this.exitTut();
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

  /* ---------- learn screen (interactive tutorial) ---------- */

  /** Cancels every pending tut timeout (bumps the token) and clears tut fields. */
  private exitTut(): void {
    this.tutRun++;
    this.tutPhase = 'choose';
    this.tutIdx = 0;
    this.tutState = null;
    this.tutSelected = null;
    this.tutShake = false;
    this.tutBusy = false;
    this.tutFx = null;
  }

  private enterTut(): void {
    this.exitTut();
    this.screen = 'tut';
    this.render();
  }

  private tutSteps() {
    return TUT_SCENARIOS[this.tutSide].steps;
  }

  private tutStep() {
    return this.tutSteps()[this.tutIdx];
  }

  private startScenario(side: TutSide): void {
    this.exitTut();
    this.tutSide = side;
    this.tutPhase = 'run';
    this.tutIdx = 0;
    const first = TUT_SCENARIOS[side].steps[0];
    this.tutState = first.state ?? initialState();
    this.screen = 'tut';
    this.startStep();
  }

  /** Enters the current step: load its crafted state, then schedule any
      watch/info auto-play. Renders once at the end. */
  private startStep(): void {
    const step = this.tutStep();
    if (step.state) this.tutState = step.state;
    this.tutSelected = null;
    this.tutShake = false;
    this.tutFx = null;
    this.tutBusy = false;
    const run = this.tutRun;
    if (step.auto && step.auto.length > 0 && !step.expect) {
      this.tutBusy = true;
      this.chainAuto(step.auto, 0, run, step.delay ?? 900, 700);
    } else if (step.info) {
      this.tutBusy = true;
      window.setTimeout(() => {
        if (run !== this.tutRun) return; // cancelled: no state/render on stale timer
        this.tutBusy = false;
        this.advanceTut();
      }, step.delay ?? 1600);
    }
    this.render();
  }

  private chainAuto(moves: Move[], i: number, run: number, firstDelay: number, gap: number): void {
    window.setTimeout(() => {
      if (run !== this.tutRun) return; // cancelled: no state/render on stale timer
      const m = moves[i];
      if (!this.tutState) return;
      try {
        this.tutState = applyMove(this.tutState, m);
      } catch (err) {
        console.error('tutorial auto move failed', err);
        return;
      }
      this.tutFx = m;
      this.soundForMove(m);
      this.render();
      if (i + 1 < moves.length) this.chainAuto(moves, i + 1, run, gap, gap);
      else {
        window.setTimeout(() => {
          if (run !== this.tutRun) return; // cancelled: no advance on stale timer
          this.tutBusy = false;
          this.advanceTut();
        }, gap);
      }
    }, firstDelay);
  }

  private advanceTut(): void {
    const steps = this.tutSteps();
    if (this.tutIdx >= steps.length - 1) {
      this.render();
      return;
    }
    this.tutIdx++;
    this.startStep();
  }

  private shakeTut(): void {
    if (this.tutShake) return; // dedupe: mashing wrong taps never stacks shakes
    this.tutShake = true;
    this.render();
    const run = this.tutRun;
    window.setTimeout(() => {
      if (run !== this.tutRun) return; // cancelled: no render on stale timer
      this.tutShake = false;
      this.render();
    }, 450);
  }

  private onTutNode(n: number): void {
    if (this.tutPhase !== 'run' || this.tutBusy) return;
    const step = this.tutStep();
    const exp = step.expect;
    if (!exp || !this.tutState) return;

    if (exp.kind === 'place') {
      if (n === exp.to) this.performTut(exp);
      else this.shakeTut();
      return;
    }

    if (this.tutSelected === null) {
      if (n === step.tapPiece) {
        this.tutSelected = n;
        this.tutShake = false;
        this.sound('tap');
        this.render();
      } else this.shakeTut();
      return;
    }

    if (n === step.tapPiece) return; // re-tap of the selected piece: no-op
    if (
      (exp.kind === 'step' || exp.kind === 'jump') &&
      exp.from === this.tutSelected &&
      n === exp.to
    ) {
      this.performTut(exp);
      return;
    }
    this.shakeTut();
  }

  private performTut(m: Move): void {
    if (!this.tutState) return;
    try {
      this.tutState = applyMove(this.tutState, m);
    } catch (err) {
      console.error('tutorial scripted move failed', err);
      return;
    }
    this.tutFx = m;
    this.tutSelected = null;
    this.tutShake = false;
    this.tutBusy = false;
    this.soundForMove(m);
    const step = this.tutStep();
    const run = this.tutRun;
    if (step.auto && step.auto.length > 0) {
      this.tutBusy = true;
      this.render();
      this.chainAuto(step.auto, 0, run, 700, 700);
    } else {
      this.advanceTut();
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
          <button class="btn btn-ghost" data-act="tut">${t('tutOpen')}</button>
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

  private tutorialView(): string {
    const section = (icon: string, key: string): string =>
      `<div class="tut-section"><span class="tut-ico">${icon}</span><p>${t(key)}</p></div>`;
    return `
      <div class="overlay">
        <div class="card tut-card">
          <h2>📖 ${t('tutTitle')}</h2>
          ${section('🎯', 'tutGoalT')}
          ${section('🐐', 'tutGoalG')}
          ${section('🐅', 'tutSetup')}
          ${section('📍', 'tutPlace')}
          ${section('👆', 'tutMove')}
          ${section('🦘', 'tutJump')}
          ${section('🏅', 'tutWin')}
          ${section('💡', 'tutTips')}
          <div class="menu-buttons">
            <button class="btn btn-primary" data-act="tut-next">${t('tutNext')}</button>
            <button class="btn btn-ghost" data-act="tut-close">${t('tutClose')}</button>
          </div>
        </div>
      </div>`;
  }

  private tutView(): string {
    if (this.tutPhase === 'choose' || !this.tutState) {
      return `
      ${this.controlsView()}
      <div class="menu">
        <p class="prompt">${t('tutChooseTitle')}</p>
        <div class="menu-buttons">
          <button class="btn btn-goat" data-act="tut-side" data-side="goat">🐐 ${t('asGoat')}</button>
          <button class="btn btn-tiger" data-act="tut-side" data-side="tiger">🐅 ${t('asTiger')}</button>
          <button class="btn btn-ghost" data-act="menu">${t('back')}</button>
        </div>
      </div>`;
    }

    const step = this.tutStep();
    const st = this.tutState;
    const exp = step.expect;
    const emoji = this.tutSide === 'goat' ? '🐐' : '🐅';
    const textKey = this.tutSelected !== null && step.text2 ? step.text2 : step.text;
    const instr = step.final && step.goalKey ? t(step.goalKey) : t(textKey);

    let selected: number | null = null;
    let targets: Target[] = [];
    let hint: number | undefined;
    let arrow: { from: number; to: number } | undefined;
    if (exp && !step.final) {
      if (this.tutSelected === null) {
        hint = step.hint;
      } else {
        selected = this.tutSelected;
        targets = legalMoves(st)
          .filter((m) => (m.kind === 'step' || m.kind === 'jump') && m.from === selected)
          .map((m) =>
            m.kind === 'jump'
              ? { to: m.to, capture: true, over: m.over }
              : { to: m.to, capture: false },
          );
        arrow = { from: selected, to: exp.to };
      }
    }

    const fx = this.tutFx;
    this.tutFx = null;
    const board = renderBoard(st, {
      selected,
      targets,
      placing: false,
      last: null,
      fx,
      hint,
      shake: this.tutShake || undefined,
      arrow,
    });
    const dots = this.tutSteps()
      .map(
        (_, i) =>
          `<span class="tut-dot${i === this.tutIdx ? ' active' : i < this.tutIdx ? ' done' : ''}"></span>`,
      )
      .join('');
    let actions: string;
    if (step.final) {
      actions = `<div class="menu-buttons">
           <button class="btn btn-primary" data-act="tut-other">${t(this.tutSide === 'goat' ? 'tutNextTiger' : 'tutNextGoat')}</button>
           <button class="btn" data-act="tut-start">${t('tutStart')}</button>
           <button class="btn btn-ghost" data-act="menu">${t('menu')}</button>
         </div>`;
    } else if (step.tapBtn) {
      actions = `<div class="menu-buttons">
           <button class="btn btn-primary" data-act="tut-ff">${t(step.tapBtn)}</button>
           <button class="btn btn-ghost" data-act="menu">${t('menu')}</button>
         </div>`;
    } else {
      actions = `<div class="game-actions">
           <button class="btn btn-ghost" data-act="menu">${t('menu')}</button>
         </div>`;
    }
    return `
      <div class="game tut-game">
        ${this.controlsView(false)}
        <header class="topbar">
          <div class="turn tut-instr"><span class="turn-emoji">${emoji}</span>${instr}</div>
          <div class="counts">
            <span>🐐 ${t('inHand')} ${num(st.goatsInHand)}</span>
            <span>✕ ${t('captured')} ${num(st.goatsCaptured)}</span>
          </div>
        </header>
        <div class="board-wrap">${board}</div>
        <div class="tut-dots" data-step="${this.tutIdx}">${dots}</div>
        ${actions}
      </div>`;
  }

  private render(): void {
    this.root.dataset.screen = this.screen;
    this.root.dataset.phase = this.screen === 'tut' ? this.tutPhase : '';
    let html: string;
    if (this.screen === 'menu') html = this.menuView();
    else if (this.screen === 'side') html = this.sideView();
    else if (this.screen === 'tut') html = this.tutView();
    else html = this.gameView();
    if (this.tutorial && this.screen === 'menu') html += this.tutorialView();
    this.root.innerHTML = html;
    const history = this.root.querySelector('.history:not(.empty)');
    if (history) history.scrollLeft = history.scrollWidth;
  }
}
