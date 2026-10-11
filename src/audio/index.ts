import type { ActionOutcome, GameEvent, LockResult } from '../engine/index.ts';
import { MusicEngine } from './music.ts';
import { AudioScope } from './scope.ts';
import { SfxSynth } from './sfx.ts';
import type { SoundName } from './sfx.ts';
import type { Settings } from '../storage/settings.ts';

export { AudioScope } from './scope.ts';
export { MusicEngine } from './music.ts';
export { SfxSynth } from './sfx.ts';
export type { SoundName } from './sfx.ts';

/**
 * The game's audio facade: it owns the shared audio scope, decides which sound each engine event
 * deserves, and keeps everything in step with the settings screen. UI code never touches Web
 * Audio directly.
 */
export class GameAudio {
  readonly scope: AudioScope;
  readonly sfx: SfxSynth;
  readonly music: MusicEngine;
  private musicEnabled = false;
  private variation = 0;

  constructor(settings: Settings, factory?: () => AudioContext | null) {
    this.scope = new AudioScope(factory);
    this.sfx = new SfxSynth(this.scope);
    this.music = new MusicEngine(this.scope);
    this.applySettings(settings);
  }

  get available(): boolean {
    return this.scope.available;
  }

  applySettings(settings: Settings): void {
    this.scope.setVolumes({
      muted: settings.muted,
      sfx: settings.sfxVolume,
      music: settings.musicVolume,
    });
    this.musicEnabled = settings.musicVolume > 0.01;
    if (this.musicEnabled && this.music.isPlaying === false && this.scope.canPlay) this.music.start();
    if (!this.musicEnabled && this.music.isPlaying) this.music.stop();
  }

  /** Must be called from a user gesture before any sound can play. */
  unlock(): void {
    this.sfx.unlock();
    if (this.musicEnabled && !this.music.isPlaying) this.music.start();
  }

  play(name: SoundName): void {
    this.variation = (this.variation + 1) % 7;
    this.sfx.play(name, this.variation);
  }

  /** Feedback for a movement or rotation that could not happen (a wall or blocked spin). */
  onAction(action: string, outcome: ActionOutcome): void {
    if (!outcome.performed) return;
    switch (action) {
      case 'moveLeft':
      case 'moveRight':
        this.play('move');
        break;
      case 'rotateCW':
      case 'rotateCCW':
        this.play('rotate');
        break;
      case 'hold':
        this.play('hold');
        break;
      default:
        break;
    }
  }

  /** Maps engine events to sounds. Called once per frame with the drained event list. */
  onEvents(events: readonly GameEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'lock': {
          const result: LockResult = event.result;
          if (result.linesCleared === 0) {
            this.play(result.spin === 'none' ? 'lock' : 'tspin');
            break;
          }
          if (result.spin !== 'none') this.play('tspin');
          if (result.perfectClear) {
            this.play('perfectClear');
            break;
          }
          const byLines: SoundName[] = ['lock', 'clear1', 'clear2', 'clear3', 'clear4'];
          this.play(byLines[Math.min(4, result.linesCleared)] as SoundName);
          break;
        }
        case 'levelup':
          this.play('levelup');
          this.music.setLevel(event.level);
          break;
        case 'gameover':
          this.play('gameover');
          this.music.stop();
          break;
        case 'win':
          this.play('win');
          this.music.stop();
          break;
        case 'garbage':
          this.play('lock');
          break;
        default:
          break;
      }
    }
  }

  dispose(): void {
    this.music.stop();
    this.scope.dispose();
  }
}
