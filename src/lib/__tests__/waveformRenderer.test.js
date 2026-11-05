import { describe, expect, it, vi } from 'vitest';
import { createWaveformBuilder, queryWaveformRange } from '../waveformData';
import { MediaBufferCache, rememberMediaRevision } from '../mediaBufferCache';
import { createWaveformService } from '../waveformService';
import {
  createWaveformDrawJob, createWaveformRangeQuery, createWaveformRasterBudget, createWaveformSourceObserver,
  getWaveformWindow, prepareWaveformCanvas, waveformAmplitude, waveformRasterBudget,
  WAVEFORM_RAW_SAMPLES_PER_SLICE, WAVEFORM_DRAW_RAW_SAMPLES_PER_SLICE, WAVEFORM_RASTER_BYTES, WAVEFORM_CLOCK_CHECK_WORK,
} from '../waveformRenderer';

function context() {
  return Object.fromEntries(['save', 'restore', 'beginPath', 'rect', 'clip', 'fillRect', 'moveTo', 'lineTo', 'stroke', 'setTransform', 'clearRect'].map((name) => [name, vi.fn()]));
}
function source(channels, sampleRate = 1000) {
  const arrays = channels.map((channel) => Float32Array.from(channel));
  const buffer = { sampleRate, length: arrays[0].length, numberOfChannels: arrays.length, getChannelData: vi.fn((ch) => arrays[ch]) };
  const builder = createWaveformBuilder({ ...buffer, baseBlockSize: 2 });
  arrays.forEach((array, ch) => builder.append(ch, 0, array));
  return { buffer, pyramid: builder.finish(), arrays };
}
function finish(job) { for (let i = 0; i < 10000; i += 1) if (!job()) return; throw new Error('Draw did not finish'); }

describe('waveform renderer', () => {
  it('refreshes a same-object trusted revision and its pin through the actual media-cache/service APIs', async () => {
    const service = createWaveformService({ workerFactory: () => undefined, persistence: null, yieldControl: async () => {} });
    const ensure = vi.spyOn(service, 'ensureSource');
    const pin = vi.spyOn(service, 'pinSource');
    const cache = new MediaBufferCache({ onSet: (id, buffer, options) => service.ensureSource(id, buffer, options) });
    const { buffer } = source([[0.25, -0.5]]);
    const ready = () => new Promise((resolve) => {
      if (service.getSource('source', buffer)?.status === 'ready') { resolve(); return; }
      const unsubscribe = service.subscribe((event) => {
        if (event.type === 'ready') { unsubscribe(); resolve(); }
      });
    });
    let observer;
    try {
      cache.set('source', buffer, { revision: { waveformRevision: 'first', blobSize: 8, blobType: 'audio/wav' } });
      await ready();
      observer = createWaveformSourceObserver({
        service, getSources: () => [{ blobId: 'source', audioBuffer: cache.get('source') }],
        subscribeMedia: (listener) => cache.subscribe(listener), onChange: vi.fn(),
      });
      const first = observer.read();
      expect(service.getStats().pins).toBe(1);
      rememberMediaRevision(buffer, { waveformRevision: 'second', blobSize: 8, blobType: 'audio/wav' });
      const changed = observer.read();
      expect(changed.stale).toBe(true);
      expect(changed.snapshots.get('source').audioBuffer).toBe(buffer);
      expect(changed.snapshots.get('source').source.pyramid).not.toBe(first.snapshots.get('source').source.pyramid);
      expect(pin).toHaveBeenCalledTimes(2);
      expect(pin.mock.calls.every((call) => call.length === 2)).toBe(true);
      expect(service.getStats().pins).toBe(1);
      await ready();
      observer.read();
      expect(ensure).toHaveBeenCalledTimes(2);
      expect(ensure.mock.calls.map((call) => call[2].revision.waveformRevision)).toEqual(['first', 'second']);
    } finally {
      observer?.dispose();
      cache.clear();
      expect(service.getStats().pins).toBe(0);
      service.dispose();
    }
  });

  it('bounds multi-hour clip allocation independently of full width', () => {
    expect(getWaveformWindow({ clipLeftPx: 100, clipWidthPx: 1e12, viewportLeftPx: 1e9, viewportWidthPx: 800 }))
      .toEqual({ leftPx: 1e9 - 132, widthPx: 864 });
    expect(getWaveformWindow({ clipLeftPx: 10000, clipWidthPx: 500, viewportLeftPx: 0, viewportWidthPx: 800 }).widthPx).toBe(0);
    expect(getWaveformWindow({ clipWidthPx: 500, viewportWidthPx: 0 }).widthPx).toBe(0);
  });

  it('sets DPR backing size and resets the transform before clearing', () => {
    const ctx = context();
    const canvas = { getContext: () => ctx };
    prepareWaveformCanvas(canvas, 123.5, 80, 2);
    expect(canvas).toMatchObject({ width: 247, height: 160 });
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 123.5, 80);
    waveformRasterBudget.release(canvas);
  });

  it('accounts a global byte ceiling, reduces DPR, releases backings, and can retry blocked surfaces', () => {
    expect(waveformRasterBudget.getStats().maxBytes).toBe(WAVEFORM_RASTER_BYTES);
    const budget = createWaveformRasterBudget(64 * 1024);
    const canvases = Array.from({ length: 20 }, () => ({ getContext: () => context() }));
    for (const canvas of canvases) prepareWaveformCanvas(canvas, 100, 100, 4, budget);
    expect(budget.getStats().bytes).toBeLessThanOrEqual(64 * 1024);
    expect(budget.getStats().peakBytes).toBeLessThanOrEqual(64 * 1024);
    expect(budget.getAllocation(canvases[0]).dpr).toBeLessThan(1);
    expect(canvases[19]).toMatchObject({ width: 0, height: 0 });
    const freed = vi.fn();
    const unsubscribe = budget.subscribe(freed);
    budget.release(canvases[0]);
    expect(canvases[0]).toMatchObject({ width: 0, height: 0 });
    expect(freed).toHaveBeenCalledOnce();
    expect(prepareWaveformCanvas(canvases[19], 100, 100, 4, budget)).not.toBeNull();
    unsubscribe();
    for (const canvas of canvases) budget.release(canvas);
    expect(budget.getStats()).toMatchObject({ bytes: 0, surfaces: 0 });
  });

  it('refines adaptive-bucket edges in bounded slices with exact extrema, energy and counts', () => {
    const pcm = Float32Array.from({ length: 16387 }, (_, i) => Math.sin(i) * (i % 4096 === 0 ? 2 : 0.5));
    const buffer = { sampleRate: 1000, length: pcm.length, numberOfChannels: 1, getChannelData: () => pcm };
    const builder = createWaveformBuilder({ ...buffer, baseBlockSize: 4096 });
    builder.append(0, 0, pcm);
    const pyramid = builder.finish();
    for (const [start, end] of [[1.25, 12286.75], [4095.5, 16386.2], [-1, 100], [16387, 16390], [4, 4], [4.2, 4.2], [NaN, 100]]) {
      const query = createWaveformRangeQuery(pyramid, 0, start, end, buffer);
      let step;
      let slices = 0;
      do {
        step = query();
        slices += 1;
        expect(step.rawSamples).toBeLessThanOrEqual(WAVEFORM_RAW_SAMPLES_PER_SLICE);
      } while (!step.done && slices < 1000);
      const reference = queryWaveformRange(pyramid, 0, start, end, buffer);
      expect(step.done).toBe(true);
      expect(step.result.min).toBe(reference.min);
      expect(step.result.max).toBe(reference.max);
      expect(step.result.count).toBe(reference.count);
      expect(step.result.sumSquares).toBeCloseTo(reference.sumSquares, 8);
    }
    let reads = 0;
    const borrowed = new Proxy(pcm, { get: (target, key) => { if (/^\d+$/.test(String(key))) reads += 1; return target[key]; } });
    const ctx = context();
    const draw = createWaveformDrawJob(ctx, { audioBuffer: { ...buffer, getChannelData: () => borrowed }, pyramid,
      cropStartMs: 1, cropEndMs: 16386, pixelsPerMs: 1 / 8192,
      clipWidthPx: 2, surfaceLeftPx: 0, surfaceWidthPx: 2, height: 40 });
    let more;
    do {
      reads = 0;
      more = draw();
      expect(reads).toBeLessThanOrEqual(WAVEFORM_DRAW_RAW_SAMPLES_PER_SLICE);
    } while (more);
  });

  it('matches a raw reference for random ranges, non-finite samples and the partial final bucket', () => {
    const pcm = Float32Array.from({ length: 5003 }, (_, i) => (i % 997 === 0 ? NaN : i % 1009 === 0 ? -Infinity : Math.sin(i * 0.37) * 1.5));
    const buffer = { sampleRate: 1000, length: pcm.length, numberOfChannels: 1, getChannelData: () => pcm };
    const builder = createWaveformBuilder({ ...buffer, baseBlockSize: 128 });
    builder.append(0, 0, pcm);
    const pyramid = builder.finish();
    let seed = 99;
    const random = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 2 ** 32; };
    const ranges = [[0, 5003], [4992, 5003], [4991.5, 5003], [128, 256], [127.9, 256.1]];
    for (let i = 0; i < 60; i += 1) {
      const start = random() * 5003;
      ranges.push([start, start + random() * (5003 - start)]);
    }
    for (const [start, end] of ranges) {
      const query = createWaveformRangeQuery(pyramid, 0, start, end, buffer);
      let step;
      do step = query(); while (!step.done);
      const values = [...pcm.slice(Math.floor(start), Math.ceil(end))].map((value) => (Number.isFinite(value) ? value : 0));
      expect(step.result.min).toBe(Math.min(...values));
      expect(step.result.max).toBe(Math.max(...values));
      expect(step.result.count).toBe(values.length);
      expect(step.result.sumSquares).toBeCloseTo(values.reduce((sum, value) => sum + value * value, 0), 6);
    }
  });

  it('skips edge PCM that cannot widen extrema when energy is not needed', () => {
    const pcm = Float32Array.from({ length: 50003 }, (_, i) => (i % 4999 === 0 ? NaN
      : Math.sin(i * 0.013) * (0.4 + 0.3 * Math.sin(i * 0.0007)) + 0.05 * Math.sin(i * 1.7)));
    const buffer = { sampleRate: 1000, length: pcm.length, numberOfChannels: 1, getChannelData: () => pcm };
    const builder = createWaveformBuilder({ ...buffer, baseBlockSize: 128 });
    builder.append(0, 0, pcm);
    const pyramid = builder.finish();
    let seed = 7;
    const random = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 2 ** 32; };
    let pruned = 0;
    let exact = 0;
    for (let i = 0; i < 300; i += 1) {
      const start = random() * 50003;
      const end = start + random() * 3000;
      const run = (options) => {
        const query = createWaveformRangeQuery(pyramid, 0, start, end, buffer, undefined, options);
        let raw = 0;
        let step;
        do { step = query(); raw += step.rawSamples; } while (!step.done);
        return { ...step.result, raw };
      };
      const reference = run();
      const fast = run({ sumSquares: false });
      expect(fast.min).toBe(reference.min);
      expect(fast.max).toBe(reference.max);
      expect(fast.count).toBe(reference.count);
      pruned += fast.raw;
      exact += reference.raw;
    }
    expect(pruned).toBeLessThan(exact / 2);
  });

  it('draws the same columns from pruned summaries as from a full PCM scan', () => {
    const pcm = Float32Array.from({ length: 40000 }, (_, i) => Math.sin(i * 0.02) * (0.3 + 0.6 * Math.abs(Math.sin(i * 0.0009))));
    const buffer = { sampleRate: 48000, length: pcm.length, numberOfChannels: 1, getChannelData: () => pcm };
    const builder = createWaveformBuilder({ ...buffer, baseBlockSize: 128 });
    builder.append(0, 0, pcm);
    const pyramid = builder.finish();
    let reads = 0;
    const counted = { ...buffer, getChannelData: () => new Proxy(pcm, { get: (target, key) => {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1;
      return target[key];
    } }) };
    const draw = (withPyramid) => {
      reads = 0;
      const ctx = context();
      finish(createWaveformDrawJob(ctx, {
        audioBuffer: counted, pyramid: withPyramid ? pyramid : undefined, cropStartMs: 3.1, cropEndMs: 800,
        pixelsPerMs: 0.05, clipLeftPx: 0, clipWidthPx: 40, surfaceLeftPx: 0, surfaceWidthPx: 40, height: 40, dpr: 2,
      }));
      return { rects: ctx.fillRect.mock.calls, reads };
    };
    const scanned = draw(false);
    const summarized = draw(true);
    expect(summarized.rects).toEqual(scanned.rects);
    expect(summarized.reads).toBeLessThan(scanned.reads / 4);
  });

  it('paints a column range exactly as the same columns of a full pass', () => {
    const pcm = Float32Array.from({ length: 40000 }, (_, i) => Math.sin(i * 0.03) * (0.2 + Math.abs(Math.sin(i * 0.001))));
    const buffer = { sampleRate: 48000, length: pcm.length, numberOfChannels: 1, getChannelData: () => pcm };
    const builder = createWaveformBuilder({ ...buffer, baseBlockSize: 128 });
    builder.append(0, 0, pcm);
    const pyramid = builder.finish();
    const rects = (ranges) => {
      const ctx = context();
      const calls = [];
      ctx.fillRect.mockImplementation((...args) => { if (ctx.fillStyle !== 'rgba(148, 163, 184, 0.35)') calls.push(args); });
      for (const [fromColumn, toColumn] of ranges) {
        finish(createWaveformDrawJob(ctx, {
          audioBuffer: buffer, pyramid, cropStartMs: 3.1, cropEndMs: 800, pixelsPerMs: 0.05,
          clipLeftPx: 1.3, clipWidthPx: 38, surfaceLeftPx: 0, surfaceWidthPx: 40, height: 40, dpr: 2,
          showRms: true, showClipping: true, fromColumn, toColumn,
        }));
      }
      return calls;
    };
    const full = rects([[0, Infinity]]);
    expect(full.length).toBeGreaterThan(100);
    expect(rects([[0, 23], [23, 57], [57, 80]])).toEqual(full);
  });

  it('draws sample lines for a column range from just outside it, breaking paths where a full pass does', () => {
    const pcm = Float32Array.from({ length: 4000 }, (_, i) => Math.sin(i * 0.3));
    const audioBuffer = { sampleRate: 1000, length: pcm.length, numberOfChannels: 1, getChannelData: () => pcm };
    const pathStarts = (fromColumn, toColumn) => {
      const ctx = context();
      finish(createWaveformDrawJob(ctx, {
        audioBuffer, cropEndMs: 4000, pixelsPerMs: 2, clipWidthPx: 8000,
        surfaceLeftPx: 1000, surfaceWidthPx: 400, height: 40, dpr: 2, fromColumn, toColumn,
      }));
      return ctx.moveTo.mock.calls.map(([x]) => x);
    };
    const full = pathStarts(0, Infinity);
    const [first, ...rest] = pathStarts(301, 500);
    expect(first).toBeLessThanOrEqual(301 / 2 - 2);
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.every((x) => full.includes(x))).toBe(true);
  });

  it('batches exact PCM queries with a hard draw ceiling even when the clock does not advance', () => {
    let reads = 0;
    const length = 2 * WAVEFORM_DRAW_RAW_SAMPLES_PER_SLICE + 5000;
    const pcm = new Proxy({}, { get: () => { reads += 1; return reads === 100000 ? -0.75 : 0.5; } });
    const ctx = context();
    const draw = createWaveformDrawJob(ctx, {
      audioBuffer: { sampleRate: 1000, length, numberOfChannels: 1, getChannelData: () => pcm },
      cropEndMs: length, pixelsPerMs: 1 / length,
      clipWidthPx: 1, surfaceLeftPx: 0, surfaceWidthPx: 1, height: 40,
    });
    expect(draw({ now: () => 0 })).toBe(true);
    expect(reads).toBe(WAVEFORM_DRAW_RAW_SAMPLES_PER_SLICE);
    expect(draw({ now: () => 0 })).toBe(true);
    expect(reads).toBe(2 * WAVEFORM_DRAW_RAW_SAMPLES_PER_SLICE);
    expect(draw({ now: () => 0 })).toBe(false);
    expect(reads).toBe(length);
    expect(ctx.fillRect).toHaveBeenLastCalledWith(0, 11, 1, 22.5);
  });

  it('checks time between bounded PCM queries and resumes without losing extrema', () => {
    let clock = 0;
    let reads = 0;
    let sampleMs = 1 / WAVEFORM_RAW_SAMPLES_PER_SLICE;
    const pcm = new Proxy({}, { get: () => {
      clock += sampleMs;
      reads += 1;
      return reads === 300 ? -0.75 : 0.5;
    } });
    const ctx = context();
    const draw = createWaveformDrawJob(ctx, {
      audioBuffer: { sampleRate: 1000, length: 8192, numberOfChannels: 1, getChannelData: () => pcm },
      cropEndMs: 8192, pixelsPerMs: 1 / 8192,
      clipWidthPx: 1, surfaceLeftPx: 0, surfaceWidthPx: 1, height: 40,
    });
    // The clock is sampled after WAVEFORM_CLOCK_CHECK_WORK, never more than that past the deadline.
    expect(draw({ now: () => clock })).toBe(true);
    expect(reads).toBe(WAVEFORM_CLOCK_CHECK_WORK);
    // A scheduler deadline can shorten the local 1 ms budget as well.
    clock = 0;
    sampleMs = 1 / 1024;
    expect(draw({ now: () => clock, deadline: 0.25 })).toBe(true);
    expect(reads).toBe(2 * WAVEFORM_CLOCK_CHECK_WORK);
    finish(draw);
    expect(reads).toBe(8192);
    expect(ctx.fillRect).toHaveBeenLastCalledWith(0, 11, 1, 22.5);
    expect(ctx.restore).toHaveBeenCalledTimes(ctx.save.mock.calls.length);
  });

  it('does not fabricate a sample for empty or reversed fractional crops', () => {
    const { buffer, pyramid } = source([[1, 1, 1, 1]]);
    const ctx = context();
    for (const [cropStartMs, cropEndMs] of [[1.2, 1.2], [1.3, 1.2]]) {
      const draw = createWaveformDrawJob(ctx, { audioBuffer: buffer, pyramid, cropStartMs, cropEndMs,
        pixelsPerMs: 5, clipWidthPx: 10, surfaceLeftPx: 0, surfaceWidthPx: 10, height: 40 });
      expect(draw()).toBe(false);
    }
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(buffer.getChannelData).not.toHaveBeenCalled();
  });

  it('keeps sample-detail reads within floor(start)/ceil(end) crop metadata, including the final sample', () => {
    const pcm = Float32Array.from([99, -0.25, 0.5, -0.5, 99]);
    const indices = [];
    const borrowed = new Proxy(pcm, { get: (target, key) => {
      if (/^\d+$/.test(String(key))) indices.push(Number(key));
      return target[key];
    } });
    const ctx = context();
    finish(createWaveformDrawJob(ctx, {
      audioBuffer: { sampleRate: 1000, length: 5, numberOfChannels: 1, getChannelData: () => borrowed },
      cropStartMs: 1.2, cropEndMs: 3.1, pixelsPerMs: 5,
      clipWidthPx: 9.5, surfaceLeftPx: 0, surfaceWidthPx: 9.5, height: 40, showSamples: true,
    }));
    expect(indices).toEqual([1, 2, 3]);
  });

  it('uses fixed linear, explicit project normalization, and signed -60 dB scale', () => {
    expect(waveformAmplitude(0.25, 'linear', 0.5)).toBe(0.25);
    expect(waveformAmplitude(-0.25, 'normalized', 0.5)).toBe(-0.5);
    expect(waveformAmplitude(0, 'normalized', 0)).toBe(0);
    expect(waveformAmplitude(0.001, 'db')).toBe(0);
    expect(waveformAmplitude(-0.1, 'db')).toBeCloseTo(-2 / 3);
    expect(waveformAmplitude(NaN, 'db')).toBe(0);
    expect(waveformAmplitude(2)).toBe(1);
  });

  it('preserves signed stereo lanes and excludes cropped-away impulses', () => {
    const { buffer, pyramid, arrays } = source([[9, 0.25, 0.5, 0.25, 9], [-9, -0.25, -0.5, -0.25, -9]]);
    const before = arrays.map((array) => Array.from(array));
    const ctx = context();
    finish(createWaveformDrawJob(ctx, { audioBuffer: buffer, pyramid, cropStartMs: 1, cropEndMs: 4,
      pixelsPerMs: 1 / 3, clipWidthPx: 1, surfaceLeftPx: 0, surfaceWidthPx: 1, height: 80 }));
    const bars = ctx.fillRect.mock.calls.filter((call) => call[3] > 1);
    expect(bars).toHaveLength(2);
    expect(bars[0][1]).toBe(11); // Positive-only signal stays above its zero line at 20.
    expect(bars[1][1]).toBe(64.5); // Negative-only signal stays below its zero line at 60.
    expect(arrays.map((array) => Array.from(array))).toEqual(before);
  });

  it('renders actual connected PCM and optional dots at deep zoom, including non-finite silence', () => {
    const { buffer } = source([[0, 0.5, NaN, -0.5]]);
    const ctx = context();
    finish(createWaveformDrawJob(ctx, { audioBuffer: buffer, cropEndMs: 4, pixelsPerMs: 5,
      clipWidthPx: 20, surfaceLeftPx: 0, surfaceWidthPx: 20, height: 40, showSamples: true, showRms: true }));
    expect(ctx.lineTo.mock.calls).toEqual([[5, 11], [10, 20], [15, 29]]);
    expect(ctx.fillRect.mock.calls.filter((call) => call[2] === 3)).toHaveLength(4);
  });

  it('shows source over-range even when normalization makes the displayed peak smaller', () => {
    const { buffer, pyramid } = source([[2, -2, 0, 0]]);
    const ctx = context();
    const red = [];
    ctx.fillRect.mockImplementation((...args) => { if (ctx.fillStyle === '#ef4444') red.push(args); });
    finish(createWaveformDrawJob(ctx, { audioBuffer: buffer, pyramid, pixelsPerMs: 0.25,
      clipWidthPx: 1, surfaceLeftPx: 0, surfaceWidthPx: 1, height: 40,
      displayMode: 'normalized', globalPeakAmplitude: 4, showClipping: true, showRms: true }));
    expect(red).toEqual([[0, 0, 1, 2], [0, 38, 1, 2]]);
    expect(ctx.fillRect.mock.calls.some((call) => call[1] === 11 && call[3] === 18)).toBe(true);
  });

  it('borrows only the visible sample window, not a full source scan or copy', () => {
    let reads = 0;
    const pcm = new Proxy({}, { get: (_, key) => { if (/^\d+$/.test(String(key))) { reads += 1; return 0.5; } throw new Error('No PCM copying'); } });
    const audioBuffer = { sampleRate: 1000, length: 1e12, numberOfChannels: 1, getChannelData: () => pcm };
    const ctx = context();
    finish(createWaveformDrawJob(ctx, { audioBuffer, cropEndMs: 1e12, pixelsPerMs: 4,
      clipWidthPx: 4e12, surfaceLeftPx: 4e9, surfaceWidthPx: 100, height: 40 }));
    // 25 visible samples, plus the 2 px reach and one neighbour on each side.
    expect(reads).toBeLessThanOrEqual(29);
  });
});
