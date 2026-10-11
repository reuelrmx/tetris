import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/screens.css';

import '@fontsource-variable/archivo/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';

import { GameAudio } from './audio/index.ts';
import { KeyboardDriver } from './input/keyboard.ts';
import { ActionRouter } from './input/router.ts';
import { prefersTouchControls } from './input/touch.ts';
import { openRecordsStore } from './storage/records.ts';
import type { ModeStats } from './storage/records.ts';
import { detectStorage, loadSettings, saveSettings } from './storage/settings.ts';
import type { Settings } from './storage/settings.ts';
import { OverlayHost, ToastHost } from './ui/overlay.ts';
import { Navigation } from './ui/navigation.ts';
import { announce, el, qs } from './ui/dom.ts';
import { createMenuScreen } from './ui/screens/menu.ts';
import { createModesScreen } from './ui/screens/modes.ts';
import { createHelpScreen } from './ui/screens/help.ts';
import { createRecordsScreen } from './ui/screens/records.ts';
import { createSettingsScreen } from './ui/screens/settings.ts';
import { createPlayScreen } from './ui/screens/play.ts';
import { createVersusScreen } from './ui/screens/versus.ts';
import type { ScreenDeps } from './ui/screens/deps.ts';
import { registerServiceWorker } from './register-sw.ts';


/**
 * Application entry point.
 *
 * Wires the pieces the screens need (settings, storage, records, audio, input, overlays,
 * navigation), installs the service worker and mounts the menu. There is no framework here: the
 * screens are functions that build DOM, and everything they share is passed in through
 * `ScreenDeps` so the same screens can be exercised in host tests with fakes.
 */
async function main(): Promise<void> {
  const storage = detectStorage();
  let settings: Settings = loadSettings(storage);
  const audio = new GameAudio(settings, undefined);
  const router = new ActionRouter();
  const keyboard = new KeyboardDriver(globalThis, {
    bindings: settings.bindings,
    dasMs: settings.dasMs,
    arrMs: settings.arrMs,
  });
  keyboard.start(router);

  const records = await openRecordsStore(storage);
  const stats = new Map<string, ModeStats>();
  const refreshStats = async (): Promise<void> => {
    stats.clear();
    for (const entry of await records.getAllStats()) stats.set(entry.modeId, entry);
  };
  await refreshStats();

  const overlayRoot = qs(document, '#overlay-root') as HTMLElement;
  const toastRoot = qs(document, '#toast-root') as HTMLElement;
  const screenRoot = qs(document, '#screen-root') as HTMLElement;
  const overlays = new OverlayHost(overlayRoot);
  const toasts = new ToastHost(toastRoot);

  const topbarMode = qs(document, '#topbar-mode');
  const statusMultiplayer = qs(document, '#status-multiplayer');
  const statusBuild = qs(document, '#status-build');
  const pauseButton = qs<HTMLButtonElement>(document, '#btn-pause');
  const soundButton = qs<HTMLButtonElement>(document, '#btn-sound');
  const settingsButton = qs<HTMLButtonElement>(document, '#btn-settings');

  const navigation = new Navigation({
    root: screenRoot,
    onNavigate: (id, instance) => {
      const modeName = instance.title ?? id;
      if (topbarMode) topbarMode.textContent = modeName;
      if (pauseButton) pauseButton.hidden = id !== 'play' && id !== 'versus';
    },
  });

  const applySettings = (next: Settings): void => {
    settings = next;
    saveSettings(storage, settings);
    keyboard.update({ bindings: settings.bindings, dasMs: settings.dasMs, arrMs: settings.arrMs });
    audio.applySettings(settings);
    if (soundButton) {
      soundButton.setAttribute('aria-pressed', String(!settings.muted));
      const label = soundButton.querySelector('[data-sound-label]');
      if (label) label.textContent = settings.muted ? 'off' : 'on';
    }
  };

  const multiplayerStatus = (): string => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return 'Offline: versus matches need a connection, single-player modes work as usual.';
    }
    return 'Ready to connect on demand. Nothing is sent until you join a match.';
  };

  const deps: ScreenDeps = {
    // A getter, not a snapshot: screens always read the current settings, so a change made on
    // the settings screen is visible everywhere else immediately.
    get settings() {
      return settings;
    },
    updateSettings: (patch) => {
      applySettings({ ...settings, ...patch });
      // Re-render the active screen so sliders, toggles and key labels reflect the change.
      if (navigation.activeId === 'settings' || navigation.activeId === 'menu') navigation.refresh();
    },
    storage,
    records,
    audio,
    router,
    keyboard,
    overlays,
    toasts,
    stats,
    refreshStats,
    touchControls: prefersTouchControls(),
    multiplayer: {
      enabled: true,
      reason: '',
      status: multiplayerStatus,
    },
  };
  applySettings(settings);

  navigation.register('menu', (context) => createMenuScreen(deps, context));
  navigation.register('modes', (context) => createModesScreen(deps, context));
  navigation.register('help', (context) => createHelpScreen(deps, context));
  navigation.register('records', (context) => createRecordsScreen(deps, context));
  navigation.register('settings', (context) => createSettingsScreen(deps, context));
  navigation.register('play', (context) => createPlayScreen(deps, context));
  navigation.register('versus', (context) => createVersusScreen(deps, context));

  // Global chrome.
  if (settingsButton) {
    settingsButton.addEventListener('click', () => {
      if (navigation.activeId === 'settings') return;
      navigation.go('settings');
    });
  }
  if (pauseButton) {
    pauseButton.addEventListener('click', () => {
      const active = navigation.active;
      active?.onEscape?.();
    });
  }
  if (soundButton) {
    soundButton.addEventListener('click', () => {
      audio.unlock();
      deps.updateSettings({ muted: !settings.muted });
    });
  }

  // Keyboard: unlock audio on the first real key press, and handle Escape for dialogs/screens.
  globalThis.addEventListener(
    'keydown',
    (event) => {
      audio.unlock();
      if (event.key === 'Escape' && overlays.isOpen) return; // the overlay handles it
      if (!overlays.isOpen && event.key === 'Escape') {
        if (navigation.active?.onEscape?.()) event.preventDefault();
        else if (navigation.activeId !== 'menu') {
          navigation.back();
          event.preventDefault();
        }
      }
    },
    { passive: true },
  );
  globalThis.addEventListener('pointerdown', () => audio.unlock(), { passive: true });
  globalThis.addEventListener('beforeunload', () => {
    const active = navigation.active;
    if (active?.onEscape) active.onEscape();
  });

  const buildLabel = statusBuild;
  if (buildLabel) buildLabel.textContent = `Build ${buildVersion()}`;

  const connectionStatus = (): void => {
    if (!statusMultiplayer) return;
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    statusMultiplayer.textContent = online ? 'Offline play ready · No account needed' : 'Offline — single-player only';
    statusMultiplayer.dataset.state = online ? 'online' : 'offline';
  };
  connectionStatus();
  globalThis.addEventListener('online', connectionStatus);
  globalThis.addEventListener('offline', connectionStatus);

  // Service worker: offline app shell. Never blocks the game.
  void registerServiceWorker((message: string) => toasts.show(message, 'info', 5000));

  // Full-screen toggle: useful on tablets, and it is a real API rather than a fake button.
  const canFullscreen = typeof document.documentElement.requestFullscreen === 'function';
  if (canFullscreen) {
    const fullscreenButton = el('button', {
      class: 'btn btn--ghost',
      type: 'button',
      text: 'Full screen',
      on: {
        click: () => {
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen().catch(() => {
            toasts.show('Full screen was refused by the browser', 'error');
          });
        },
      },
    });
    qs(document, '.topbar__actions')?.prepend(fullscreenButton);
  }

  // Warn before leaving a running game.
  globalThis.addEventListener('beforeunload', (event) => {
    if (document.body.classList.contains('is-playing')) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  navigation.go('menu', undefined, { replace: true });
  announce('STRATA ready. Choose Play to start.');
}

/**
 * The build id is injected by the bundler (`define` in `vite.config.ts`). `typeof` on an
 * undeclared identifier is safe at runtime, so a source run without the define still starts.
 */
declare const __BUILD_VERSION__: string;

function buildVersion(): string {
  return typeof __BUILD_VERSION__ === 'string' ? __BUILD_VERSION__ : 'dev';
}

void main();
