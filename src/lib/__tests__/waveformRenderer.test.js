import { describe, expect, it, vi } from 'vitest';
import { createWaveformBuilder, queryWaveformRange } from '../waveformData';
import { MediaBufferCache, rememberMediaRevision } from '../mediaBufferCache';
import { createWaveformService } from '../waveformService';
import {
  createWaveformDrawJob, createWaveformRangeQuery, createWaveformRasterBudget, createWaveformSourceObserver,
  getWaveformWindow, prepareWaveformCanvas, waveformAmplitude, waveformRasterBudget,
  WAVEFORM_RAW_SAMPLES_PER_SLICE, WAVEFORM_DRAW_RAW_SAMPLES_PER_SLICE, WAVEFORM_RASTER_BYTES,
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

  it('batches exact PCM queries with a hard draw ceiling even when the clock does not advance', () => {
    let reads = 0;
    const pcm = new Proxy({}, { get: () => { reads += 1; return reads === 10000 ? -0.75 : 0.5; } });
    const ctx = context();
    const draw = createWaveformDrawJob(ctx, {
      audioBuffer: { sampleRate: 1000, length: 20000, numberOfChannels: 1, getChannelData: () => pcm },
      cropEndMs: 20000, pixelsPerMs: 1 / 20000,
      clipWidthPx: 1, surfaceLeftPx: 0, surfaceWidthPx: 1, height: 40,
    });
    expect(draw({ now: () => 0 })).toBe(true);
    expect(reads).toBe(WAVEFORM_DRAW_RAW_SAMPLES_PER_SLICE);
    expect(draw({ now: () => 0 })).toBe(true);
    expect(reads).toBe(2 * WAVEFORM_DRAW_RAW_SAMPLES_PER_SLICE);
    expect(draw({ now: () => 0 })).toBe(false);
    expect(reads).toBe(20000);
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
      audioBuffer: { sampleRate: 1000, length: 1024, numberOfChannels: 1, getChannelData: () => pcm },
      cropEndMs: 1024, pixelsPerMs: 1 / 1024,
      clipWidthPx: 1, surfaceLeftPx: 0, surfaceWidthPx: 1, height: 40,
    });
    expect(draw({ now: () => clock })).toBe(true);
    expect(reads).toBe(WAVEFORM_RAW_SAMPLES_PER_SLICE);
    // A scheduler deadline can shorten the local 1 ms budget as well.
    clock = 0;
    sampleMs = 1 / 1024;
    expect(draw({ now: () => clock, deadline: 0.25 })).toBe(true);
    expect(reads).toBe(2 * WAVEFORM_RAW_SAMPLES_PER_SLICE);
    finish(draw);
    expect(reads).toBe(1024);
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
    expect(reads).toBeLessThanOrEqual(27);
  });
});
