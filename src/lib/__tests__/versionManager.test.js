import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyUpdate,
  checkForUpdates,
  compareVersions,
  getVersionState,
  subscribeVersionStatus,
} from '../versionManager';
import * as serverApi from '../serverApi';

describe('Version Manager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('correctly compares semantic versions', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0.0')).toBe(1);
    expect(compareVersions('1.1.0', '1.0.9')).toBe(1);
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1);
  });

  it('detects when an update is available (soft update)', async () => {
    vi.spyOn(serverApi, 'fetchServerVersion').mockResolvedValue({
      version: '1.2.0',
      minSupportedVersion: '1.0.0',
      minSupportedNativeBuild: 1,
      apkUrl: '/apollo.apk',
      releaseNotes: 'Performance improvements',
    });

    const status = await checkForUpdates();
    expect(status.isUpdateAvailable).toBe(true);
    expect(status.isForceUpdate).toBe(false);
    expect(status.serverVersion).toBe('1.2.0');
  });

  it('detects when a force update is required', async () => {
    vi.spyOn(serverApi, 'fetchServerVersion').mockResolvedValue({
      version: '2.0.0',
      minSupportedVersion: '2.0.0',
      minSupportedNativeBuild: 2,
      apkUrl: '/apollo.apk',
      releaseNotes: 'Major breaking upgrade',
    });

    const status = await checkForUpdates();
    expect(status.isUpdateAvailable).toBe(true);
    expect(status.isForceUpdate).toBe(true);
  });

  it('handles upgrade-required window event immediately', () => {
    let captured = null;
    const unsub = subscribeVersionStatus((state) => {
      captured = state;
    });

    window.dispatchEvent(
      new CustomEvent('apollo:upgrade-required', {
        detail: {
          latestVersion: '2.1.0',
          minSupportedVersion: '2.0.0',
          apkUrl: '/apollo-latest.apk',
        },
      })
    );

    expect(captured.isForceUpdate).toBe(true);
    expect(captured.isUpdateAvailable).toBe(true);
    expect(captured.serverVersion).toBe('2.1.0');

    unsub();
  });

  it('handles service worker update available event', () => {
    let captured = null;
    const unsub = subscribeVersionStatus((state) => {
      captured = state;
    });

    window.dispatchEvent(new CustomEvent('apollo:pwa-update-available'));
    expect(captured.isUpdateAvailable).toBe(true);

    unsub();
  });

  it('distinguishes OTA updates from native APK updates', async () => {
    window.Capacitor = { isNativePlatform: () => true };
    try {
      // 1. Web version is newer, but native build is still supported -> OTA update
      vi.spyOn(serverApi, 'fetchServerVersion').mockResolvedValue({
        version: '1.2.0',
        minSupportedVersion: '1.0.0',
        minSupportedNativeBuild: 1, // Current build is 1
        apkUrl: '/apollo.apk',
      });

      const otaStatus = await checkForUpdates();
      expect(otaStatus.isUpdateAvailable).toBe(true);
      expect(otaStatus.isNativeUpdateRequired).toBe(false);

      // 2. Server requires a newer native build -> Native APK update required
      vi.spyOn(serverApi, 'fetchServerVersion').mockResolvedValue({
        version: '1.2.0',
        minSupportedVersion: '1.0.0',
        minSupportedNativeBuild: 99, // Current build is < 99
        apkUrl: '/apollo.apk',
      });

      const nativeStatus = await checkForUpdates();
      expect(nativeStatus.isUpdateAvailable).toBe(true);
      expect(nativeStatus.isForceUpdate).toBe(true);
      expect(nativeStatus.isNativeUpdateRequired).toBe(true);
    } finally {
      delete window.Capacitor;
    }
  });

  it('applyUpdate performs OTA reload when isNativeUpdateRequired is false on native', async () => {
    window.Capacitor = { isNativePlatform: () => true };
    const reloadMock = vi.fn();
    delete window.location;
    window.location = { reload: reloadMock };

    vi.spyOn(serverApi, 'fetchServerVersion').mockResolvedValue({
      version: '1.2.0',
      minSupportedVersion: '1.0.0',
      minSupportedNativeBuild: 1,
      apkUrl: '/apollo.apk',
    });

    await checkForUpdates();
    await applyUpdate();

    // Verify it reloaded the page (OTA) without creating an APK download link
    expect(reloadMock).toHaveBeenCalled();
    delete window.Capacitor;
  });
});
