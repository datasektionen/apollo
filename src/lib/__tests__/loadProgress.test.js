import { afterEach, describe, expect, it } from 'vitest';
import {
  dismissLoadProgress,
  finishLoadProgress,
  formatLoadBytes,
  formatLoadDuration,
  formatLoadProgressText,
  getLoadProgress,
  isLoadProgressRunning,
  loadLogLevelPrefix,
  logLoadProgress,
  startLoadProgress,
  summarizeProjectForLoadLog,
  withLoadStep,
} from '../loadProgress';

afterEach(() => {
  dismissLoadProgress();
  finishLoadProgress();
});

describe('loadProgress tracker', () => {
  it('records nested step timings and byte sizes', async () => {
    startLoadProgress({ kind: 'play', title: 'Tutti', detail: 'mix-1' });
    expect(isLoadProgressRunning()).toBe(true);

    const blob = await withLoadStep(
      'Download compressed file',
      async () => ({ size: 2048 }),
      {
        depth: 1,
        bytesFrom: (value) => value.size,
      }
    );
    expect(blob.size).toBe(2048);

    await withLoadStep(
      'Decode compressed audio',
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return 'ok';
      },
      { depth: 2 }
    );

    logLoadProgress('IndexedDB miss (stem-1)', { depth: 1 });
    summarizeProjectForLoadLog({
      tracks: [
        { clips: [{ blobId: 'a' }, { blobId: 'a' }] },
        { clips: [{ blobId: 'b' }] },
      ],
    }, 'Playback mix snapshot');

    finishLoadProgress();

    const session = getLoadProgress();
    expect(session.status).toBe('done');
    expect(session.visible).toBe(true);
    const messages = session.logs.map((entry) => entry.message);
    expect(messages.some((message) => message.includes('Download compressed file'))).toBe(true);
    expect(messages.some((message) => message.includes('Playback mix snapshot: 2 tracks, 3 clips, 2 unique stems'))).toBe(true);
    const downloadOk = session.logs.find((entry) => entry.level === 'ok' && entry.message === 'Download compressed file');
    expect(downloadOk.bytes).toBe(2048);
    expect(downloadOk.durationMs).toBeGreaterThanOrEqual(0);
    const decodeOk = session.logs.find((entry) => entry.level === 'ok' && entry.message === 'Decode compressed audio');
    expect(decodeOk.durationMs).toBeGreaterThanOrEqual(5);
  });

  it('does not time steps after the session finishes', async () => {
    startLoadProgress({ kind: 'open', title: 'Song' });
    finishLoadProgress();
    const before = getLoadProgress().logs.length;
    await withLoadStep('Should be silent', async () => 'ok');
    logLoadProgress('also silent');
    expect(getLoadProgress().logs.length).toBe(before);
    expect(isLoadProgressRunning()).toBe(false);
  });

  it('formats durations and bytes', () => {
    expect(formatLoadDuration(0.4)).toBe('<1ms');
    expect(formatLoadDuration(12)).toBe('12ms');
    expect(formatLoadDuration(1500)).toBe('1.50s');
    expect(formatLoadBytes(500)).toBe('500 B');
    expect(formatLoadBytes(2048)).toBe('2.0 KB');
    expect(formatLoadBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });

  it('formats a session as copyable text', () => {
    startLoadProgress({ kind: 'play', title: 'Tutti', detail: 'mix-1' });
    logLoadProgress('IndexedDB miss (stem-1)', { depth: 1 });
    finishLoadProgress();
    const text = formatLoadProgressText(getLoadProgress());
    expect(text).toContain('Play request: Tutti');
    expect(text).toContain('Detail: mix-1');
    expect(text).toContain('Status: done');
    expect(text).toContain('IndexedDB miss (stem-1)');
    expect(text).toContain('Finished in');
  });

  it('can log an expected fallback without treating it as an error', async () => {
    startLoadProgress({ kind: 'play', title: 'Tutti' });
    await expect(withLoadStep(
      'IndexedDB lookup (stem-1)',
      async () => {
        throw new Error('Media blob stem-1 not found');
      },
      {
        depth: 1,
        failureLevel: 'warn',
        formatFailure: (_error, label) => `${label}: not cached locally`,
      }
    )).rejects.toThrow('Media blob stem-1 not found');

    const lookup = getLoadProgress().logs.find((entry) => entry.level === 'warn');
    expect(lookup.message).toBe('IndexedDB lookup (stem-1): not cached locally');
    expect(loadLogLevelPrefix('warn')).toBe('alt');
    expect(formatLoadProgressText(getLoadProgress())).toContain('alt  IndexedDB lookup (stem-1): not cached locally');
  });
});
