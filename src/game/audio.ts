export type SoundName = 'tap' | 'place' | 'move' | 'capture' | 'win' | 'draw';

let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(v: boolean): void {
  enabled = v;
}

function ac(): AudioContext | null {
  if (!enabled) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(
  c: AudioContext,
  freq: number,
  at: number,
  dur: number,
  gain: number,
  type: OscillatorType = 'sine',
  slideTo?: number,
): void {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(c.destination);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

export function playSound(name: SoundName): void {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime;
  switch (name) {
    case 'tap':
      tone(c, 660, t0, 0.06, 0.06, 'sine');
      break;
    case 'place':
      tone(c, 520, t0, 0.09, 0.1, 'triangle');
      tone(c, 700, t0 + 0.07, 0.1, 0.09, 'triangle');
      break;
    case 'move':
      tone(c, 420, t0, 0.1, 0.09, 'triangle');
      break;
    case 'capture':
      tone(c, 340, t0, 0.28, 0.16, 'sawtooth', 110);
      tone(c, 90, t0 + 0.02, 0.25, 0.1, 'square', 60);
      break;
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) => tone(c, f, t0 + i * 0.12, 0.22, 0.1, 'triangle'));
      break;
    case 'draw':
      tone(c, 440, t0, 0.25, 0.09, 'triangle');
      tone(c, 415, t0 + 0.2, 0.35, 0.09, 'triangle');
      break;
  }
}
