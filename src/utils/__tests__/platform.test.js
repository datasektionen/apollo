import { beforeEach, describe, expect, it, vi } from 'vitest';
import { detectPlatform, isStandaloneApp } from '../platform';

describe('Platform Detection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('detects Android correctly', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
      configurable: true,
    });
    const platform = detectPlatform();
    expect(platform.os).toBe('android');
    expect(platform.isMobile).toBe(true);
    expect(platform.recommendedBuild).toBe('apk');
  });

  it('detects iPhone / iPad correctly', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      configurable: true,
    });
    const platform = detectPlatform();
    expect(platform.os).toBe('ios');
    expect(platform.isMobile).toBe(true);
    expect(platform.recommendedBuild).toBe('pwa');
  });

  it('detects modern iPad with MacIntel and touch points', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      configurable: true,
    });
    Object.defineProperty(window.navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    });
    Object.defineProperty(window.navigator, 'maxTouchPoints', {
      value: 5,
      configurable: true,
    });
    const platform = detectPlatform();
    expect(platform.os).toBe('ios');
    expect(platform.isMobile).toBe(true);
  });

  it('detects macOS desktop correctly', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      configurable: true,
    });
    Object.defineProperty(window.navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    });
    Object.defineProperty(window.navigator, 'maxTouchPoints', {
      value: 0,
      configurable: true,
    });
    const platform = detectPlatform();
    expect(platform.os).toBe('macos');
    expect(platform.isDesktop).toBe(true);
    expect(platform.recommendedBuild).toBe('pwa');
  });

  it('detects Windows correctly', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      configurable: true,
    });
    Object.defineProperty(window.navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });
    const platform = detectPlatform();
    expect(platform.os).toBe('windows');
    expect(platform.isDesktop).toBe(true);
  });

  it('detects Linux desktop correctly', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      configurable: true,
    });
    Object.defineProperty(window.navigator, 'platform', {
      value: 'Linux x86_64',
      configurable: true,
    });
    const platform = detectPlatform();
    expect(platform.os).toBe('linux');
    expect(platform.isDesktop).toBe(true);
    expect(platform.recommendedBuild).toBe('pwa');
  });

  it('identifies standalone app mode via matchMedia, standalone property, or Capacitor', () => {
    expect(isStandaloneApp()).toBe(false);

    window.matchMedia = vi.fn((q) => ({
      matches: q.includes('display-mode: standalone'),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
    expect(isStandaloneApp()).toBe(true);

    window.matchMedia = vi.fn(() => ({ matches: false }));
    window.Capacitor = {
      isNativePlatform: () => true,
    };
    expect(isStandaloneApp()).toBe(true);
    delete window.Capacitor;
  });
});
