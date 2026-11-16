import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isPwaInstallable,
  isStandalone,
  promptPwaInstall,
  registerServiceWorker,
  subscribePwaInstall,
} from '../pwa';

describe('PWA Lifecycle & Installability', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('detects standalone mode correctly across matchMedia and navigator', () => {
    // Default in jsdom
    expect(isStandalone()).toBe(false);

    // Mock matchMedia for standalone
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn((query) => ({
      matches: query.includes('display-mode: standalone'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    expect(isStandalone()).toBe(true);
    window.matchMedia = originalMatchMedia;
  });

  it('handles beforeinstallprompt event and notifies subscribers', async () => {
    let capturedState = null;
    const unsub = subscribePwaInstall((state) => {
      capturedState = state;
    });

    expect(capturedState).toBeDefined();
    expect(isPwaInstallable()).toBe(false);

    const mockPromptEvent = new Event('beforeinstallprompt');
    mockPromptEvent.prompt = vi.fn().mockResolvedValue(undefined);
    mockPromptEvent.userChoice = Promise.resolve({ outcome: 'accepted' });

    window.dispatchEvent(mockPromptEvent);

    expect(isPwaInstallable()).toBe(true);
    expect(capturedState.isInstallable).toBe(true);

    // Prompt install
    const result = await promptPwaInstall();
    expect(mockPromptEvent.prompt).toHaveBeenCalled();
    expect(result.outcome).toBe('accepted');
    expect(isPwaInstallable()).toBe(false);

    unsub();
  });

  it('registers service worker when supported', async () => {
    const mockRegistration = {
      addEventListener: vi.fn(),
      installing: null,
    };

    const registerMock = vi.fn().mockResolvedValue(mockRegistration);
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: registerMock,
        controller: null,
      },
      writable: true,
      configurable: true,
    });

    const reg = await registerServiceWorker();
    expect(registerMock).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    expect(reg).toBe(mockRegistration);
  });
});
