import { APP_VERSION, APP_BUILD_NUMBER } from '../config/version';
import { fetchServerVersion } from './serverApi';

/**
 * Compare two semver strings: a and b.
 * Returns:
 *   1 if a > b
 *  -1 if a < b
 *   0 if a === b
 */
export function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

export function isNativePlatform() {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.Capacitor &&
    typeof window.Capacitor.isNativePlatform === 'function' &&
    window.Capacitor.isNativePlatform()
  );
}

let state = {
  clientVersion: APP_VERSION,
  clientBuild: APP_BUILD_NUMBER,
  serverVersion: APP_VERSION,
  minSupportedVersion: APP_VERSION,
  minSupportedNativeBuild: 1,
  apkUrl: '/apollo.apk',
  releaseNotes: '',
  isUpdateAvailable: false,
  isForceUpdate: false,
  isNativeUpdateRequired: false,
  isChecking: false,
  lastChecked: null,
};

const listeners = new Set();

function notifyListeners() {
  const copy = { ...state };
  for (const listener of listeners) {
    try {
      listener(copy);
    } catch (err) {
      console.warn('[VersionManager] Listener error:', err);
    }
  }
}

export function getVersionState() {
  return { ...state };
}

export function subscribeVersionStatus(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  listener({ ...state });
  return () => {
    listeners.delete(listener);
  };
}

export async function checkForUpdates() {
  if (state.isChecking) return state;
  state = { ...state, isChecking: true };
  notifyListeners();

  try {
    const info = await fetchServerVersion();
    const serverVer = info.version || state.serverVersion;
    const minVer = info.minSupportedVersion || serverVer;
    const minBuild = Number(info.minSupportedNativeBuild || 1);
    const apkUrl = info.apkUrl || state.apkUrl;
    const releaseNotes = info.releaseNotes || '';

    const isNative = isNativePlatform();
    let isForce = false;
    let isAvailable = false;
    let isNativeRequired = false;

    // Check version compatibility
    if (compareVersions(minVer, state.clientVersion) > 0) {
      isForce = true;
      isAvailable = true;
    }

    // A native binary APK update is ONLY required if the native build number itself is below minimum
    if (isNative && state.clientBuild < minBuild) {
      isForce = true;
      isAvailable = true;
      isNativeRequired = true;
    } else if (compareVersions(serverVer, state.clientVersion) > 0) {
      isAvailable = true;
    }

    state = {
      ...state,
      serverVersion: serverVer,
      minSupportedVersion: minVer,
      minSupportedNativeBuild: minBuild,
      apkUrl,
      releaseNotes,
      isUpdateAvailable: isAvailable,
      isForceUpdate: isForce,
      isNativeUpdateRequired: isNativeRequired,
      lastChecked: Date.now(),
      isChecking: false,
    };
  } catch (error) {
    // If offline or network error, keep current state
    state = { ...state, isChecking: false };
  }

  notifyListeners();
  return state;
}

export async function applyUpdate() {
  const isNative = isNativePlatform();

  // If the native binary build is incompatible, download the updated APK
  if (isNative && state.isNativeUpdateRequired) {
    const link = document.createElement('a');
    link.href = state.apkUrl || '/apollo.apk';
    link.download = 'apollo.apk';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return;
  }

  // Over-The-Air (OTA) update: applies immediately to Web, PWA, and Native Android
  if (typeof window !== 'undefined') {
    // 1. Post SKIP_WAITING to service worker
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg?.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      } catch {}
    }

    // 2. Bust client caches
    if ('caches' in window) {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {}
    }

    // 3. Force hard reload (OTA fetch of latest web bundle)
    window.location.reload();
  }
}

// Window event listeners
if (typeof window !== 'undefined') {
  // 1. Forced upgrade requested by API (426 Upgrade Required)
  window.addEventListener('apollo:upgrade-required', (e) => {
    const details = e?.detail || {};
    const isNative = isNativePlatform();
    const minBuild = Number(details.minSupportedNativeBuild || state.minSupportedNativeBuild || 1);
    const isNativeRequired = isNative && state.clientBuild < minBuild;

    state = {
      ...state,
      serverVersion: details.latestVersion || state.serverVersion,
      minSupportedVersion: details.minSupportedVersion || state.minSupportedVersion,
      minSupportedNativeBuild: minBuild,
      apkUrl: details.apkUrl || state.apkUrl,
      isUpdateAvailable: true,
      isForceUpdate: true,
      isNativeUpdateRequired: isNativeRequired,
      lastChecked: Date.now(),
    };
    notifyListeners();
  });

  // 2. Service worker detected new assets in background
  window.addEventListener('apollo:pwa-update-available', () => {
    state = {
      ...state,
      isUpdateAvailable: true,
    };
    notifyListeners();
  });

  // 3. Tab visibility check
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const fiveMinutes = 5 * 60 * 1000;
      if (!state.lastChecked || Date.now() - state.lastChecked > fiveMinutes) {
        checkForUpdates().catch(() => {});
      }
    }
  });

  // 4. Initial check after boot (delay to not interfere with critical startup)
  setTimeout(() => {
    checkForUpdates().catch(() => {});
  }, 2500);

  // 5. Periodic check every 15 minutes
  setInterval(() => {
    checkForUpdates().catch(() => {});
  }, 15 * 60 * 1000);
}
