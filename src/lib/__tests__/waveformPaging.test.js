import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWaveformService } from '../waveformService';
import { createWaveformDrawJob, createWaveformRangeQuery } from '../waveformRenderer';
import { estimateWaveformBytes } from '../waveformData';
import { buildPyramid, generatedBuffer, referenceRange } from './waveformFixtures';

const services = [];
const PAGE = 1024;
function makeService(options = {}) {
  const service = createWaveformService({
    workerFactory: () => undefined, persistence: null, yieldControl: async () => {},
    maxResidentBytes: 1 << 20, maxSourceBytes: 4096, maxDetailBytes: 64 * 1024, detailPageSamples: PAGE, ...options,
  });
  services.push(service);
  return service;
}
async function ready(service, id, buffer) {
  await vi.waitFor(() => expect(service.getSource(id, buffer)?.status).toBe('ready'), { interval: 5 });
  return service.getSource(id, buffer);
}
async function pagesIdle(service) {
  await vi.waitFor(() => expect(service.getStats().detailQueueDepth).toBe(0), { interval: 5 });
  await new Promise((resolve) => setTimeout(resolve, 0));
}
function run(query, rawLimit) {
  let step;
  let raw = 0;
  for (let i = 0; i < 10000; i += 1) {
    step = query(rawLimit);
    raw += step.rawSamples;
    expect(step.rawSamples).toBeLessThanOrEqual(rawLimit ?? 256);
    if (step.done) return { ...step.result, raw };
  }
  throw new Error('Query did not finish');
}
function slice(buffer, start, end) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice(start, end));
  return { sampleRate: buffer.sampleRate, numberOfChannels: channels.length, length: end - start, getChannelData: (c) => channels[c] };
}

afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
});

describe('paged long-source detail', () => {
  it('caps the per-source overview and pages exact base-128 detail for a requested range', async () => {
    const service = makeService();
    const buffer = generatedBuffer(10000, 2);
    service.ensureSource('long', buffer);
    const { pyramid } = await ready(service, 'long', buffer);
    expect(pyramid.baseBlockSize).toBe(512);
    expect(service.getStats().residentBytes).toBeLessThanOrEqual(4096);
    const lookup = service.requestDetail('long', buffer, 0, 10000);
    expect(lookup).toBeTypeOf('function');
    await pagesIdle(service);
    expect(service.getStats()).toMatchObject({ detailPages: 10, detailPagesBuilt: 10, detailSamplesScanned: 20000 });
    for (const sample of [0, 1023, 1024, 9999]) {
      const page = lookup(sample);
      const end = Math.min(page.start + PAGE, 10000);
      expect(page.start).toBe(Math.floor(sample / PAGE) * PAGE);
      expect(page.pyramid).toEqual(buildPyramid(slice(buffer, page.start, end)));
    }
    let seed = 7;
    const random = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 2 ** 32; };
    const ranges = [[0, 10000], [1, 9999], [127, 129], [1023.5, 1024.5], [500, 4100], [9000.2, 10000], [9215, 9300]];
    for (let i = 0; i < 40; i += 1) {
      const start = random() * 10000;
      ranges.push([start, start + random() * (10000 - start)]);
    }
    for (const [start, end] of ranges) {
      for (const channel of [0, 1]) {
        const paged = run(createWaveformRangeQuery(pyramid, channel, start, end, buffer, lookup));
        const unpaged = run(createWaveformRangeQuery(pyramid, channel, start, end, buffer));
        const reference = referenceRange(buffer, channel, start, end);
        for (const result of [paged, unpaged]) {
          expect(result.min).toBe(reference.min);
          expect(result.max).toBe(reference.max);
          expect(result.count).toBe(reference.count);
          expect(result.sumSquares).toBeCloseTo(reference.sumSquares, 6);
        }
        expect(paged.raw).toBeLessThanOrEqual(2 * 127);
        expect(paged.raw).toBeLessThanOrEqual(unpaged.raw);
      }
    }
    expect(run(createWaveformRangeQuery(pyramid, 0, 3, 4090, buffer, lookup), 1).raw).toBeLessThanOrEqual(2 * 127);
  });

  it('keeps detail within its byte budget, evicting least-recently requested pages first', async () => {
    const pageBytes = estimateWaveformBytes(PAGE, 2);
    const service = makeService({ maxDetailBytes: 4 * pageBytes + 100 });
    const buffer = generatedBuffer(10000, 2);
    service.ensureSource('long', buffer);
    await ready(service, 'long', buffer);
    expect(service.requestDetail('long', buffer, 0, 10000)).toBeUndefined();
    expect(service.getStats().detailRequestsDeclined).toBe(1);
    const first = service.requestDetail('long', buffer, 0, 2048);
    await pagesIdle(service);
    const second = service.requestDetail('long', buffer, 4096, 6144);
    await pagesIdle(service);
    expect(service.getStats()).toMatchObject({ detailPages: 4, detailBytes: 4 * pageBytes });
    service.requestDetail('long', buffer, 0, 2048);
    const third = service.requestDetail('long', buffer, 8192, 10000);
    await pagesIdle(service);
    const stats = service.getStats();
    expect(stats.detailBytes).toBeLessThanOrEqual(stats.maxDetailBytes);
    expect(stats.detailPagesEvicted).toBe(2);
    expect([first(0), first(1024), third(8192), third(9999)].every(Boolean)).toBe(true);
    expect(second(4096) ?? second(5120)).toBeUndefined();
    expect(stats.accountedBytes).toBe(stats.residentBytes + stats.detailBytes);
  });

  it('never pages fine summaries, drops pages with their source, and yields them to new summaries', async () => {
    const service = makeService({ maxResidentBytes: 11000, maxDetailBytes: 4096 * 2 });
    const short = generatedBuffer(1000, 1);
    service.ensureSource('short', short);
    expect((await ready(service, 'short', short)).pyramid.baseBlockSize).toBe(128);
    expect(service.requestDetail('short', short, 0, 1000)).toBeUndefined();
    const buffer = generatedBuffer(10000, 2);
    service.ensureSource('long', buffer);
    await ready(service, 'long', buffer);
    const lookup = service.requestDetail('long', buffer, 0, 2048);
    await pagesIdle(service);
    expect(service.getStats().detailPages).toBe(2);
    // Another source's admission reclaims page bytes before evicting any summary.
    const other = generatedBuffer(10000, 2);
    service.ensureSource('other', other);
    await ready(service, 'other', other);
    expect(service.getStats().detailPages).toBeLessThan(2);
    expect(service.getSource('short', short).status).toBe('ready');
    service.requestDetail('long', buffer, 4096, 6144);
    service.releaseSource('long', buffer);
    await pagesIdle(service);
    expect(service.getStats()).toMatchObject({ detailPages: 0, detailBytes: 0 });
    expect(lookup(0)).toBeUndefined();
  });

  it('cancels an in-progress page build without leaking its reservation', async () => {
    let gated = false;
    const waiters = [];
    const service = makeService({
      yieldControl: () => gated ? new Promise((resolve) => waiters.push(resolve)) : Promise.resolve(),
    });
    const buffer = generatedBuffer(10000, 2);
    service.ensureSource('long', buffer);
    await ready(service, 'long', buffer);
    gated = true;
    service.requestDetail('long', buffer, 0, 2048);
    expect(service.getStats().detailBytes).toBe(estimateWaveformBytes(PAGE, 2));
    service.releaseSource('long', buffer);
    gated = false;
    waiters.splice(0).forEach((resolve) => resolve());
    await pagesIdle(service);
    expect(service.getStats()).toMatchObject({ detailBytes: 0, detailPages: 0, detailPagesBuilt: 0, detailErrors: 0 });
  });

  it('admits a very long source at the raw-edge bound even when that exceeds the per-source share', async () => {
    const service = makeService({ maxSourceBytes: 1024, maxBaseBlockSize: 256 });
    const buffer = generatedBuffer(10000, 2);
    service.ensureSource('long', buffer);
    expect((await ready(service, 'long', buffer)).pyramid.baseBlockSize).toBe(256);
  });

  it('draws identical pixels with fewer PCM reads once visible pages exist', async () => {
    const service = makeService({ maxSourceBytes: 8192, maxDetailBytes: 1 << 18 });
    const buffer = generatedBuffer(100000, 1, 1000);
    service.ensureSource('long', buffer);
    const { pyramid } = await ready(service, 'long', buffer);
    expect(pyramid.baseBlockSize).toBe(512);
    const draw = (requestDetail) => {
      let reads = 0;
      const pcm = buffer.getChannelData(0);
      const borrowed = new Proxy(pcm, { get: (target, key) => {
        if (/^\d+$/.test(String(key))) reads += 1;
        const value = target[key];
        return typeof value === 'function' ? value.bind(target) : value;
      } });
      const calls = [];
      const context = Object.fromEntries(['save', 'restore', 'beginPath', 'rect', 'clip', 'moveTo', 'lineTo', 'stroke']
        .map((name) => [name, () => {}]));
      context.fillRect = (...args) => calls.push(args);
      const width = (99999 - 1.3) / 1000;
      const job = createWaveformDrawJob(context, {
        audioBuffer: { ...buffer, getChannelData: () => borrowed }, pyramid, cropStartMs: 1.3, cropEndMs: 99999,
        pixelsPerMs: 1 / 1000, clipWidthPx: width, surfaceLeftPx: 0, surfaceWidthPx: width, height: 40, requestDetail,
      });
      for (let i = 0; job(); i += 1) if (i > 10000) throw new Error('Draw did not finish');
      return { calls, reads };
    };
    const requestDetail = vi.fn((start, end) => service.requestDetail('long', buffer, start, end));
    const cold = draw(requestDetail);
    expect(requestDetail).toHaveBeenCalledOnce();
    expect(requestDetail.mock.calls[0][0]).toBe(1);
    expect(requestDetail.mock.calls[0][1]).toBeGreaterThanOrEqual(99998);
    await pagesIdle(service);
    const warm = draw(requestDetail);
    const unpaged = draw(undefined);
    expect(warm.calls).toEqual(unpaged.calls);
    expect(cold.calls).toEqual(unpaged.calls);
    expect(warm.reads).toBeLessThan(unpaged.reads / 3);
  });
});
