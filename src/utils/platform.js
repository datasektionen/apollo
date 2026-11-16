/**
 * Device and Platform Detection Utilities for Apollo Distribution
 */

export function detectBrowser() {
  if (typeof window === 'undefined') return 'unknown';
  const ua = window.navigator?.userAgent || '';
  if (/Firefox\/|FxiOS\//i.test(ua)) return 'firefox';
  if (/Edg\//i.test(ua)) return 'edge';
  if (/Chrome\/|CriOS\//i.test(ua)) return 'chrome';
  if (/Safari/i.test(ua) && !/Chrome\/|CriOS\//i.test(ua)) return 'safari';
  return 'other';
}

export function detectPlatform() {
  if (typeof window === 'undefined') {
    return {
      os: 'web',
      name: 'Web Browser',
      isMobile: false,
      isDesktop: false,
      recommendedBuild: 'web',
      browser: 'unknown',
    };
  }

  const ua = window.navigator?.userAgent || '';
  const platform = window.navigator?.platform || '';
  const maxTouchPoints = window.navigator?.maxTouchPoints || 0;
  const browser = detectBrowser();

  // 1. Android
  if (/Android/i.test(ua)) {
    return {
      os: 'android',
      name: 'Android',
      isMobile: true,
      isDesktop: false,
      recommendedBuild: 'apk',
      apkUrl: '/apollo.apk',
      browser,
    };
  }

  // 2. iOS / iPadOS
  const isIOS =
    /iPhone|iPod/i.test(ua) ||
    /iPad/i.test(ua) ||
    (platform === 'MacIntel' && maxTouchPoints > 1);

  if (isIOS) {
    return {
      os: 'ios',
      name: 'iPhone / iPad',
      isMobile: true,
      isDesktop: false,
      recommendedBuild: 'pwa',
      browser,
    };
  }

  // 3. macOS
  if (/Macintosh|MacIntel|MacPPC|Mac68K/i.test(ua) || /Mac OS X/i.test(ua)) {
    return {
      os: 'macos',
      name: 'macOS',
      isMobile: false,
      isDesktop: true,
      recommendedBuild: 'pwa',
      browser,
    };
  }

  // 4. Windows
  if (/Win32|Win64|Windows|WinCE/i.test(ua)) {
    return {
      os: 'windows',
      name: 'Windows',
      isMobile: false,
      isDesktop: true,
      recommendedBuild: 'pwa',
      browser,
    };
  }

  // 5. Linux
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) {
    return {
      os: 'linux',
      name: 'Linux',
      isMobile: false,
      isDesktop: true,
      recommendedBuild: 'pwa',
      browser,
    };
  }

  // 6. Generic Web
  return {
    os: 'web',
    name: 'Web Browser',
    isMobile: false,
    isDesktop: false,
    recommendedBuild: 'web',
    browser,
  };
}

export function isStandaloneApp() {
  if (typeof window === 'undefined') return false;
  // Capacitor Android app
  if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) {
    return true;
  }
  // Standalone PWA
  try {
    return Boolean(
      (typeof window.matchMedia === 'function' && (
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
