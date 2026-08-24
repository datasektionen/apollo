import { afterEach, describe, expect, it } from 'vitest';
import {
  dismissLoadProgress,
  finishLoadProgress,
  formatLoadBytes,
  formatLoadDuration,
  getLoadProgress,
  isLoadProgressRunning,
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
        await new Promise((resolve) => setTimeout(resolve, 5));
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
});
