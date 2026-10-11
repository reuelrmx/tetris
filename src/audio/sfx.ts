import type { AudioScope } from './scope.ts';

/**
 * Sound effects, synthesised at runtime.
 *
 * The game ships no audio files: every sound is a short Web Audio graph (oscillator + gain
 * envelope, plus a filtered noise burst for impacts). That keeps the offline cache tiny, removes
 * every licensing question, and lets the same voice be re-pitched for a quad versus a single.
 *
 * The module tolerates a missing `AudioContext` entirely: playback becomes a no-op instead of an
 * error, so restricted environments still get a working game.
 */
export type SoundName =
  | 'move'
  | 'rotate'
  | 'lock'
  | 'hold'
  | 'clear1'
  | 'clear2'
  | 'clear3'
  | 'clear4'
  | 'tspin'
  | 'perfectClear'
  | 'levelup'
  | 'gameover'
  | 'win'
  | 'countdown'
  | 'start'
  | 'ready'
  | 'error';

interface Voice {
  readonly voices: ReadonlyArray<{
    readonly type: OscillatorType;
    readonly from: number;
    readonly to?: number;
    readonly gain: number;
    readonly duration: number;
    readonly delay?: number;
  }>;
  /** Adds a short filtered noise burst (impacts). */
  readonly noise?: { readonly gain: number; readonly duration: number; readonly frequency: number };
  readonly gain?: number;
}

export const VOICES: Readonly<Record<SoundName, Voice>> = {
  move: { voices: [{ type: 'triangle', from: 320, to: 300, gain: 0.16, duration: 0.035 }], gain: 0.5 },
  rotate: { voices: [{ type: 'square', from: 470, to: 520, gain: 0.12, duration: 0.05 }], gain: 0.4 },
  lock: {
    voices: [{ type: 'sine', from: 150, to: 70, gain: 0.32, duration: 0.12 }],
    noise: { gain: 0.16, duration: 0.07, frequency: 900 },
    gain: 0.9,
  },
  hold: { voices: [{ type: 'triangle', from: 260, to: 340, gain: 0.2, duration: 0.07 }], gain: 0.6 },
  clear1: { voices: [{ type: 'triangle', from: 620, gain: 0.26, duration: 0.1 }], gain: 0.8 },
  clear2: {
    voices: [
      { type: 'triangle', from: 620, gain: 0.26, duration: 0.09 },
      { type: 'triangle', from: 820, gain: 0.24, duration: 0.1, delay: 0.06 },
    ],
    gain: 0.85,
  },
  clear3: {
    voices: [
      { type: 'triangle', from: 620, gain: 0.24, duration: 0.09 },
      { type: 'triangle', from: 820, gain: 0.24, duration: 0.09, delay: 0.055 },
      { type: 'triangle', from: 1030, gain: 0.22, duration: 0.12, delay: 0.11 },
    ],
    gain: 0.9,
  },
  clear4: {
    voices: [
      { type: 'triangle', from: 620, gain: 0.24, duration: 0.08 },
      { type: 'triangle', from: 830, gain: 0.24, duration: 0.08, delay: 0.05 },
      { type: 'triangle', from: 1040, gain: 0.24, duration: 0.09, delay: 0.1 },
      { type: 'triangle', from: 1310, gain: 0.22, duration: 0.18, delay: 0.15 },
    ],
    gain: 1,
  },
  tspin: {
    voices: [
      { type: 'sine', from: 880, gain: 0.24, duration: 0.14 },
      { type: 'sine', from: 1320, gain: 0.18, duration: 0.2, delay: 0.05 },
    ],
    gain: 0.9,
  },
  perfectClear: {
    voices: [
      { type: 'triangle', from: 700, gain: 0.22, duration: 0.1 },
      { type: 'triangle', from: 940, gain: 0.22, duration: 0.1, delay: 0.08 },
      { type: 'triangle', from: 1240, gain: 0.22, duration: 0.12, delay: 0.16 },
      { type: 'triangle', from: 1560, gain: 0.2, duration: 0.26, delay: 0.24 },
    ],
    gain: 1,
  },
  levelup: {
    voices: [
      { type: 'square', from: 520, gain: 0.14, duration: 0.08 },
      { type: 'square', from: 660, gain: 0.14, duration: 0.08, delay: 0.07 },
      { type: 'square', from: 880, gain: 0.14, duration: 0.14, delay: 0.14 },
    ],
    gain: 0.6,
  },
  gameover: {
    voices: [
      { type: 'sawtooth', from: 330, to: 180, gain: 0.18, duration: 0.4 },
      { type: 'sine', from: 160, to: 80, gain: 0.2, duration: 0.6, delay: 0.1 },
    ],
    gain: 0.8,
  },
  win: {
    voices: [
      { type: 'triangle', from: 520, gain: 0.2, duration: 0.1 },
      { type: 'triangle', from: 780, gain: 0.2, duration: 0.1, delay: 0.1 },
      { type: 'triangle', from: 1040, gain: 0.2, duration: 0.16, delay: 0.2 },
    ],
    gain: 0.9,
  },
  countdown: { voices: [{ type: 'square', from: 440, gain: 0.16, duration: 0.12 }], gain: 0.7 },
  start: {
    voices: [
      { type: 'square', from: 520, gain: 0.18, duration: 0.1 },
      { type: 'square', from: 880, gain: 0.18, duration: 0.2, delay: 0.1 },
    ],
    gain: 0.8,
  },
  ready: { voices: [{ type: 'triangle', from: 700, to: 900, gain: 0.18, duration: 0.12 }], gain: 0.7 },
  error: { voices: [{ type: 'square', from: 200, to: 150, gain: 0.14, duration: 0.16 }], gain: 0.6 },
};

export class SfxSynth {
  private readonly scope: AudioScope;
  private noiseBuffer: AudioBuffer | null = null;

  constructor(scope: AudioScope) {
    this.scope = scope;
  }

  /** Marks the context as usable; call from a user gesture (click, key press, touch). */
  unlock(): void {
    this.scope.unlock();
  }

  play(name: SoundName, variation = 0): void {
    const ctx = this.scope.context;
    const bus = this.scope.sfxGain;
    if (!ctx || !bus || !this.scope.canPlay) return;
    const voice = VOICES[name];
    const now = ctx.currentTime + 0.001;
    for (const spec of voice.voices) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = spec.type;
      const detune = 1 + variation * 0.02;
      const start = now + (spec.delay ?? 0);
      oscillator.frequency.setValueAtTime(spec.from * detune, start);
      if (spec.to !== undefined) {
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, spec.to * detune), start + spec.duration);
      }
      const peak = Math.max(0.0002, spec.gain * (voice.gain ?? 1));
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + spec.duration);
      oscillator.connect(gain).connect(bus);
      oscillator.start(start);
      oscillator.stop(start + spec.duration + 0.02);
    }
    if (voice.noise) {
      const source = ctx.createBufferSource();
      source.buffer = this.ensureNoise(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = voice.noise.frequency;
      const gain = ctx.createGain();
      const peak = voice.noise.gain * (voice.gain ?? 1);
      gain.gain.setValueAtTime(peak, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + voice.noise.duration);
      source.connect(filter).connect(gain).connect(bus);
      source.start(now);
      source.stop(now + voice.noise.duration + 0.02);
    }
  }

  private ensureNoise(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.floor(ctx.sampleRate * 0.2);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Deterministic noise so the sound is identical every session.
    let state = 0x1234567;
    for (let i = 0; i < length; i++) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      data[i] = ((state / 0x7fffffff) * 2 - 1) * 0.6;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }
}
