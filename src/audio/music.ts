import type { AudioScope } from './scope.ts';

/**
 * Optional background music: a slow, procedural two-part piece in A minor pentatonic.
 *
 * It is generated rather than shipped (no audio files, nothing to license), and it is sparse on
 * purpose — a low drone, a pulse on the beat and a handful of notes per bar, scheduled with a
 * 200 ms lookahead so it never glitches while the frame rate is busy. The register rises with the
 * level, which is the only "adaptive" behaviour: no sudden stings, no tempo spikes.
 *
 * Music is off unless the player turns it on; `setLevel` shifts the octave as the game progresses.
 */
const SCALE = [0, 3, 5, 7, 10]; // minor pentatonic
const ROOT_HZ = 110; // A2

export class MusicEngine {
  private readonly scope: AudioScope;
  private playing = false;
  private nextNoteTime = 0;
  private step = 0;
  private tempoBpm = 84;
  private level = 1;
  private droneNodes: Array<{ stop: () => void; gain: GainNode }> = [];

  constructor(scope: AudioScope) {
    this.scope = scope;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  start(): void {
    if (this.playing) return;
    if (!this.scope.unlock()) return;
    this.playing = true;
    const ctx = this.scope.context;
    this.nextNoteTime = (ctx?.currentTime ?? 0) + 0.1;
    this.step = 0;
    this.startDrone();
  }

  stop(): void {
    this.playing = false;
    for (const drone of this.droneNodes) drone.stop();
    this.droneNodes = [];
  }

  /** Shifts the melodic register with the level, capped so it never becomes shrill. */
  setLevel(level: number): void {
    this.level = Math.max(1, Math.min(12, level));
  }

  /** Called every frame; schedules notes up to 200 ms ahead. */
  tick(): void {
    if (!this.playing) return;
    const ctx = this.scope.context;
    const bus = this.scope.musicGain;
    if (!ctx || !bus || ctx.state !== 'running') return;
    const lookahead = ctx.currentTime + 0.2;
    while (this.nextNoteTime < lookahead) {
      this.scheduleStep(this.nextNoteTime);
      // One step is an eighth note.
      this.nextNoteTime += 60 / this.tempoBpm / 2;
      this.step += 1;
      if (this.step % 32 === 0 && this.tempoBpm < 108) this.tempoBpm += 2;
    }
  }

  private startDrone(): void {
    const ctx = this.scope.context;
    const bus = this.scope.musicGain;
    if (!ctx || !bus) return;
    const octave = Math.floor((this.level - 1) / 4);
    for (const [multiplier, level] of [
      [0.5, 0.22],
      [1, 0.1],
    ] as const) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = ROOT_HZ * multiplier * Math.pow(2, octave * 0);
      gain.gain.value = 0;
      gain.gain.linearRampToValueAtTime(level, ctx.currentTime + 2);
      oscillator.connect(gain).connect(bus);
      oscillator.start();
      this.droneNodes.push({
        gain,
        stop: () => {
          try {
            gain.gain.cancelScheduledValues(ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
            oscillator.stop(ctx.currentTime + 0.5);
          } catch {
            oscillator.stop();
          }
        },
      });
    }
  }

  private scheduleStep(time: number): void {
    const ctx = this.scope.context;
    const bus = this.scope.musicGain;
    if (!ctx || !bus) return;
    const bar = Math.floor(this.step / 8) % 4;
    // A pulse on every beat keeps time; melodies appear on the second half of the phrase.
    const onBeat = this.step % 2 === 0;
    const octave = Math.floor((this.level - 1) / 4) + 1;
    if (onBeat) {
      this.blip(bus, time, ROOT_HZ * 2 * Math.pow(2, octave * 1), 'triangle', 0.05, 0.09);
    }
    if (bar >= 2 && this.step % 2 === 1) {
      const degree = SCALE[(this.step * 3 + bar) % SCALE.length] as number;
      const frequency = ROOT_HZ * 2 * Math.pow(2, degree / 12) * Math.pow(2, octave);
      this.blip(bus, time, frequency, 'sine', 0.07, 0.22);
    }
  }

  private blip(
    bus: GainNode,
    time: number,
    frequency: number,
    type: OscillatorType,
    gain: number,
    duration: number,
  ): void {
    const ctx = this.scope.context;
    if (!ctx) return;
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.exponentialRampToValueAtTime(gain, time + 0.02);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(envelope).connect(bus);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.02);
  }
}
