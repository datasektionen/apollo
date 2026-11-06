import { WAVEFORM_BASE_BLOCK_SIZE } from './waveformData';

export const WAVEFORM_OVERSCAN_PX = 32;
export const WAVEFORM_DB_FLOOR = -60;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

/** All geometry is in timeline CSS pixels; the returned offset is local to the clip. */
export function getWaveformWindow({ clipLeftPx = 0, clipWidthPx = 0, viewportLeftPx = 0, viewportWidthPx = 0 }) {
  const width = Math.max(0, finite(clipWidthPx));
  const viewportWidth = Math.max(0, finite(viewportWidthPx));
  const left = Math.max(0, finite(viewportLeftPx) - finite(clipLeftPx) - WAVEFORM_OVERSCAN_PX);
  const right = Math.min(width, finite(viewportLeftPx) - finite(clipLeftPx) + viewportWidth + WAVEFORM_OVERSCAN_PX);
  return { leftPx: Math.min(width, left), widthPx: viewportWidth > 0 ? Math.max(0, right - left) : 0 };
}

export function waveformAmplitude(value, displayMode = 'linear', globalPeakAmplitude = 1) {
  const sample = finite(value);
  if (displayMode === 'db') {
    const magnitude = Math.abs(sample);
    return Math.sign(sample) * Math.max(0, Math.min(1, (20 * Math.log10(magnitude || 1e-30) - WAVEFORM_DB_FLOOR) / -WAVEFORM_DB_FLOOR));
  }
  const scale = displayMode === 'normalized' && globalPeakAmplitude > 0 ? globalPeakAmplitude : 1;
  return Math.max(-1, Math.min(1, sample / scale));
}

/** Retained canvases span three viewports, plus one return-to-start layer per view. */
export const WAVEFORM_RASTER_BYTES = 192 * 1024 * 1024;
export const WAVEFORM_RAW_SAMPLES_PER_SLICE = 256;
/** Per-slice ceilings when the clock does not advance; the clock normally ends a slice first. */
export const WAVEFORM_DRAW_RAW_SAMPLES_PER_SLICE = 65536;
export const WAVEFORM_DRAW_STEPS_PER_SLICE = 4096;
/** Estimated work (raw samples, plus 16 per query step) between draw-slice clock reads. */
export const WAVEFORM_CLOCK_CHECK_WORK = 1024;

/** Accounts all owned RGBA backing stores, not playback PCM or browser-internal compositor copies. */
export function createWaveformRasterBudget(maxBytes = WAVEFORM_RASTER_BYTES) {
  const allocations = new Map();
  const listeners = new Set();
  let bytes = 0;
  let peakBytes = 0;
  function discard(canvas) {
    const allocation = allocations.get(canvas);
    bytes -= allocation?.bytes || 0;
    allocations.delete(canvas);
    // Zero both axes before resizing: never allocate new-width * old-height as an intermediate.
    canvas.width = 0;
    canvas.height = 0;
    return Boolean(allocation);
  }
  return {
    allocate(canvas, width, height, requestedDpr) {
      discard(canvas);
      if (!(width > 0) || !(height > 0) || !Number.isFinite(width + height)) return undefined;
      const available = Math.min(maxBytes - bytes, maxBytes / 16);
      const size = (ratio) => Math.ceil(width * ratio) * Math.ceil(height * ratio) * 4;
      let ratio = Math.min(Math.max(0.25, finite(requestedDpr, 1)), 16384 / width, 16384 / height);
      if (ratio < 0.25 || size(0.25) > available) return undefined;
      if (size(ratio) > available) {
        let low = 0.25;
        let high = ratio;
        for (let i = 0; i < 32; i += 1) {
          const middle = (low + high) / 2;
          if (size(middle) <= available) low = middle;
          else high = middle;
        }
        ratio = low;
      }
      const allocation = { dpr: ratio, width: Math.ceil(width * ratio), height: Math.ceil(height * ratio), bytes: size(ratio) };
      allocations.set(canvas, allocation);
      bytes += allocation.bytes;
      peakBytes = Math.max(peakBytes, bytes);
      return allocation;
    },
    getAllocation: (canvas) => allocations.get(canvas),
    release(canvas, notify = true) {
      if (canvas && discard(canvas) && notify) {
        for (const listener of [...listeners]) {
          try { listener(); } catch (error) { console.error('Waveform raster subscriber failed', error); }
        }
      }
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getStats: () => ({ bytes, peakBytes, surfaces: allocations.size, maxBytes }),
  };
}

export const waveformRasterBudget = createWaveformRasterBudget();

export function prepareWaveformCanvas(canvas, width, height, dpr, budget = waveformRasterBudget) {
  const allocation = budget.allocate(canvas, width, height, dpr);
  if (!allocation) return null;
  try {
    canvas.width = allocation.width;
    canvas.height = allocation.height;
    const context = canvas.getContext('2d');
    if (!context) { budget.release(canvas, false); return null; }
    context.setTransform(allocation.dpr, 0, 0, allocation.dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    return context;
  } catch {
    budget.release(canvas, false);
    return null;
  }
}

/** Adds summary buckets for [position, end): both aligned to levels[0], or end at the summary length. */
function addSummary(levels, length, position, end, total) {
  let level = 0;
  while (position < end) {
    while (level + 1 < levels.length && position % levels[level + 1].blockSize === 0
      && Math.min(position + levels[level + 1].blockSize, length) <= end) level += 1;
    while (level > 0 && Math.min(position + levels[level].blockSize, length) > end) level -= 1;
    const { blockSize, min, max, sumSquares } = levels[level];
    const bucket = position / blockSize;
    const size = Math.min(blockSize, length - position);
    total.min = Math.min(total.min, min[bucket]);
    total.max = Math.max(total.max, max[bucket]);
    total.sumSquares += sumSquares[bucket];
    total.count += size;
    position += size;
  }
}

/** Reads each PCM sample exactly once; non-finite samples count as silence, as in extraction. */
function addRaw(pcm, position, end, total) {
  let min = Infinity;
  let max = -Infinity;
  let sumSquares = 0;
  for (let i = position; i < end; i += 1) {
    const value = pcm[i];
    min = Math.min(min, value);
    max = Math.max(max, value);
    sumSquares += value * value;
  }
  // Any NaN or infinite sample makes the energy non-finite.
  if (!(sumSquares < Infinity)) {
    min = Infinity;
    max = -Infinity;
    sumSquares = 0;
    for (let i = position; i < end; i += 1) {
      let value = pcm[i];
      if (!Number.isFinite(value)) value = 0;
      min = Math.min(min, value);
      max = Math.max(max, value);
      sumSquares += value * value;
    }
  }
  total.min = Math.min(total.min, min);
  total.max = Math.max(total.max, max);
  total.sumSquares += sumSquares;
  total.count += end - position;
}

function addRawCombined(pcm0, pcm1, position, end, total) {
  let min = Infinity;
  let max = -Infinity;
  let sumSquares = 0;
  for (let i = position; i < end; i += 1) {
    const v0 = pcm0[i];
    const v1 = pcm1[i];
    const value = Math.abs(v0) >= Math.abs(v1) ? v0 : v1;
    min = Math.min(min, value);
    max = Math.max(max, value);
    sumSquares += value * value;
  }
  if (!(sumSquares < Infinity)) {
    min = Infinity;
    max = -Infinity;
    sumSquares = 0;
    for (let i = position; i < end; i += 1) {
      let v0 = pcm0[i];
      let v1 = pcm1[i];
      if (!Number.isFinite(v0)) v0 = 0;
      if (!Number.isFinite(v1)) v1 = 0;
      const value = Math.abs(v0) >= Math.abs(v1) ? v0 : v1;
      min = Math.min(min, value);
      max = Math.max(max, value);
      sumSquares += value * value;
    }
  }
  total.min = Math.min(total.min, min);
  total.max = Math.max(total.max, max);
  total.sumSquares += sumSquares;
  total.count += end - position;
}

/**
 * Reusable exact range reader for one channel. reset(start, end) begins a range; each step()
 * refines at most rawLimit PCM samples and sets done, rawSamples and the min/max/sumSquares/count totals.
 * The aligned interior is summarized before the partial edge buckets. Without sumSquares, an edge
 * whose enclosing bucket cannot widen the extrema is counted without reading PCM, and sumSquares
 * then covers only what was read.
 * detail(sample) may return a finer page { start, length, pyramid } covering that sample; its
 * aligned buckets replace raw reads inside coarse buckets.
 */
function createWaveformReader(pyramid, channel, audioBuffer, detail, { sumSquares: exactEnergy = true } = {}) {
  const length = (pyramid || audioBuffer).length;
  const levels = pyramid?.channels[channel]?.levels;
  const base = levels?.[0]?.blockSize;
  let pcm;
  let position = 0;
  let finish = 0;
  let innerStart = 0;
  let innerEnd = 0;
  // The current edge is [position, edgeEnd); the tail edge [innerEnd, finish) follows the head.
  let edgeEnd = 0;
  const covers = (bucketLevels, bucket) => !exactEnergy
    && reader.min <= bucketLevels[0].min[bucket] && reader.max >= bucketLevels[0].max[bucket];
  const nextEdge = () => {
    if (position >= edgeEnd && edgeEnd < finish) {
      position = innerEnd;
      edgeEnd = finish;
    }
    reader.done = innerStart >= innerEnd && position >= edgeEnd;
    if (reader.done && !reader.count) reader.min = reader.max = 0;
  };
  const reader = {
    min: 0, max: 0, sumSquares: 0, count: 0, done: true, rawSamples: 0,
    reset(start, end) {
      const valid = !Number.isNaN(start) && !Number.isNaN(end) && end > start;
      position = valid ? Math.max(0, Math.min(length, Math.floor(start))) : 0;
      finish = valid ? Math.max(position, Math.min(length, Math.ceil(end))) : position;
      edgeEnd = base ? Math.min(finish, Math.ceil(position / base) * base) : finish;
      innerStart = edgeEnd;
      innerEnd = !base || finish === length ? finish : Math.max(edgeEnd, Math.floor(finish / base) * base);
      reader.min = Infinity;
      reader.max = -Infinity;
      reader.sumSquares = 0;
      reader.count = 0;
      reader.rawSamples = 0;
      nextEdge();
    },
    step(rawLimit = WAVEFORM_RAW_SAMPLES_PER_SLICE) {
      reader.rawSamples = 0;
      if (reader.done) return;
      if (innerStart < innerEnd) {
        addSummary(levels, length, innerStart, innerEnd, reader);
        innerStart = innerEnd;
        nextEdge();
        return;
      }
      rawLimit = Math.max(1, Math.floor(finite(rawLimit, WAVEFORM_RAW_SAMPLES_PER_SLICE)));
      // An edge lies inside one coarse bucket.
      if (base && covers(levels, Math.floor(position / base))) {
        reader.count += edgeEnd - position;
        position = edgeEnd;
        nextEdge();
        return;
      }
      const page = detail?.(position);
      let next = Math.min(edgeEnd, position + rawLimit);
      if (page) {
        const fine = page.pyramid.baseBlockSize;
        const fineLevels = page.pyramid.channels[channel].levels;
        const pageEnd = page.start + page.length;
        const stop = Math.min(edgeEnd, pageEnd);
        // A source's partial final bucket is summarized; any other unaligned stop is refined raw.
        const aligned = stop === pageEnd ? stop : Math.floor(stop / fine) * fine;
        if (position % fine === 0 && aligned > position) {
          addSummary(fineLevels, page.length, position - page.start, aligned - page.start, reader);
          position = aligned;
          nextEdge();
          return;
        }
        const fineEnd = Math.min(stop, (Math.floor(position / fine) + 1) * fine);
        if (covers(fineLevels, Math.floor((position - page.start) / fine))) {
          reader.count += fineEnd - position;
          position = fineEnd;
          nextEdge();
          return;
        }
        next = Math.min(next, fineEnd);
      }
      if (!pcm) {
        if (pyramid && (!audioBuffer || audioBuffer.length !== length
          || (pyramid.numberOfChannels !== 1 && audioBuffer.numberOfChannels !== pyramid.numberOfChannels)
          || audioBuffer.sampleRate !== pyramid.sampleRate)) throw new Error('Exact waveform edges require matching audioBuffer PCM');
        pcm = audioBuffer ? audioBuffer.getChannelData(Math.min(channel, audioBuffer.numberOfChannels - 1)) : undefined;
      }
      if (pyramid?.numberOfChannels === 1 && audioBuffer?.numberOfChannels > 1) {
        addRawCombined(audioBuffer.getChannelData(0), audioBuffer.getChannelData(1), position, next, reader);
      } else {
        addRaw(pcm, position, next, reader);
      }
      reader.rawSamples = next - position;
      position = next;
      nextEdge();
    },
  };
  return reader;
}

export function createWaveformCombinedReader(pyramid, audioBuffer, detail, options) {
  const reader0 = createWaveformReader(pyramid, 0, audioBuffer, detail, options);
  const reader1 = createWaveformReader(pyramid, 1, audioBuffer, detail, options);
  const reader = {
    min: 0, max: 0, sumSquares: 0, count: 0, done: true, rawSamples: 0,
    reset(start, end) {
      reader0.reset(start, end);
      reader1.reset(start, end);
      reader.min = Math.min(reader0.min, reader1.min);
      reader.max = Math.max(reader0.max, reader1.max);
      reader.sumSquares = (reader0.sumSquares + reader1.sumSquares) * 0.5;
      reader.count = reader0.count;
      reader.done = reader0.done && reader1.done;
      reader.rawSamples = 0;
    },
    step(rawLimit = WAVEFORM_RAW_SAMPLES_PER_SLICE) {
      if (!reader0.done) reader0.step(rawLimit);
      if (!reader1.done) reader1.step(rawLimit);
      reader.done = reader0.done && reader1.done;
      reader.rawSamples = reader0.rawSamples + reader1.rawSamples;
      reader.min = Math.min(reader0.min, reader1.min);
      reader.max = Math.max(reader0.max, reader1.max);
      reader.sumSquares = (reader0.sumSquares + reader1.sumSquares) * 0.5;
      reader.count = Math.max(reader0.count, reader1.count);
    },
  };
  return reader;
}

/** Exact query split at base-bucket boundaries. A step never refines more than rawLimit PCM samples. */
export function createWaveformRangeQuery(pyramid, channel, start, end, audioBuffer, detail, options) {
  const reader = createWaveformReader(pyramid, channel, audioBuffer, detail, options);
  reader.reset(start, end);
  const result = { min: reader.min, max: reader.max, sumSquares: 0, count: 0 };
  return (rawLimit) => {
    reader.step(rawLimit);
    result.min = reader.min;
    result.max = reader.max;
    result.sumSquares = reader.sumSquares;
    result.count = reader.count;
    return { done: reader.done, result, rawSamples: reader.rawSamples };
  };
}

/** View-local subscriptions and one pin per decoded source, never alias ownership release.
 * Notification callbacks only mark dirty; service reads/demand/re-pinning happen in scheduled slices.
 */
export function createWaveformSourceObserver({ service, getSources, subscribeMedia, onChange, priority = 0 }) {
  let disposed = false;
  let reading = false;
  let dirty = true;
  let snapshots = new Map();
  const pins = new Map();
  let ids = new Set(getSources().map(({ blobId }) => String(blobId)));
  const invalidPins = new Set();
  function notify(event) {
    if (disposed || event?.type === 'pinned' || event?.type === 'unpinned') return;
    if (event?.blobIds?.length && !event.blobIds.some((id) => ids.has(String(id)))) return;
    if (event?.type === 'removed' || event?.type === 'replaced') {
      const affected = event.blobIds?.length ? event.blobIds
        : [...snapshots].filter(([, previous]) => event.source && previous.source === event.source).map(([id]) => id);
      for (const id of affected) invalidPins.add(String(id));
    }
    dirty = true;
    if (!reading) onChange();
  }
  const unsubscribe = service.subscribe(notify);
  const unsubscribeMedia = subscribeMedia?.(() => notify());
  return {
    get dirty() { return dirty; },
    invalidate() { dirty = true; ids = new Set(getSources().map(({ blobId }) => String(blobId))); },
    read() {
      if (!dirty) return { snapshots, changed: false, stale: false };
      dirty = false;
      reading = true;
      let stale = false;
      let changed = false;
      const next = new Map();
      try {
        const desired = [...new Map(getSources().map((item) => [item.blobId, item])).values()];
        const unique = new Map();
        for (const item of desired) if (item.audioBuffer && !unique.has(item.audioBuffer)) unique.set(item.audioBuffer, item.blobId);
        for (const [buffer, pin] of pins) {
          if (!unique.has(buffer) || unique.get(buffer) !== pin.blobId || invalidPins.has(String(pin.blobId))) {
            pin.unpin();
            pins.delete(buffer);
          }
        }
        for (const { blobId, audioBuffer, channels } of desired) {
          const previous = snapshots.get(blobId);
          let source;
          if (audioBuffer) {
            // Do not pass revision: it belongs to the trusted media-cache owner.
            const opts = channels ? { priority, channels } : { priority };
            source = service.getSource(blobId, audioBuffer, opts) || service.ensureSource(blobId, audioBuffer, opts);
            if (!pins.has(audioBuffer)) pins.set(audioBuffer, { blobId, unpin: service.pinSource(blobId, audioBuffer) });
          }
          const same = previous?.audioBuffer === audioBuffer && previous?.source?.status === source?.status
            && previous?.source?.pyramid === source?.pyramid && previous?.source?.error?.code === source?.error?.code
            && previous?.source?.error?.message === source?.error?.message;
          if (!same) changed = true;
          if (previous && (previous.audioBuffer !== audioBuffer
            || (previous.source?.pyramid && previous.source.pyramid !== source?.pyramid)
            || invalidPins.has(String(blobId)))) stale = true;
          next.set(blobId, { audioBuffer, source });
        }
        invalidPins.clear();
        snapshots = next;
      } finally { reading = false; }
      return { snapshots, changed, stale };
    },
    dispose() {
      disposed = true;
      unsubscribe();
      unsubscribeMedia?.();
      for (const { unpin } of pins.values()) unpin();
      pins.clear();
      snapshots.clear();
    },
  };
}

/** A small, resumable draw job. PCM is borrowed, never copied or scaled in place.
 * Group callers overlay independent source envelopes: this is activity, NOT a mix.
 * requestDetail(startSample, endSample) is asked once for the visible range of a coarse pyramid.
 * [fromColumn, toColumn) limits drawing to those surface device columns, painting them exactly as a
 * full pass would.
 */
export function createWaveformDrawJob(context, {
  audioBuffer, pyramid, cropStartMs = 0, cropEndMs, pixelsPerMs,
  clipLeftPx = 0, clipWidthPx, surfaceLeftPx, surfaceWidthPx, height,
  dpr = 1, color = '#4F8EF7', displayMode = 'linear', globalPeakAmplitude = 1,
  showRms = false, showClipping = false, showSamples = false, requestDetail,
  fromColumn = 0, toColumn = Infinity, stereo,
}) {
  const { sampleRate, length } = audioBuffer;
  if (finite(cropEndMs, length / sampleRate * 1000) <= finite(cropStartMs)) return () => false;
  const cropStart = Math.max(0, Math.min(length, Math.floor(finite(cropStartMs) * sampleRate / 1000)));
  const cropEnd = Math.max(cropStart, Math.min(length, Math.ceil(finite(cropEndMs, length / sampleRate * 1000) * sampleRate / 1000)));
  const left = Math.max(0, clipLeftPx - surfaceLeftPx, fromColumn / dpr);
  const right = Math.min(surfaceWidthPx, clipLeftPx + clipWidthPx - surfaceLeftPx, toColumn / dpr);
  if (!(pixelsPerMs > 0) || right <= left || cropEnd <= cropStart) return () => false;
  const isStereo = stereo === true || (stereo === undefined && audioBuffer.numberOfChannels > 1 && (pyramid ? pyramid.numberOfChannels > 1 : true));
  const drawChannels = isStereo ? 2 : 1;
  const samplesPerPx = sampleRate / (1000 * pixelsPerMs);
  const detail = samplesPerPx / dpr <= 1;
  const laneHeight = height / drawChannels;
  const amplitude = (value) => waveformAmplitude(value, displayMode, globalPeakAmplitude);
  const sampleAt = (x) => finite(cropStartMs) * sampleRate / 1000 + (surfaceLeftPx + x - clipLeftPx) * samplesPerPx;
  const detailPages = !detail && pyramid?.baseBlockSize > WAVEFORM_BASE_BLOCK_SIZE
    ? requestDetail?.(Math.max(cropStart, Math.floor(sampleAt(left))), Math.min(cropEnd, Math.ceil(sampleAt(right))))
    : undefined;
  // fromColumn / dpr * dpr can round just below fromColumn.
  const firstColumn = Math.max(fromColumn, Math.floor(left * dpr));
  // Sample lines start and end this far outside the clip: strokes, sample dots and clipping marks of
  // samples just outside still reach in, and a column range must match a full pass.
  const detailReachPx = 2;
  const firstSample = detail
    ? Math.max(cropStart, Math.floor(sampleAt(left - detailReachPx)) - 1)
    : Math.max(cropStart, Math.floor(sampleAt(left)));
  let channel = 0;
  let column = firstColumn;
  let sample = firstSample;
  let previous;
  let initialized = false;
  let reader;
  let reading = false;
  return ({ now = () => performance.now(), deadline = Infinity } = {}) => {
    const sliceDeadline = Math.min(deadline, now() + 1);
    const center = (channel + 0.5) * laneHeight;
    const radius = Math.max(0, laneHeight / 2 - 2);
    const y = (value) => center - amplitude(value) * radius;
    context.save();
    context.beginPath();
    context.rect(left, channel * laneHeight, right - left, laneHeight);
    context.clip();
    if (!initialized) {
      context.fillStyle = 'rgba(148, 163, 184, 0.35)';
      context.fillRect(left, center, right - left, 1 / dpr);
      initialized = true;
    }
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = 1 / dpr;
    let finished = false;
    if (detail) {
      const pcm0 = audioBuffer.getChannelData(0);
      const pcm1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : pcm0;
      const end = Math.min(cropEnd, Math.ceil(sampleAt(right + detailReachPx)) + 1);
      // Paths break at absolute multiples of 64 samples, so joins do not depend on where drawing began.
      const stop = Math.min(end, (Math.floor(sample / 64) + 1) * 64);
      context.beginPath();
      if (previous) context.moveTo(previous.x, previous.y);
      for (; sample < stop; sample += 1) {
        let value;
        if (!isStereo && audioBuffer.numberOfChannels > 1) {
          const v0 = finite(pcm0[sample]);
          const v1 = finite(pcm1[sample]);
          value = Math.abs(v0) >= Math.abs(v1) ? v0 : v1;
        } else {
          const pcm = channel === 1 && audioBuffer.numberOfChannels > 1 ? pcm1 : pcm0;
          value = finite(pcm[sample]);
        }
        const x = clipLeftPx - surfaceLeftPx + (sample - finite(cropStartMs) * sampleRate / 1000) / samplesPerPx;
        const point = { x, y: y(value) };
        if (previous) context.lineTo(point.x, point.y);
        else context.moveTo(point.x, point.y);
        previous = point;
        if (showSamples && 1 / samplesPerPx >= 4) context.fillRect(x - 1.5, point.y - 1.5, 3, 3);
        if (showClipping && Math.abs(value) > 1) {
          context.fillStyle = '#ef4444';
          context.fillRect(x, value > 0 ? channel * laneHeight : (channel + 1) * laneHeight - 2, 2, 2);
          context.fillStyle = color;
        }
      }
      context.stroke();
      finished = sample >= end;
    } else {
      let rawRemaining = WAVEFORM_DRAW_RAW_SAMPLES_PER_SLICE;
      let work = 0;
      if (!reader) {
        if (!isStereo && (pyramid?.numberOfChannels || 1) > 1) {
          reader = createWaveformCombinedReader(pyramid, audioBuffer, detailPages, { sumSquares: showRms });
        } else {
          reader = createWaveformReader(pyramid, channel, audioBuffer, detailPages, { sumSquares: showRms });
        }
      }
      // Batch small exact queries, but bound both PCM work and summary-only work even with a stalled clock.
      // Reading the clock costs about as much as a summary step, so it is sampled by work done.
      for (let i = 0; i < WAVEFORM_DRAW_STEPS_PER_SLICE && column / dpr < right && rawRemaining > 0; i += 1) {
        if (work >= WAVEFORM_CLOCK_CHECK_WORK) {
          if (now() >= sliceDeadline) break;
          work = 0;
        }
        const x = Math.max(left, column / dpr);
        const endX = Math.min(right, (column + 1) / dpr);
        if (!reading) {
          reader.reset(Math.max(cropStart, Math.floor(sampleAt(x))), Math.min(cropEnd, Math.ceil(sampleAt(endX))));
          reading = true;
        }
        reader.step(Math.min(rawRemaining, WAVEFORM_RAW_SAMPLES_PER_SLICE));
        rawRemaining -= reader.rawSamples;
        work += 16 + reader.rawSamples;
        if (!reader.done) continue;
        reading = false;
        column += 1;
        if (!reader.count) continue;
        const top = y(reader.max);
        const bottom = y(reader.min);
        context.fillRect(x, top, endX - x, Math.max(1 / dpr, bottom - top));
        if (showRms) {
          const rms = Math.sqrt(reader.sumSquares / reader.count);
          context.globalAlpha = 0.35;
          context.fillRect(x, y(rms), endX - x, Math.max(1 / dpr, y(-rms) - y(rms)));
          context.globalAlpha = 1;
        }
        if (showClipping && (reader.max > 1 || reader.min < -1)) {
          context.fillStyle = '#ef4444';
          if (reader.max > 1) context.fillRect(x, channel * laneHeight, endX - x, 2);
          if (reader.min < -1) context.fillRect(x, (channel + 1) * laneHeight - 2, endX - x, 2);
          context.fillStyle = color;
        }
      }
      finished = column / dpr >= right;
    }
    context.restore();
    if (finished) {
      channel += 1;
      column = firstColumn;
      sample = firstSample;
      previous = undefined;
      initialized = false;
      reader = undefined;
    }
    return channel < drawChannels;
  };
}
