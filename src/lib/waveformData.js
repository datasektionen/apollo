/** Rebuildable waveform format. Non-finite PCM is silence; finite over-range PCM is preserved. */
export const WAVEFORM_SCHEMA_VERSION = 1;
export const WAVEFORM_BASE_BLOCK_SIZE = 128;
export const WAVEFORM_CHUNK_SAMPLES = 16384;
export const DEFAULT_WAVEFORM_BYTES = 64 * 1024 * 1024;

let taskChannel;
const taskCallbacks = [];
/** Yield a task without the browser's nested-setTimeout 4 ms clamp on every PCM/cache chunk. */
export function yieldWaveformTask() {
  if (globalThis.scheduler?.yield) return globalThis.scheduler.yield();
  if (typeof MessageChannel === 'undefined') return new Promise((resolve) => setTimeout(resolve, 0));
  if (!taskChannel) {
    taskChannel = new MessageChannel();
    taskChannel.port1.onmessage = () => taskCallbacks.shift()?.();
    taskChannel.port1.unref?.();
    taskChannel.port2.unref?.();
  }
  return new Promise((resolve) => {
    taskCallbacks.push(resolve);
    taskChannel.port2.postMessage(0);
  });
}

const emptyRange = () => ({ min: 0, max: 0, sumSquares: 0, count: 0 });
const finiteSample = (value) => Number.isFinite(value) ? value : 0;
const typedArrayIs = (value, name) => ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === `[object ${name}]`;
const ownsBackingStore = (array) => array.byteOffset === 0 && array.buffer.byteLength === array.byteLength
  && Object.prototype.toString.call(array.buffer) === '[object ArrayBuffer]';

export function waveformByteLength(pyramid) {
  if (!pyramid) return 0;
  // Include a conservative allowance for object/array metadata as well as all backing stores.
  return 256 + pyramid.channels.reduce((total, channel) => total + 128 + channel.levels.reduce(
    (bytes, level) => bytes + 128 + level.min.byteLength + level.max.byteLength + level.sumSquares.byteLength,
    0,
  ), 0);
}

export function estimateWaveformBytes(length, numberOfChannels, baseBlockSize = WAVEFORM_BASE_BLOCK_SIZE) {
  let buckets = Math.ceil(length / baseBlockSize);
  let bytes = 128;
  while (buckets > 0) {
    bytes += 128 + buckets * 16;
    if (buckets === 1) break;
    buckets = Math.ceil(buckets / 2);
  }
  return 256 + numberOfChannels * bytes;
}

/** Adaptive base buckets keep even long-source summaries within the supplied byte budget. */
export function chooseWaveformBlockSize(length, numberOfChannels, maxBytes = DEFAULT_WAVEFORM_BYTES) {
  if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(numberOfChannels) || numberOfChannels < 1
    || !Number.isFinite(maxBytes) || maxBytes < 0) throw new TypeError('Invalid waveform budget metadata');
  let blockSize = WAVEFORM_BASE_BLOCK_SIZE;
  while (estimateWaveformBytes(length, numberOfChannels, blockSize) > maxBytes && blockSize < Math.max(128, length)) {
    blockSize *= 2;
  }
  if (estimateWaveformBytes(length, numberOfChannels, blockSize) > maxBytes) {
    throw new RangeError('Waveform metadata exceeds the summary byte budget');
  }
  return blockSize;
}

/**
 * Incremental, shared worker/fallback math. append() must receive each channel in source order.
 * Parents are reduced as buckets finish, so there is no synchronous full-pyramid finalization.
 * Counts are derived from blockSize and source length, including the partial final bucket.
 */
export function createWaveformBuilder({ sampleRate, length, numberOfChannels, baseBlockSize = WAVEFORM_BASE_BLOCK_SIZE }) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isSafeInteger(length) || length < 0
    || !Number.isSafeInteger(numberOfChannels) || numberOfChannels < 1
    || !Number.isSafeInteger(baseBlockSize) || baseBlockSize < 1 || Math.log2(baseBlockSize) % 1 !== 0) {
    throw new TypeError('Invalid waveform source metadata');
  }
  const channels = Array.from({ length: numberOfChannels }, () => {
    const levels = [];
    for (let blockSize = baseBlockSize; ; blockSize *= 2) {
      const size = Math.ceil(length / blockSize);
      if (!size) break;
      levels.push({ blockSize, min: new Float32Array(size), max: new Float32Array(size), sumSquares: new Float64Array(size) });
      if (size === 1) break;
    }
    return { levels };
  });
  const pyramid = {
    schemaVersion: WAVEFORM_SCHEMA_VERSION, sampleRate, length, numberOfChannels, baseBlockSize,
    sourcePeak: 0, channelPeaks: Array(numberOfChannels).fill(0), channels,
  };
  const states = channels.map(() => ({ position: 0, min: Infinity, max: -Infinity, sumSquares: 0 }));
  function completeBucket(channelIndex, bucket) {
    const state = states[channelIndex];
    const levels = channels[channelIndex].levels;
    levels[0].min[bucket] = state.min;
    levels[0].max[bucket] = state.max;
    levels[0].sumSquares[bucket] = state.sumSquares;
    state.min = Infinity;
    state.max = -Infinity;
    state.sumSquares = 0;
    for (let levelIndex = 1; levelIndex < levels.length; levelIndex += 1) {
      const child = levels[levelIndex - 1];
      if (bucket % 2 === 0 && bucket !== child.min.length - 1) break;
      const parent = levels[levelIndex];
      const left = bucket - bucket % 2;
      const right = Math.min(left + 1, child.min.length - 1);
      bucket = Math.floor(bucket / 2);
      parent.min[bucket] = Math.min(child.min[left], child.min[right]);
      parent.max[bucket] = Math.max(child.max[left], child.max[right]);
      parent.sumSquares[bucket] = child.sumSquares[left] + (right === left ? 0 : child.sumSquares[right]);
    }
  }
  return {
    pyramid,
    append(channelIndex, startSample, samples) {
      const state = states[channelIndex];
      if (!state || state.position !== startSample || !typedArrayIs(samples, 'Float32Array')
        || startSample + samples.length > length) throw new RangeError('Out-of-order waveform chunk');
      let peak = pyramid.channelPeaks[channelIndex];
      for (let i = 0; i < samples.length; i += 1) {
        const value = finiteSample(samples[i]);
        state.min = Math.min(state.min, value);
        state.max = Math.max(state.max, value);
        state.sumSquares += value * value;
        peak = Math.max(peak, Math.abs(value));
        state.position += 1;
        if (state.position % baseBlockSize === 0 || state.position === length) {
          completeBucket(channelIndex, Math.floor((state.position - 1) / baseBlockSize));
        }
      }
      pyramid.channelPeaks[channelIndex] = peak;
      pyramid.sourcePeak = Math.max(pyramid.sourcePeak, peak);
    },
    finish() {
      if (states.some((state) => state.position !== length)) throw new Error('Incomplete waveform source');
      return pyramid;
    },
    /** Finalize a capacity-bounded recording early, refining only its carried tail (never PCM). */
    async finishAt(actualLength, { signal, yieldControl = yieldWaveformTask } = {}) {
      const check = () => {
        if (signal?.aborted) throw Object.assign(new Error('Waveform recording cancelled'), { name: 'AbortError' });
      };
      check();
      if (!Number.isSafeInteger(actualLength) || actualLength < 0 || actualLength > length
        || states.some((state) => state.position !== actualLength)) throw new RangeError('Incomplete recording channels');
      if (actualLength === length) return pyramid;
      const result = createWaveformBuilder({ sampleRate, length: actualLength, numberOfChannels, baseBlockSize }).pyramid;
      result.sourcePeak = pyramid.sourcePeak;
      result.channelPeaks = [...pyramid.channelPeaks];
      for (let c = 0; c < numberOfChannels; c += 1) {
        const targetLevels = result.channels[c].levels;
        if (!actualLength) continue;
        const source = channels[c].levels[0];
        if (actualLength % baseBlockSize) {
          const tail = Math.floor(actualLength / baseBlockSize);
          source.min[tail] = states[c].min;
          source.max[tail] = states[c].max;
          source.sumSquares[tail] = states[c].sumSquares;
        }
        for (let l = 0; l < targetLevels.length; l += 1) {
          const target = targetLevels[l];
          const child = targetLevels[l - 1];
          for (let start = 0; start < target.min.length; start += 2048) {
            await yieldControl();
            check();
            const end = Math.min(start + 2048, target.min.length);
            const existing = channels[c].levels[l];
            target.min.set(existing.min.subarray(start, end), start);
            target.max.set(existing.max.subarray(start, end), start);
            target.sumSquares.set(existing.sumSquares.subarray(start, end), start);
          }
          if (child) {
            // All complete parents were already maintained by append(). Only the tail path changes.
            const tail = target.min.length - 1;
            const left = tail * 2;
            const right = Math.min(left + 1, child.min.length - 1);
            target.min[tail] = Math.min(child.min[left], child.min[right]);
            target.max[tail] = Math.max(child.max[left], child.max[right]);
            target.sumSquares[tail] = child.sumSquares[left] + (right === left ? 0 : child.sumSquares[right]);
          }
        }
      }
      check();
      return result;
    },
  };
}

/** Cheap structural validation; persisted bucket contents are also checked cooperatively by persistence. */
export function validateWaveformPyramid(pyramid) {
  if (!pyramid || pyramid.schemaVersion !== WAVEFORM_SCHEMA_VERSION
    || !Number.isFinite(pyramid.sampleRate) || pyramid.sampleRate <= 0
    || !Number.isSafeInteger(pyramid.length) || pyramid.length < 0
    || !Number.isSafeInteger(pyramid.numberOfChannels) || pyramid.numberOfChannels < 1
    || !Number.isSafeInteger(pyramid.baseBlockSize) || pyramid.baseBlockSize < 1
    || Math.log2(pyramid.baseBlockSize) % 1 !== 0
    || !Number.isFinite(pyramid.sourcePeak) || pyramid.sourcePeak < 0
    || !Array.isArray(pyramid.channels) || pyramid.channels.length !== pyramid.numberOfChannels
    || !Array.isArray(pyramid.channelPeaks) || pyramid.channelPeaks.length !== pyramid.numberOfChannels
    || pyramid.channelPeaks.some((peak) => !Number.isFinite(peak) || peak < 0)
    || Math.max(...pyramid.channelPeaks) !== pyramid.sourcePeak) return false;
  for (const channel of pyramid.channels) {
    if (!Array.isArray(channel?.levels)) return false;
    let blockSize = pyramid.baseBlockSize;
    let expectedLevels = 0;
    for (const level of channel.levels) {
      const size = Math.ceil(pyramid.length / blockSize);
      if (!size || !level || level.blockSize !== blockSize
        || !typedArrayIs(level.min, 'Float32Array') || !typedArrayIs(level.max, 'Float32Array')
        || !typedArrayIs(level.sumSquares, 'Float64Array')
        || !ownsBackingStore(level.min) || !ownsBackingStore(level.max) || !ownsBackingStore(level.sumSquares)
        || level.min.length !== size || level.max.length !== size || level.sumSquares.length !== size) return false;
      expectedLevels += 1;
      if (size === 1) break;
      blockSize *= 2;
    }
    if (expectedLevels !== channel.levels.length
      || (pyramid.length > 0 && channel.levels.at(-1)?.min.length !== 1)) return false;
  }
  return true;
}

/**
 * Exact half-open range query. Fractional bounds cover [floor(start), ceil(end)), then clamp.
 * Raw PCM is required for unaligned edges (and sample detail); at most two base buckets are read.
 * No summary and a supplied audioBuffer is also supported for small raw-detail queries.
 * Non-finite samples count as zero, consistently with extraction. Empty ranges return all zeros.
 */
export function queryWaveformRange(pyramid, channelIndex, startSample, endSample, audioBuffer) {
  const source = pyramid || audioBuffer;
  if (!source || !Number.isInteger(channelIndex) || channelIndex < 0 || channelIndex >= source.numberOfChannels
    || Number.isNaN(startSample) || Number.isNaN(endSample) || endSample <= startSample) return emptyRange();
  const start = Math.max(0, Math.min(source.length, Math.floor(startSample)));
  const end = Math.max(0, Math.min(source.length, Math.ceil(endSample)));
  if (!(end > start)) return emptyRange();
  const levels = pyramid?.channels[channelIndex]?.levels || [];
  let min = Infinity;
  let max = -Infinity;
  let sumSquares = 0;
  let count = 0;
  let position = start;
  let raw;
  while (position < end) {
    let selected;
    for (let index = levels.length - 1; index >= 0; index -= 1) {
      const level = levels[index];
      if (position % level.blockSize === 0 && Math.min(position + level.blockSize, source.length) <= end) {
        selected = level;
        break;
      }
    }
    if (selected) {
      const bucket = position / selected.blockSize;
      const size = Math.min(selected.blockSize, source.length - position);
      min = Math.min(min, selected.min[bucket]);
      max = Math.max(max, selected.max[bucket]);
      sumSquares += selected.sumSquares[bucket];
      count += size;
      position += size;
    } else {
      if (!raw) {
        if (!audioBuffer || audioBuffer.length !== source.length || audioBuffer.numberOfChannels !== source.numberOfChannels
          || audioBuffer.sampleRate !== source.sampleRate) throw new Error('Exact waveform edges require matching audioBuffer PCM');
        raw = audioBuffer.getChannelData(channelIndex);
      }
      const rawEnd = levels.length
        ? Math.min(end, (Math.floor(position / levels[0].blockSize) + 1) * levels[0].blockSize)
        : end;
      for (; position < rawEnd; position += 1) {
        const value = finiteSample(raw[position]);
        min = Math.min(min, value);
        max = Math.max(max, value);
        sumSquares += value * value;
        count += 1;
      }
    }
  }
  return { min, max, sumSquares, count };
}

/**
 * SHA-256 hash chain over canonical, fixed-size, channel-major PCM chunks, including metadata.
 * Hash original Float32 bytes (even non-finite payloads), not reduced extrema or sampled content.
 * Without WebCrypto, extraction remains usable but persistence is deliberately disabled.
 */
export function createWaveformFingerprint(metadata, subtle = globalThis.crypto?.subtle) {
  let digest;
  return {
    async append(samples) {
      if (!subtle) return;
      const chunkDigest = new Uint8Array(await subtle.digest('SHA-256', samples));
      const combined = new Uint8Array(64);
      if (digest) combined.set(digest);
      combined.set(chunkDigest, 32);
      digest = new Uint8Array(await subtle.digest('SHA-256', combined));
    },
    async finish() {
      if (!subtle) return undefined;
      const encoded = new TextEncoder().encode(JSON.stringify([
        WAVEFORM_SCHEMA_VERSION, WAVEFORM_CHUNK_SAMPLES, metadata.sampleRate, metadata.length, metadata.numberOfChannels,
      ]));
      const combined = new Uint8Array(encoded.length + 32);
      combined.set(encoded);
      if (digest) combined.set(digest, encoded.length);
      const result = new Uint8Array(await subtle.digest('SHA-256', combined));
      return Array.from(result, (byte) => byte.toString(16).padStart(2, '0')).join('');
    },
  };
}
