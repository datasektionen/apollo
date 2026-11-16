/**
 * Progressive Web App (PWA) lifecycle and installation management
 */

let deferredInstallPrompt = null;
const installListeners = new Set();

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  try {
    const hasMatchMedia = typeof window.matchMedia === 'function';
    return Boolean(
      (hasMatchMedia && (
        window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: window-controls-overlay)').matches
      )) ||
      window.navigator?.standalone === true ||
      (typeof document !== 'undefined' && document.referrer?.includes('android-app://'))
    );
  } catch {
    return false;
  }
}

export function isPwaInstallable() {
  return deferredInstallPrompt !== null;
}

export async function promptPwaInstall() {
  if (!deferredInstallPrompt) {
    return { outcome: 'unavailable' };
  }
  try {
    await deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    notifyInstallListeners();
    return choice;
  } catch (error) {
    console.warn('[PWA] Install prompt failed:', error);
    deferredInstallPrompt = null;
    notifyInstallListeners();
    return { outcome: 'dismissed' };
  }
}

export function subscribePwaInstall(listener) {
  if (typeof listener !== 'function') return () => {};
  installListeners.add(listener);
  listener({
    isInstallable: isPwaInstallable(),
    isStandalone: isStandalone(),
  });
  return () => {
    installListeners.delete(listener);
  };
}

function notifyInstallListeners() {
  const state = {
    isInstallable: isPwaInstallable(),
    isStandalone: isStandalone(),
  };
  for (const listener of installListeners) {
    try {
      listener(state);
    } catch (err) {
      console.warn('[PWA] Listener failed:', err);
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    deferredInstallPrompt = e;
    notifyInstallListeners();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    notifyInstallListeners();
    console.info('[PWA] App successfully installed');
  });
}

/**
 * Register service worker
 */
export async function registerServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  // Register in production or when explicitly enabled
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    });

    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          console.info('[PWA] New version available, activating...');
          window.dispatchEvent(new CustomEvent('apollo:pwa-update-available'));
          newWorker.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    });

    // Background service worker updates activate cleanly without forcibly reloading active audio sessions
    return registration;
  } catch (error) {
    // Registration might fail on unsupported dev setups or non-HTTPS
    console.warn('[PWA] Service worker registration failed:', error);
    return null;
  }
}
