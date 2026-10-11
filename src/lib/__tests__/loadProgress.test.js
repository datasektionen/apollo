import { afterEach, describe, expect, it } from 'vitest';
import {
  beginPlayStemProgress,
  dismissLoadProgress,
  finishLoadProgress,
  formatLoadBytes,
  formatLoadDuration,
  formatLoadProgressText,
  getLoadProgress,
  isLoadProgressRunning,
  loadLogLevelPrefix,
  logLoadProgress,
  readServerPipeline,
  reportPlayStemEvent,
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
    startLoadProgress({ kind: 'play', title: 'Tutti', detail: 'mix-1', verbose: true });
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
    startLoadProgress({ kind: 'open', title: 'Song', verbose: true });
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
    startLoadProgress({ kind: 'play', title: 'Tutti', detail: 'mix-1', verbose: true });
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
    startLoadProgress({ kind: 'play', title: 'Tutti', verbose: true });
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

describe('play progress bars', () => {
  it('stays hidden until some stems are not cached', () => {
    startLoadProgress({ kind: 'play', title: 'Tutti' });
    expect(getLoadProgress().visible).toBe(false);
    expect(getLoadProgress().logs).toEqual([]);

    beginPlayStemProgress({
      total: 4,
      cached: 4,
      classified: true,
      idbTotal: 0,
      fetchTotal: 0,
    });
    expect(getLoadProgress().visible).toBe(false);

    beginPlayStemProgress({
      total: 20,
      cached: 5,
      classified: true,
      idbTotal: 8,
      fetchTotal: 7,
    });
    const stems = getLoadProgress().stems;
    expect(getLoadProgress().visible).toBe(true);
    expect(stems.cached).toBe(5);
    expect(stems.total).toBe(20);
    expect(stems.idbTotal).toBe(8);
    expect(stems.fetchTotal).toBe(7);
    expect(stems.convertTotal).toBe(7);
  });

  it('does not record the technical log unless verbose mode is on', async () => {
    startLoadProgress({ kind: 'play', title: 'Tutti' });
    await withLoadStep('Download compressed file', async () => 'ok');
    logLoadProgress('IndexedDB miss');
    expect(getLoadProgress().logs).toEqual([]);
  });

  it('moves a missed device stem onto the fetch bars', () => {
    const sessionId = startLoadProgress({ kind: 'play', title: 'Tutti' });
    beginPlayStemProgress({
      total: 2,
      cached: 0,
      classified: true,
      idbTotal: 1,
      fetchTotal: 1,
    }, sessionId);
    reportPlayStemEvent('idb-missed', sessionId);
    reportPlayStemEvent('fetched', sessionId);
    reportPlayStemEvent('converted', sessionId);
    reportPlayStemEvent('fetched', 'other-session');
    const stems = getLoadProgress().stems;
    expect(stems.idbTotal).toBe(0);
    expect(stems.fetchTotal).toBe(2);
    expect(stems.fetched).toBe(1);
    expect(stems.converted).toBe(1);
    expect(stems.convertTotal).toBe(2);
  });

  it('keeps a finished dialog open until it is dismissed', () => {
    const sessionId = startLoadProgress({ kind: 'play', title: 'Tutti' });
    beginPlayStemProgress({
      total: 2,
      cached: 0,
      classified: true,
      idbTotal: 2,
      fetchTotal: 0,
    }, sessionId);
    expect(getLoadProgress().visible).toBe(true);
    finishLoadProgress(null, sessionId);
    expect(getLoadProgress().visible).toBe(true);
    expect(getLoadProgress().status).toBe('done');
    dismissLoadProgress();
    expect(getLoadProgress().visible).toBe(false);

    const warmId = startLoadProgress({ kind: 'open', title: 'Song' });
    beginPlayStemProgress({
      total: 4,
      cached: 4,
      classified: true,
      idbTotal: 0,
      fetchTotal: 0,
    }, warmId);
    finishLoadProgress(null, warmId);
    expect(getLoadProgress().visible).toBe(false);
    expect(getLoadProgress().status).toBe('done');

    const failedId = startLoadProgress({ kind: 'play', title: 'Tutti' });
    beginPlayStemProgress({
      total: 1,
      cached: 0,
      classified: true,
      idbTotal: 1,
      fetchTotal: 0,
    }, failedId);
    finishLoadProgress(new Error('decode failed'), failedId);
    expect(getLoadProgress().visible).toBe(true);
    expect(getLoadProgress().error).toBe('decode failed');
  });

  it('counts convert idle while downloads run and convert busy once decoding starts', () => {
    const sessionId = startLoadProgress({ kind: 'play', title: 'Tutti' });
    beginPlayStemProgress({
      total: 2,
      cached: 0,
      classified: true,
      idbTotal: 0,
      fetchTotal: 2,
    }, sessionId);
    const startedAt = getLoadProgress().stems.pipelineMarkAt;
    reportPlayStemEvent('download-start', sessionId, startedAt + 400);
    expect(getLoadProgress().stems.convertIdleMs).toBe(400);
    expect(getLoadProgress().stems.activeDownloads).toBe(1);
    const whileDownloading = readServerPipeline(getLoadProgress().stems, startedAt + 700);
    expect(whileDownloading.downloadBusyMs).toBe(300);
    expect(whileDownloading.convertIdleMs).toBe(700);
    expect(getLoadProgress().stems.downloadBusyMs).toBe(0);

    reportPlayStemEvent('fetched', sessionId, startedAt + 900);
    reportPlayStemEvent('convert-start', sessionId, startedAt + 900);
    reportPlayStemEvent('converted', sessionId, startedAt + 1200);
    reportPlayStemEvent('server-cached', sessionId, startedAt + 1200);
    const stems = getLoadProgress().stems;
    expect(stems.downloadBusyMs).toBe(500);
    expect(stems.convertBusyMs).toBe(300);
    expect(stems.fetched).toBe(1);
    expect(stems.converted).toBe(1);
    expect(stems.serverCached).toBe(1);
    expect(stems.activeDownloads).toBe(0);
    expect(stems.activeConverts).toBe(0);
  });

  it('hides a play failure that happened before any audio dialog', () => {
    const sessionId = startLoadProgress({ kind: 'play', title: 'Tutti' });
    finishLoadProgress(new Error('snapshot missing'), sessionId);
    expect(getLoadProgress().visible).toBe(false);
    expect(getLoadProgress().status).toBe('error');
  });
});
