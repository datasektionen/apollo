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
import { dismissLoadProgress, finishLoadProgress } from '../loadProgress';

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
