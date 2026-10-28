import { queryWaveformRange } from './waveformData';

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

export const WAVEFORM_RASTER_BYTES = 64 * 1024 * 1024;
export const WAVEFORM_RAW_SAMPLES_PER_SLICE = 256;
export const WAVEFORM_DRAW_RAW_SAMPLES_PER_SLICE = 8192;

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

/** Exact query split at base-bucket boundaries. A step never refines more than rawLimit PCM samples. */
export function createWaveformRangeQuery(pyramid, channel, start, end, audioBuffer) {
  const source = pyramid || audioBuffer;
  const valid = !Number.isNaN(start) && !Number.isNaN(end) && end > start;
  let position = valid ? Math.max(0, Math.min(source.length, Math.floor(start))) : 0;
  const finish = valid ? Math.max(position, Math.min(source.length, Math.ceil(end))) : position;
  const base = pyramid?.channels[channel]?.levels[0]?.blockSize;
  const result = { min: Infinity, max: -Infinity, sumSquares: 0, count: 0 };
  return (rawLimit = WAVEFORM_RAW_SAMPLES_PER_SLICE) => {
    rawLimit = Math.max(1, Math.floor(finite(rawLimit, WAVEFORM_RAW_SAMPLES_PER_SLICE)));
    let rawSamples = 0;
    if (position < finish) {
      const alignedEnd = base ? Math.floor(finish / base) * base : position;
      const summarized = base && position % base === 0 && alignedEnd > position;
      const next = summarized ? alignedEnd : Math.min(finish, position + rawLimit,
        base ? (Math.floor(position / base) + 1) * base : finish);
      const range = queryWaveformRange(summarized ? pyramid : undefined, channel, position, next, audioBuffer);
      if (range.count) {
        result.min = Math.min(result.min, range.min);
        result.max = Math.max(result.max, range.max);
        result.sumSquares += range.sumSquares;
        result.count += range.count;
      }
      if (!summarized) rawSamples = next - position;
      position = next;
    }
    const done = position >= finish;
    if (done && !result.count) result.min = result.max = 0;
    return { done, result, rawSamples };
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
        for (const { blobId, audioBuffer } of desired) {
          const previous = snapshots.get(blobId);
          let source;
          if (audioBuffer) {
            // Do not pass revision: it belongs to the trusted media-cache owner.
            source = service.getSource(blobId, audioBuffer) || service.ensureSource(blobId, audioBuffer, { priority });
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
 */
export function createWaveformDrawJob(context, {
  audioBuffer, pyramid, cropStartMs = 0, cropEndMs, pixelsPerMs,
  clipLeftPx = 0, clipWidthPx, surfaceLeftPx, surfaceWidthPx, height,
  dpr = 1, color = '#4F8EF7', displayMode = 'linear', globalPeakAmplitude = 1,
  showRms = false, showClipping = false, showSamples = false,
}) {
  const { sampleRate, length, numberOfChannels } = audioBuffer;
  if (finite(cropEndMs, length / sampleRate * 1000) <= finite(cropStartMs)) return () => false;
  const cropStart = Math.max(0, Math.min(length, Math.floor(finite(cropStartMs) * sampleRate / 1000)));
  const cropEnd = Math.max(cropStart, Math.min(length, Math.ceil(finite(cropEndMs, length / sampleRate * 1000) * sampleRate / 1000)));
  const left = Math.max(0, clipLeftPx - surfaceLeftPx);
  const right = Math.min(surfaceWidthPx, clipLeftPx + clipWidthPx - surfaceLeftPx);
  if (!(pixelsPerMs > 0) || right <= left || cropEnd <= cropStart) return () => false;
  const samplesPerPx = sampleRate / (1000 * pixelsPerMs);
  const detail = samplesPerPx / dpr <= 1;
  const laneHeight = height / numberOfChannels;
  const amplitude = (value) => waveformAmplitude(value, displayMode, globalPeakAmplitude);
  const sampleAt = (x) => finite(cropStartMs) * sampleRate / 1000 + (surfaceLeftPx + x - clipLeftPx) * samplesPerPx;
  let channel = 0;
  let column = Math.floor(left * dpr);
  let sample = Math.max(cropStart, Math.floor(sampleAt(left)));
  let previous;
  let initialized = false;
  let query;
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
      const pcm = audioBuffer.getChannelData(channel);
      const end = Math.min(cropEnd, Math.ceil(sampleAt(right)) + 1);
      context.beginPath();
      if (previous) context.moveTo(previous.x, previous.y);
      for (let i = 0; i < 64 && sample < end; i += 1, sample += 1) {
        const value = finite(pcm[sample]);
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
      // Batch small exact queries, but bound both PCM work and summary-only work even with a stalled clock.
      for (let i = 0; i < 1024 && column / dpr < right && rawRemaining > 0
        && (i === 0 || now() < sliceDeadline); i += 1) {
        const x = Math.max(left, column / dpr);
        const endX = Math.min(right, (column + 1) / dpr);
        if (!query) {
          const start = Math.max(cropStart, Math.floor(sampleAt(x)));
          const end = Math.min(cropEnd, Math.ceil(sampleAt(endX)));
          query = createWaveformRangeQuery(pyramid, channel, start, end, audioBuffer);
        }
        const step = query(Math.min(rawRemaining, WAVEFORM_RAW_SAMPLES_PER_SLICE));
        rawRemaining -= step.rawSamples;
        if (!step.done) continue;
        query = undefined;
        column += 1;
        const range = step.result;
        if (!range.count) continue;
        const top = y(range.max);
        const bottom = y(range.min);
        context.fillStyle = color;
        context.fillRect(x, top, endX - x, Math.max(1 / dpr, bottom - top));
        if (showRms) {
          const rms = Math.sqrt(range.sumSquares / range.count);
          context.globalAlpha = 0.35;
          context.fillRect(x, y(rms), endX - x, Math.max(1 / dpr, y(-rms) - y(rms)));
          context.globalAlpha = 1;
        }
        if (showClipping && (range.max > 1 || range.min < -1)) {
          context.fillStyle = '#ef4444';
          if (range.max > 1) context.fillRect(x, channel * laneHeight, endX - x, 2);
          if (range.min < -1) context.fillRect(x, (channel + 1) * laneHeight - 2, endX - x, 2);
        }
      }
      finished = column / dpr >= right;
    }
    context.restore();
    if (finished) {
      channel += 1;
      column = Math.floor(left * dpr);
      sample = Math.max(cropStart, Math.floor(sampleAt(left)));
      previous = undefined;
      initialized = false;
    }
    return channel < numberOfChannels;
  };
}
