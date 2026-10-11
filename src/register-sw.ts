/**
 * Service worker registration.
 *
 * Registered only in production builds from the same origin: a worker in development would cache
 * the dev server's output and fight with hot reload, and an `file://` origin cannot register one at
 * all. All failures are reported and swallowed — offline support is a bonus, never a precondition
 * for playing.
 */
export interface ServiceWorkerStatus {
  readonly supported: boolean;
  readonly registered: boolean;
  readonly active: boolean;
  readonly message: string;
}

export const INACTIVE_STATUS: ServiceWorkerStatus = {
  supported: false,
  registered: false,
  active: false,
  message: 'Offline caching is not available in this browser',
};

export async function registerServiceWorker(
  onNotice?: (message: string) => void,
): Promise<ServiceWorkerStatus> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return INACTIVE_STATUS;
  }
  if (typeof location === 'undefined' || location.protocol === 'file:') {
    return { ...INACTIVE_STATUS, supported: true, message: 'Offline caching needs http or https' };
  }
  // Dev servers serve unbundled modules; a worker there would cache them and break reloads.
  // `import.meta.env.DEV` is replaced at build time, so this branch disappears in production.
  const isDev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
  if (isDev) {
    return { supported: true, registered: false, active: false, message: 'Offline caching is disabled in development' };
  }

  try {
    const registration = await navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href, {
      scope: './',
    });
    const status: ServiceWorkerStatus = {
      supported: true,
      registered: true,
      active: registration.active !== null,
      message: 'Offline play ready',
    };
    if (registration.waiting) {
      onNotice?.('A new version is ready — reload to use it');
    }
    registration.addEventListener('updatefound', () => {
      onNotice?.('Downloading an update for offline play');
    });
    navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as { type?: string } | null;
      if (data?.type === 'strata:ready') onNotice?.('Offline play is ready');
    });
    return status;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'service worker registration failed';
    onNotice?.(`Offline caching unavailable: ${message}`);
    return { supported: true, registered: false, active: false, message };
  }
}
