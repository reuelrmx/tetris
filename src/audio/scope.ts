/**
 * One Web Audio context for the whole app.
 *
 * Browsers limit how many `AudioContext`s a page may create and start them suspended until a user
 * gesture, so the context, the two bus gains (effects, music) and the mute state live here and are
 * shared by `SfxSynth` and `MusicEngine`. Everything degrades to a no-op when the API is missing.
 */
export class AudioScope {
  private ctx: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private state = { muted: false, sfx: 0.7, music: 0 };
  private readonly factory: (() => AudioContext | null) | null;
  private disposed = false;

  constructor(factory?: () => AudioContext | null) {
    this.factory = factory ?? defaultFactory();
  }

  get available(): boolean {
    return this.factory !== null;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  get sfxGain(): GainNode | null {
    return this.sfxBus;
  }

  get musicGain(): GainNode | null {
    return this.musicBus;
  }

  /** Creates (once) and resumes the context. Call from a user gesture. */
  unlock(): boolean {
    if (!this.factory || this.disposed) return false;
    if (!this.ctx) {
      const ctx = this.factory();
      if (!ctx) return false;
      this.ctx = ctx;
      this.sfxBus = ctx.createGain();
      this.musicBus = ctx.createGain();
      this.sfxBus.connect(ctx.destination);
      this.musicBus.connect(ctx.destination);
      this.applyGains();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return true;
  }

  setVolumes(volumes: { muted: boolean; sfx: number; music: number }): void {
    this.state = {
      muted: volumes.muted,
      sfx: clamp01(volumes.sfx),
      music: clamp01(volumes.music),
    };
    this.applyGains();
  }

  /** Readiness for playback: unlocked, resumed and not muted. */
  get canPlay(): boolean {
    return !this.disposed && !this.state.muted && this.ctx !== null && this.ctx.state === 'running';
  }

  dispose(): void {
    this.disposed = true;
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.sfxBus = null;
    this.musicBus = null;
  }

  private applyGains(): void {
    if (this.sfxBus) this.sfxBus.gain.value = this.state.muted ? 0 : this.state.sfx;
    if (this.musicBus) this.musicBus.gain.value = this.state.muted ? 0 : this.state.music;
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function defaultFactory(): (() => AudioContext | null) | null {
  const scope = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  if (!Ctor) return null;
  let created = false;
  return () => {
    if (created) return null;
    created = true;
    try {
      return new Ctor();
    } catch {
      return null;
    }
  };
}
