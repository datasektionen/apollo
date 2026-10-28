import {
  getWaveformCache, putWaveformCache, deleteWaveformCache, touchWaveformCache,
} from './db';
import { WAVEFORM_SCHEMA_VERSION, validateWaveformPyramid, waveformByteLength, yieldWaveformTask } from './waveformData';

export const DEFAULT_WAVEFORM_DISK_BYTES = 128 * 1024 * 1024;

const validFingerprint = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const cacheKey = (fingerprint, baseBlockSize) => `waveform:${WAVEFORM_SCHEMA_VERSION}:${baseBlockSize}:${fingerprint}`;

/**
 * TRUST boundary: supplied by the local media owner, never inferred from blobId/PCM shape.
 * { waveformRevision: nonempty string | finite number, blobSize: integer >= 0, blobType: string }
 * or legacy { createdAt: finite number > 0, blobSize, blobType }.
 * The revision MUST change on media replacement or changed decode interpretation. A createdAt
 * token is safe only when the writer guarantees a distinct timestamp for every replacement.
 * blobSize/blobType are the persisted Blob's size/type, not decoded PCM bytes/codec guesses.
 */
export function normalizeWaveformRevision(revision) {
  if (!revision || typeof revision !== 'object' || !Number.isSafeInteger(revision.blobSize) || revision.blobSize < 0
    || typeof revision.blobType !== 'string' || revision.blobType.length > 256) return undefined;
  const token = revision.waveformRevision;
  if ((typeof token === 'string' && token.length > 0 && token.length <= 512)
    || (typeof token === 'number' && Number.isFinite(token))) {
    return JSON.stringify(['revision', token, revision.blobSize, revision.blobType]);
  }
  if (token == null && Number.isFinite(revision.createdAt) && revision.createdAt > 0) {
    return JSON.stringify(['createdAt', revision.createdAt, revision.blobSize, revision.blobType]);
  }
  return undefined;
}

function revisionIdentity(blobId, revision, metadata) {
  const normalized = normalizeWaveformRevision(revision);
  if (blobId == null || !normalized) return undefined;
  return JSON.stringify([String(blobId), normalized, metadata.sampleRate, metadata.length,
    metadata.numberOfChannels, metadata.baseBlockSize]);
}

/** Validate values and parent reductions in bounded tasks, not a synchronous whole-cache scan. */
export async function validatePersistedWaveform(pyramid, { signal, yieldControl = yieldWaveformTask } = {}) {
  if (!validateWaveformPyramid(pyramid)) return false;
  let work = 0;
  for (let c = 0; c < pyramid.channels.length; c += 1) {
    const levels = pyramid.channels[c].levels;
    let peak = 0;
    for (let l = 0; l < levels.length; l += 1) {
      const level = levels[l];
      const child = levels[l - 1];
      for (let i = 0; i < level.min.length; i += 1) {
        if (signal?.aborted) return false;
        const min = level.min[i];
        const max = level.max[i];
        const energy = level.sumSquares[i];
        if (!Number.isFinite(min) || !Number.isFinite(max) || min > max
          || !Number.isFinite(energy) || energy < 0) return false;
        const count = Math.min(level.blockSize, pyramid.length - i * level.blockSize);
        const peakSquare = Math.max(min * min, max * max);
        const minimumEnergy = min === max ? count * peakSquare : min * min + max * max;
        if (energy < minimumEnergy * (1 - 1e-8) || energy > count * peakSquare * (1 + 1e-8)) return false;
        if (l === 0) peak = Math.max(peak, Math.abs(min), Math.abs(max));
        if (child) {
          const left = i * 2;
          const right = Math.min(left + 1, child.min.length - 1);
          if (min !== Math.min(child.min[left], child.min[right])
            || max !== Math.max(child.max[left], child.max[right])
            || energy !== child.sumSquares[left] + (left === right ? 0 : child.sumSquares[right])) return false;
        }
        if (++work % 4096 === 0) await yieldControl();
      }
    }
    if (peak !== pyramid.channelPeaks[c]) return false;
  }
  return !signal?.aborted;
}

/** Cache errors are diagnostic only: derived data must never prevent source readiness. */
export function createWaveformPersistence({
  storage = { get: getWaveformCache, put: putWaveformCache, delete: deleteWaveformCache, touch: touchWaveformCache },
  maxBytes = DEFAULT_WAVEFORM_DISK_BYTES,
  yieldControl = yieldWaveformTask,
} = {}) {
  let disabled = false;
  const stats = { hits: 0, misses: 0, writes: 0, errors: 0, corrupt: 0, disabled: false };
  function failed() { stats.errors += 1; }
  async function read(key, metadata, matches, { signal } = {}) {
      if (signal?.aborted) return undefined;
      try {
        const row = await storage.get(key, { signal });
        if (signal?.aborted) return undefined;
        if (!row) { stats.misses += 1; return undefined; }
        const p = row.pyramid;
        if (row.schemaVersion !== WAVEFORM_SCHEMA_VERSION || !matches(row)
          || row.byteLength > maxBytes || !validateWaveformPyramid(p)
          || p.sampleRate !== metadata.sampleRate || p.length !== metadata.length
          || p.numberOfChannels !== metadata.numberOfChannels || p.baseBlockSize !== metadata.baseBlockSize
          || waveformByteLength(p) !== row.byteLength
          || !await validatePersistedWaveform(p, { signal, yieldControl })) {
          if (signal?.aborted) return undefined;
          stats.corrupt += 1;
          Promise.resolve(storage.delete(key)).catch(failed);
          return undefined;
        }
        if (signal?.aborted) return undefined;
        stats.hits += 1;
        // A failed access timestamp must not throw away an otherwise valid result.
        try { Promise.resolve(storage.touch(key, Date.now())).catch(failed); } catch { failed(); }
        return signal?.aborted ? undefined : p;
      } catch { if (!signal?.aborted) failed(); return undefined; }
  }
  async function write(key, identity, pyramid, { signal } = {}) {
      if (disabled || signal?.aborted || !validateWaveformPyramid(pyramid)) return false;
      const byteLength = waveformByteLength(pyramid);
      if (byteLength > maxBytes) return false;
      await yieldControl();
      if (signal?.aborted) return false;
      const record = {
        key, ...identity, schemaVersion: WAVEFORM_SCHEMA_VERSION,
        byteLength, lastAccess: Date.now(), pyramid,
      };
      try {
        const saved = await storage.put(record, maxBytes, { signal });
        if (saved !== false) stats.writes += 1;
        return saved !== false;
      } catch (error) {
        if (signal?.aborted) return false;
        failed();
        // Quota/private-mode failures should not trigger a write storm on every new source.
        if (/quota|security|invalidstate|unknown/i.test(error?.name || '')) disabled = true;
        return false;
      }
  }
  return {
    load(fingerprint, metadata, options) {
      if (!validFingerprint(fingerprint)) return Promise.resolve(undefined);
      return read(cacheKey(fingerprint, metadata.baseBlockSize), metadata, (row) => row.fingerprint === fingerprint, options);
    },
    save(fingerprint, pyramid, options) {
      if (!validFingerprint(fingerprint)) return Promise.resolve(false);
      return write(cacheKey(fingerprint, pyramid.baseBlockSize), { fingerprint }, pyramid, options);
    },
    async loadRevision(blobId, revision, metadata, options = {}) {
      // A recording may have reserved a coarser base for its maximum duration. Those summaries
      // remain exact and smaller than the requested allocation; find them without touching PCM.
      const maxBase = options.maxBaseBlockSize ?? metadata.baseBlockSize;
      if (!Number.isSafeInteger(metadata.baseBlockSize) || metadata.baseBlockSize < 1
        || Math.log2(metadata.baseBlockSize) % 1 !== 0 || !Number.isSafeInteger(maxBase)
        || maxBase < metadata.baseBlockSize || Math.log2(maxBase) % 1 !== 0) return undefined;
      for (let baseBlockSize = metadata.baseBlockSize; baseBlockSize <= maxBase; baseBlockSize *= 2) {
        if (options.signal?.aborted) return undefined;
        const candidate = { ...metadata, baseBlockSize };
        const identity = revisionIdentity(blobId, revision, candidate);
        if (!identity) return undefined;
        const result = await read(`waveform-revision:${WAVEFORM_SCHEMA_VERSION}:${identity}`, candidate,
          (row) => row.revisionIdentity === identity, options);
        if (result) return result;
      }
      return undefined;
    },
    saveRevision(blobId, revision, pyramid, options) {
      const identity = revisionIdentity(blobId, revision, pyramid);
      if (!identity) return Promise.resolve(false);
      return write(`waveform-revision:${WAVEFORM_SCHEMA_VERSION}:${identity}`, { revisionIdentity: identity }, pyramid, options);
    },
    getStats: () => ({ ...stats, disabled }),
    reset() { disabled = false; },
  };
}

export const waveformPersistence = createWaveformPersistence();
