import {
  PLANAR_PCM_EXTENSION,
  PLANAR_PCM_MIME_TYPE,
  decodeRemoteBlobToAudioBuffer,
  persistAudioBufferAsLocalPcm,
} from './mediaEncoding';
import {
  logLoadProgress,
  shortLoadId,
  updateLoadProgress,
  withLoadStep,
} from './loadProgress';

export const STEM_LOAD_CONCURRENCY = 4;

const pendingLocalPersists = [];
let persistFlushTimer = null;
let persistDraining = false;

export function createStaleAudioLoadError() {
  const error = new Error('stale-audio-load');
  error.name = 'StaleAudioLoad';
  return error;
}

export function throwIfCancelled(isCancelled) {
  if (typeof isCancelled === 'function' && isCancelled()) {
    throw createStaleAudioLoadError();
  }
}

export function createEphemeralMediaEntry(blobId, fileName, audioBuffer, blob) {
  return {
    blobId,
    fileName,
    sampleRate: audioBuffer?.sampleRate,
    durationMs: (Number(audioBuffer?.duration) || 0) * 1000,
    channels: audioBuffer?.numberOfChannels,
    blob,
    createdAt: Date.now(),
  };
}

export async function mapPool(items, worker, {
  concurrency = STEM_LOAD_CONCURRENCY,
  isCancelled = null,
} = {}) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];

  const results = new Array(list.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(Number(concurrency) || STEM_LOAD_CONCURRENCY, list.length));

  async function runWorker() {
    while (true) {
      throwIfCancelled(isCancelled);
      const index = nextIndex;
      nextIndex += 1;
      if (index >= list.length) return;
      results[index] = await worker(list[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

function localPcmFileName(blobId, fileName = null) {
  return fileName || `${blobId}.${PLANAR_PCM_EXTENSION}`;
}

function isPlanarPcmMediaEntry(media) {
  const fileName = String(media?.fileName || '').toLowerCase();
  const mimeType = String(media?.blob?.type || '').toLowerCase();
  return fileName.endsWith(`.${PLANAR_PCM_EXTENSION}`)
    || mimeType === PLANAR_PCM_MIME_TYPE
    || mimeType.includes('planar-pcm');
}

async function drainLocalPcmPersistQueue() {
  if (persistDraining) return;
  persistDraining = true;
  try {
    while (pendingLocalPersists.length > 0) {
      const job = pendingLocalPersists.shift();
      try {
        const result = await persistAudioBufferAsLocalPcm(job);
        if (!result?.storedLocally && typeof job.onPersistFailed === 'function') {
          job.onPersistFailed(result?.storeError || new Error('Failed to persist downloaded media locally'), job.blobId);
        }
      } catch (error) {
        if (typeof job.onPersistFailed === 'function') {
          job.onPersistFailed(error, job.blobId);
        }
      }
    }
  } finally {
    persistDraining = false;
    if (pendingLocalPersists.length > 0) {
      flushLocalPcmPersistSoon();
    }
  }
}

export function enqueueLocalPcmPersist(job) {
  pendingLocalPersists.push(job);
}

export function resetLocalPcmPersistForTests() {
  pendingLocalPersists.length = 0;
  if (persistFlushTimer != null) {
    clearTimeout(persistFlushTimer);
    persistFlushTimer = null;
  }
  persistDraining = false;
}

export function flushLocalPcmPersistSoon() {
  if (persistFlushTimer != null) return;
  if (persistDraining) return;
  if (pendingLocalPersists.length === 0) return;
  persistFlushTimer = setTimeout(() => {
    persistFlushTimer = null;
    void drainLocalPcmPersistQueue();
  }, 0);
}

export function scheduleLocalPcmPersist({
  blobId,
  audioBuffer,
  storeMediaBlob,
  fileName = null,
  onPersistFailed = null,
  defer = false,
}) {
  enqueueLocalPcmPersist({
    blobId,
    audioBuffer,
    storeMediaBlob,
    fileName: localPcmFileName(blobId, fileName),
    onPersistFailed,
  });
  if (!defer) {
    flushLocalPcmPersistSoon();
  }
}

export async function ensureStemInMediaCache({
  blobId,
  mediaCache,
  getMediaBlob,
  loadAudioBuffer,
  decodeAudioFile,
  storeMediaBlob,
  download = null,
  isCancelled = null,
  needMediaEntry = false,
  onPersistFailed = null,
  deferPersist = false,
} = {}) {
  throwIfCancelled(isCancelled);

  if (mediaCache?.has(blobId)) {
    logLoadProgress(`RAM AudioBuffer cache hit (${shortLoadId(blobId)})`, {
      depth: 1,
      level: 'ok',
    });
    const audioBuffer = mediaCache.get(blobId);
    if (!needMediaEntry) {
      return { source: 'ram', audioBuffer, media: null };
    }
    try {
      const media = await withLoadStep(
        `IndexedDB metadata for media map (${shortLoadId(blobId)})`,
        async () => getMediaBlob(blobId),
        {
          depth: 1,
          bytesFrom: (entry) => entry?.blob?.size,
        }
      );
      throwIfCancelled(isCancelled);
      return { source: 'ram', audioBuffer, media };
    } catch (error) {
      if (error?.name === 'StaleAudioLoad') throw error;
      logLoadProgress(
        `RAM hit but IndexedDB metadata missing (${shortLoadId(blobId)}); using in-memory entry`,
        { depth: 1 }
      );
      return {
        source: 'ram',
        audioBuffer,
        media: createEphemeralMediaEntry(blobId, localPcmFileName(blobId), audioBuffer, null),
      };
    }
  }

  try {
    const media = await withLoadStep(
      `IndexedDB lookup (${shortLoadId(blobId)})`,
      async () => getMediaBlob(blobId),
      {
        depth: 1,
        bytesFrom: (entry) => entry?.blob?.size,
      }
    );
    throwIfCancelled(isCancelled);
    logLoadProgress(`IndexedDB hit (${shortLoadId(blobId)})`, { depth: 1, level: 'ok' });
    const audioBuffer = await withLoadStep(
      `Ensure AudioBuffer in RAM (${shortLoadId(blobId)})`,
      async () => loadAudioBuffer(blobId, media.blob),
      { depth: 1 }
    );
    throwIfCancelled(isCancelled);
    if (typeof storeMediaBlob === 'function' && !isPlanarPcmMediaEntry(media)) {
      scheduleLocalPcmPersist({
        blobId,
        audioBuffer,
        storeMediaBlob,
        fileName: localPcmFileName(blobId),
        onPersistFailed,
        defer: deferPersist,
      });
    }
    return { source: 'idb', audioBuffer, media };
  } catch (localError) {
    if (localError?.name === 'StaleAudioLoad') throw localError;
    logLoadProgress(
      `IndexedDB miss (${shortLoadId(blobId)}): ${localError?.message || localError}`,
      { depth: 1 }
    );
    if (typeof download !== 'function') {
      throw localError;
    }

    const remoteBlob = await withLoadStep(
      `Download compressed file (${shortLoadId(blobId)})`,
      async () => download(blobId),
      {
        depth: 1,
        bytesFrom: (blob) => blob?.size,
      }
    );
    throwIfCancelled(isCancelled);

    const audioBuffer = await withLoadStep(
      `Decode compressed audio for RAM (${shortLoadId(blobId)})`,
      async () => decodeRemoteBlobToAudioBuffer({
        blobId,
        remoteBlob,
        decodeAudioFile,
      }),
      { depth: 1 }
    );
    throwIfCancelled(isCancelled);
    mediaCache.set(blobId, audioBuffer);

    scheduleLocalPcmPersist({
      blobId,
      audioBuffer,
      storeMediaBlob,
      fileName: localPcmFileName(blobId),
      onPersistFailed,
      defer: deferPersist,
    });

    return {
      source: 'download',
      audioBuffer,
      media: createEphemeralMediaEntry(blobId, localPcmFileName(blobId), audioBuffer, remoteBlob),
    };
  }
}

export async function loadStemsIntoMediaCache(blobIds, options = {}) {
  const ids = Array.isArray(blobIds) ? blobIds : [];
  const {
    isCancelled = null,
    onStemComplete = null,
    onStemError = null,
  } = options;

  updateLoadProgress({
    phase: 'Audio',
    stemIndex: 0,
    stemTotal: ids.length,
    current: ids.length ? `Loading ${ids.length} stems…` : 'No stems to load',
  });

  let completed = 0;
  const audioBuffers = new Map();
  const mediaEntries = new Map();

  try {
    await mapPool(ids, async (blobId) => {
      throwIfCancelled(isCancelled);
      let result = null;
      try {
        result = await ensureStemInMediaCache({
          ...options,
          blobId,
          isCancelled,
          deferPersist: true,
        });
      } catch (error) {
        if (error?.name === 'StaleAudioLoad') throw error;
        if (typeof onStemError === 'function') {
          onStemError(error, blobId);
          completed += 1;
          updateLoadProgress({
            stemIndex: completed,
            stemTotal: ids.length,
            current: `Loaded ${completed}/${ids.length} stems`,
          });
          onStemComplete?.(completed, ids.length, blobId);
          return null;
        }
        throw error;
      }
      if (result?.audioBuffer) {
        audioBuffers.set(blobId, result.audioBuffer);
      }
      if (result?.media) {
        mediaEntries.set(blobId, result.media);
      }
      completed += 1;
      updateLoadProgress({
        stemIndex: completed,
        stemTotal: ids.length,
        current: `Loaded ${completed}/${ids.length} stems`,
      });
      onStemComplete?.(completed, ids.length, blobId);
      return result;
    }, {
      concurrency: options.concurrency,
      isCancelled,
    });
  } finally {
    flushLocalPcmPersistSoon();
  }

  return { audioBuffers, mediaEntries };
}
