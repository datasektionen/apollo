import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ensureStemInMediaCache,
  loadStemsIntoMediaCache,
  mapPool,
  resetLocalPcmPersistForTests,
} from '../loadStemAudio';
import {
  audioBufferFromPlanarPcm,
  audioBufferToPlanarPcmBlob,
  persistAudioBufferAsLocalPcm,
} from '../mediaEncoding';
import { dismissLoadProgress, finishLoadProgress, getLoadProgress, startLoadProgress } from '../loadProgress';

afterEach(() => {
  resetLocalPcmPersistForTests();
  finishLoadProgress();
  dismissLoadProgress();
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakeAudioBuffer({ channels = 1, frames = 10, sampleRate = 48000 } = {}) {
  const channelData = Array.from({ length: channels }, (_, channel) => {
    const samples = new Float32Array(frames);
    for (let i = 0; i < frames; i += 1) {
      samples[i] = ((channel + 1) * (i + 1)) / 100;
    }
    return samples;
  });
  return {
    sampleRate,
    duration: frames / sampleRate,
    numberOfChannels: channels,
    length: frames,
    getChannelData: (channel) => channelData[channel],
  };
}

function createBuffer(channels, frames, sampleRate) {
  const channelData = Array.from({ length: channels }, () => new Float32Array(frames));
  return {
    numberOfChannels: channels,
    length: frames,
    sampleRate,
    duration: frames / sampleRate,
    getChannelData: (channel) => channelData[channel],
  };
}

function fakeRemoteBlob(byteLength = 8) {
  return {
    size: byteLength,
    arrayBuffer: async () => new ArrayBuffer(byteLength),
  };
}

describe('mapPool', () => {
  it('caps concurrency', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapPool([1, 2, 3, 4, 5, 6], async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(20);
      inFlight -= 1;
    }, { concurrency: 2 });
    expect(maxInFlight).toBe(2);
  });

  it('stops starting new work after cancel', async () => {
    let started = 0;
    let cancelled = false;
    await expect(mapPool(
      [1, 2, 3, 4, 5, 6],
      async () => {
        started += 1;
        if (started >= 2) cancelled = true;
        await delay(15);
      },
      { concurrency: 2, isCancelled: () => cancelled }
    )).rejects.toMatchObject({ name: 'StaleAudioLoad' });
    expect(started).toBeLessThanOrEqual(4);
  });
});

describe('ensureStemInMediaCache', () => {
  it('skips download on RAM cache hit', async () => {
    const blobId = 'stem-ram';
    const mediaCache = new Map([[blobId, fakeAudioBuffer()]]);
    const download = vi.fn();
    const getMediaBlob = vi.fn();
    const result = await ensureStemInMediaCache({
      blobId,
      mediaCache,
      getMediaBlob,
      download,
    });
    expect(result.source).toBe('ram');
    expect(download).not.toHaveBeenCalled();
    expect(getMediaBlob).not.toHaveBeenCalled();
  });

  it('returns a decoded buffer before persist encode or storeMediaBlob start', async () => {
    const blobId = 'stem-cold';
    const mediaCache = new Map();
    const audioBuffer = fakeAudioBuffer();
    const storeMediaBlob = vi.fn(async () => {});
    const getMediaBlob = vi.fn(async () => {
      throw new Error('Media blob not found');
    });
    const download = vi.fn(async () => fakeRemoteBlob(16));
    const decodeAudioFile = vi.fn(async () => audioBuffer);

    const result = await ensureStemInMediaCache({
      blobId,
      mediaCache,
      getMediaBlob,
      download,
      decodeAudioFile,
      storeMediaBlob,
      deferPersist: true,
    });
    expect(result.audioBuffer).toBe(audioBuffer);
    expect(mediaCache.get(blobId)).toBe(audioBuffer);
    expect(storeMediaBlob).not.toHaveBeenCalled();
  });

  it('logs a local cache miss as a fallback when download is available', async () => {
    startLoadProgress({ kind: 'play', title: 'Song', verbose: true });
    const blobId = 'stem-cold';
    await ensureStemInMediaCache({
      blobId,
      mediaCache: new Map(),
      getMediaBlob: async () => {
        throw new Error(`Media blob ${blobId} not found`);
      },
      download: async () => fakeRemoteBlob(16),
      decodeAudioFile: async () => fakeAudioBuffer(),
      storeMediaBlob: async () => {},
      deferPersist: true,
    });

    const logs = getLoadProgress().logs;
    const lookup = logs.find((entry) => entry.level === 'warn' && String(entry.message).includes('IndexedDB lookup'));
    expect(lookup.message).toContain('not cached locally');
    expect(logs.some((entry) => entry.level === 'error')).toBe(false);
  });

  it('keeps a local cache miss as an error when there is no download path', async () => {
    startLoadProgress({ kind: 'open', title: 'Song', verbose: true });
    await expect(ensureStemInMediaCache({
      blobId: 'stem-offline',
      mediaCache: new Map(),
      getMediaBlob: async () => {
        throw new Error('Media blob stem-offline not found');
      },
    })).rejects.toThrow('Media blob stem-offline not found');

    const lookup = getLoadProgress().logs.find((entry) => (
      entry.level === 'error' && String(entry.message).includes('IndexedDB lookup')
    ));
    expect(lookup).toBeTruthy();
  });
});

describe('loadStemsIntoMediaCache persist deferral', () => {
  it('does not persist until after the load batch yields to the event loop', async () => {
    const blobId = 'stem-batch';
    const audioBuffer = fakeAudioBuffer();
    const storeMediaBlob = vi.fn(async () => {});
    await loadStemsIntoMediaCache([blobId], {
      mediaCache: new Map(),
      getMediaBlob: async () => {
        throw new Error('Media blob not found');
      },
      download: async () => fakeRemoteBlob(16),
      decodeAudioFile: async () => audioBuffer,
      storeMediaBlob,
    });
    expect(storeMediaBlob).not.toHaveBeenCalled();
    await delay(30);
    expect(storeMediaBlob).toHaveBeenCalledTimes(1);
  });
});

describe('play request progress bars', () => {
  it('does not open a dialog or touch device storage when every stem is already cached', async () => {
    startLoadProgress({ kind: 'play', title: 'Song' });
    const probe = vi.fn();
    const getMediaBlob = vi.fn();
    await loadStemsIntoMediaCache(['ram'], {
      mediaCache: new Map([['ram', fakeAudioBuffer()]]),
      probeStoredBlobIds: probe,
      getMediaBlob,
    });
    expect(probe).not.toHaveBeenCalled();
    expect(getMediaBlob).not.toHaveBeenCalled();
    expect(getLoadProgress().visible).toBe(false);
    expect(getLoadProgress().stems).toMatchObject({ cached: 1, total: 1 });
  });

  it('counts cached, device, downloaded, and converted stems separately', async () => {
    startLoadProgress({ kind: 'play', title: 'Song' });
    const probe = vi.fn(async (ids) => ids.filter((id) => id === 'local'));
    let stemsAtDownloadStart = null;
    await loadStemsIntoMediaCache(['ram', 'local', 'remote'], {
      mediaCache: new Map([['ram', fakeAudioBuffer()]]),
      probeStoredBlobIds: probe,
      getMediaBlob: async (id) => {
        if (id !== 'local') throw new Error(`Media blob ${id} not found`);
        return {
          fileName: 'local.apcm',
          blob: { size: 4, type: 'application/x-apollo-planar-pcm' },
        };
      },
      loadAudioBuffer: async () => fakeAudioBuffer(),
      download: async () => {
        stemsAtDownloadStart = { ...getLoadProgress().stems };
        return fakeRemoteBlob(8);
      },
      decodeAudioFile: async () => fakeAudioBuffer(),
      storeMediaBlob: async () => {},
    });

    expect(probe).toHaveBeenCalledWith(['local', 'remote']);
    expect(stemsAtDownloadStart.fetched).toBe(0);
    expect(stemsAtDownloadStart.converted).toBe(0);
    expect(getLoadProgress().visible).toBe(true);
    expect(getLoadProgress().stems).toMatchObject({
      total: 3,
      cached: 1,
      idbTotal: 1,
      idbLoaded: 1,
      fetchTotal: 1,
      fetched: 1,
      convertTotal: 1,
      converted: 1,
      serverCached: 1,
    });
  });

  it('moves a stem the device lookup cannot read onto the download bars', async () => {
    startLoadProgress({ kind: 'play', title: 'Song' });
    await loadStemsIntoMediaCache(['missing'], {
      mediaCache: new Map(),
      probeStoredBlobIds: async () => ['missing'],
      getMediaBlob: async () => {
        throw new Error('Media blob missing not found');
      },
      download: async () => fakeRemoteBlob(),
      decodeAudioFile: async () => fakeAudioBuffer(),
      storeMediaBlob: async () => {},
    });
    expect(getLoadProgress().stems).toMatchObject({
      idbTotal: 0,
      idbLoaded: 0,
      fetchTotal: 1,
      fetched: 1,
      convertTotal: 1,
      converted: 1,
      serverCached: 1,
    });
  });

  it('uses one loading bar when the device lookup fails', async () => {
    startLoadProgress({ kind: 'play', title: 'Song' });
    await loadStemsIntoMediaCache(['remote'], {
      mediaCache: new Map(),
      probeStoredBlobIds: async () => {
        throw new Error('idb blocked');
      },
      getMediaBlob: async () => {
        throw new Error('nope');
      },
      download: async () => fakeRemoteBlob(),
      decodeAudioFile: async () => fakeAudioBuffer(),
      storeMediaBlob: async () => {},
    });
    expect(getLoadProgress().stems).toMatchObject({
      classified: false,
      pendingTotal: 1,
      pendingLoaded: 1,
      fetchTotal: 0,
    });
  });

  it('does not paint an older load onto a newer play request', async () => {
    const firstId = startLoadProgress({ kind: 'play', title: 'First' });
    let releaseProbe;
    const probe = vi.fn(() => new Promise((resolve) => {
      releaseProbe = resolve;
    }));
    const load = loadStemsIntoMediaCache(['remote'], {
      mediaCache: new Map(),
      probeStoredBlobIds: probe,
      getMediaBlob: async () => {
        throw new Error('nope');
      },
      download: async () => fakeRemoteBlob(),
      decodeAudioFile: async () => fakeAudioBuffer(),
      storeMediaBlob: async () => {},
    });
    await vi.waitFor(() => expect(probe).toHaveBeenCalled());
    const secondId = startLoadProgress({ kind: 'play', title: 'Second' });
    releaseProbe([]);
    await load;
    const session = getLoadProgress();
    expect(session.id).toBe(secondId);
    expect(session.id).not.toBe(firstId);
    expect(session.visible).toBe(false);
    expect(session.stems.total).toBe(0);
  });

  it('still reports stem progress for an open request', async () => {
    startLoadProgress({ kind: 'open', title: 'Song', verbose: true });
    const blobId = 'stem-ram';
    await loadStemsIntoMediaCache([blobId], {
      mediaCache: new Map([[blobId, fakeAudioBuffer()]]),
      getMediaBlob: vi.fn(),
    });
    expect(getLoadProgress().presentation).toBe('log');
    expect(getLoadProgress().stemIndex).toBe(1);
    expect(getLoadProgress().stemTotal).toBe(1);
    expect(getLoadProgress().visible).toBe(true);
  });
});

describe('persistAudioBufferAsLocalPcm', () => {
  it('does not throw when IndexedDB persist fails', async () => {
    const result = await persistAudioBufferAsLocalPcm({
      blobId: 'stem-fail',
      audioBuffer: fakeAudioBuffer(),
      storeMediaBlob: async () => {
        throw new Error('quota exceeded');
      },
    });
    expect(result.storedLocally).toBe(false);
    expect(result.storeError).toBeInstanceOf(Error);
  });
});

describe('planar PCM memcpy', () => {
  it('round-trips channel data without decodeAudioData', async () => {
    const original = fakeAudioBuffer({ channels: 2, frames: 8, sampleRate: 44100 });
    const blob = audioBufferToPlanarPcmBlob(original);
    const arrayBuffer = await blob.arrayBuffer();
    const restored = audioBufferFromPlanarPcm(arrayBuffer, createBuffer);
    expect(restored.numberOfChannels).toBe(2);
    expect(restored.sampleRate).toBe(44100);
    expect(restored.length).toBe(8);
    expect(Array.from(restored.getChannelData(0))).toEqual(Array.from(original.getChannelData(0)));
    expect(Array.from(restored.getChannelData(1))).toEqual(Array.from(original.getChannelData(1)));
  });
});
