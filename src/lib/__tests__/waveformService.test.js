import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createWaveformService } from '../waveformService';
import { createWaveformWorkerHandler } from '../waveform.worker';
import { createWaveformPersistence } from '../waveformPersistence';
import { WAVEFORM_CHUNK_SAMPLES } from '../waveformData';
import { audioBuffer, buildPyramid, generatedBuffer } from './waveformFixtures';

const services = [];
const makeService = (options = {}) => {
  const service = createWaveformService({ workerFactory: () => undefined, persistence: null, yieldControl: async () => {}, ...options });
  services.push(service);
  return service;
};
async function settled(service, id, buffer) {
  await vi.waitFor(() => expect(service.getSource(id, buffer)?.status).toMatch(/ready|error/), { interval: 5 });
  return service.getSource(id, buffer);
}
async function idle(service) {
  await vi.waitFor(() => expect(service.getStats().activeJobs).toBe(0), { interval: 5 });
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

class ProtocolWorker {
  constructor() {
    this.terminated = false;
    this.transfers = [];
    this.handler = createWaveformWorkerHandler((data, transfers = []) => {
      const copied = structuredClone(data, { transfer: transfers });
      if (!this.terminated) this.onmessage?.({ data: copied });
    }, { subtle: webcrypto.subtle });
  }
  postMessage(data, transfers = []) {
    this.transfers.push(...transfers);
    const copied = structuredClone(data, { transfer: transfers });
    void this.handler({ data: copied });
  }
  terminate() { this.terminated = true; }
}

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('shared source lifecycle', () => {
  it('is nonblocking/idempotent, caches source stats, and deduplicates split clips and alias IDs', async () => {
    const service = makeService();
    const buffer = generatedBuffer();
    const getChannelData = vi.spyOn(buffer, 'getChannelData');
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);
    expect(service.getSource('blob', buffer)).toBeUndefined();
    const loading = service.ensureSource('blob', buffer);
    expect(loading.status).toBe('loading');
    expect(getChannelData).not.toHaveBeenCalled();
    for (let i = 0; i < 30; i += 1) expect(service.ensureSource('blob', buffer)).toBe(loading);
    service.ensureSource('alias', buffer);
    const ready = await settled(service, 'blob', buffer);
    expect(ready.pyramid).toEqual(buildPyramid(buffer));
    expect(service.getSource('alias', buffer)).toBe(ready);
    const scans = getChannelData.mock.calls.length;
    for (let i = 0; i < 30; i += 1) {
      expect(service.ensureSource('blob', buffer)).toBe(ready);
      expect(service.getSourceStats('blob', buffer)).toBe(ready.stats);
    }
    expect(getChannelData).toHaveBeenCalledTimes(scans);
    expect(ready.stats.sourcePeak).toBe(ready.pyramid.sourcePeak);
    expect(service.getStats()).toMatchObject({ jobsStarted: 1, jobsCompleted: 1, sources: 1 });
    expect(listener.mock.calls.map(([event]) => event.type)).toEqual(['loading', 'ready']);
    unsubscribe();
    service.releaseSource('blob', buffer);
    expect(service.getSource('alias', buffer)).toBe(ready);
    service.releaseSource('alias', buffer);
    expect(service.getStats()).toMatchObject({ sources: 0, residentBytes: 0, listeners: 0 });
  });

  it('supports missing blob IDs through weak decoded-object identities', async () => {
    const service = makeService();
    const buffer = generatedBuffer();
    service.ensureSource(undefined, buffer);
    expect((await settled(service, undefined, buffer)).status).toBe('ready');
    expect(service.getSource(undefined, generatedBuffer())).toBeUndefined();
    service.releaseSource(undefined, buffer);
    expect(service.getSource(undefined, buffer)).toBeUndefined();
  });

  it('invalidates same-ID object replacement, cancels stale extraction and ignores stale release calls', async () => {
    const gate = deferred();
    let paused = false;
    const service = makeService({ yieldControl: async () => { if (!paused) { paused = true; await gate.promise; } } });
    const old = generatedBuffer(40000);
    const replacement = audioBuffer([new Float32Array(40000).fill(0.75)]);
    const events = [];
    service.subscribe((event) => events.push(event));
    service.ensureSource('same', old);
    await vi.waitFor(() => expect(paused).toBe(true), { interval: 5 });
    service.ensureSource('same', replacement);
    expect(service.getSource('same', old)).toBeUndefined();
    service.releaseSource('same', old);
    expect(service.getSource('same', replacement).status).toBe('loading');
    gate.resolve();
    const ready = await settled(service, 'same', replacement);
    expect(ready.stats.sourcePeak).toBe(0.75);
    expect(events.filter((event) => event.type === 'ready')).toHaveLength(1);
    expect(service.getStats()).toMatchObject({ jobsCancelled: 1, jobsCompleted: 1 });
  });

  it('cancels queued work, bounds source metadata, and releases all retained service resources', async () => {
    const gate = deferred();
    const service = makeService({ yieldControl: () => gate.promise, maxPendingSources: 2, maxSources: 3 });
    const a = generatedBuffer();
    const b = generatedBuffer();
    const c = generatedBuffer();
    service.ensureSource('a', a);
    await vi.waitFor(() => expect(service.getStats().activeJobs).toBe(1), { interval: 5 });
    service.ensureSource('b', b);
    service.ensureSource('c', c);
    expect(service.getSource('b', b).status).toBe('loading');
    expect(service.getSource('c', c).status).toBe('loading');
    expect(service.getStats()).toMatchObject({ sources: 3, queueDepth: 1, deferredSources: 1, evictions: 0 });
    service.clear();
    gate.resolve();
    await idle(service);
    expect(service.getStats()).toMatchObject({ sources: 0, residentBytes: 0, activeSummaryBytes: 0, stagingBytes: 0, jobsCompleted: 0 });
  });

  it('evicts by accounted LRU, reloads evicted sources, and keeps active+resident summaries bounded', async () => {
    let service;
    const seenBytes = [];
    service = makeService({ maxResidentBytes: 2048, yieldControl: async () => {
      const stats = service.getStats();
      seenBytes.push(stats.residentBytes + stats.activeSummaryBytes);
    } });
    const a = generatedBuffer(1000, 1);
    const b = generatedBuffer(1000, 1);
    const c = generatedBuffer(1000, 1);
    service.ensureSource('a', a);
    await settled(service, 'a', a);
    service.ensureSource('b', b);
    await settled(service, 'b', b);
    service.getSource('a', a); // a is more recent than b
    service.ensureSource('c', c);
    await settled(service, 'c', c);
    expect(service.getSource('a', a)?.status).toBe('ready');
    expect(service.getStats().residentBytes).toBeLessThanOrEqual(2048);
    expect(Math.max(...seenBytes)).toBeLessThanOrEqual(2048);
    // Demand alone reloads an evicted summary; no renderer re-ensure is required.
    expect(service.getSource('b', b)?.status).toBe('loading');
    expect((await settled(service, 'b', b)).status).toBe('ready');
    expect(service.getStats().jobsCompleted).toBe(4);
  });

  it('prioritizes visible queued sources without duplicating or restarting the active job', async () => {
    const gate = deferred();
    let firstYield = true;
    const service = makeService({ yieldControl: async () => {
      if (firstYield) { firstYield = false; await gate.promise; }
    } });
    const order = [];
    service.subscribe((event) => { if (event.type === 'ready') order.push(event.blobIds[0]); });
    const a = generatedBuffer(30, 1);
    const b = generatedBuffer(30, 1);
    const c = generatedBuffer(30, 1);
    service.ensureSource('active', a);
    await vi.waitFor(() => expect(firstYield).toBe(false), { interval: 5 });
    service.ensureSource('background', b);
    service.ensureSource('visible', c, { priority: 10 });
    service.ensureSource('visible', c, { priority: 20 });
    gate.resolve();
    await settled(service, 'background', b);
    expect(order).toEqual(['active', 'visible', 'background']);
    expect(service.getStats().jobsStarted).toBe(3);
  });

  it('exposes actionable errors, permits explicit retry, and isolates throwing subscribers', async () => {
    const service = makeService();
    service.subscribe(() => { throw new Error('view error'); });
    const buffer = generatedBuffer();
    const original = buffer.getChannelData;
    buffer.getChannelData = () => { throw new Error('PCM unavailable'); };
    service.ensureSource('a', buffer);
    expect((await settled(service, 'a', buffer)).error.message).toBe('PCM unavailable');
    expect(service.getStats()).toMatchObject({ workerFailures: 0, fallbackJobs: 1 });
    buffer.getChannelData = original;
    service.retrySource('a', buffer);
    expect((await settled(service, 'a', buffer)).status).toBe('ready');
    service.dispose();
    expect(service.ensureSource('a', buffer)).toBeUndefined();
  });
});

describe('worker extraction and bounded cooperative fallback', () => {
  it('never detaches playback PCM and produces identical worker/fallback data', async () => {
    const workers = [];
    const workerService = makeService({ workerFactory: () => { const worker = new ProtocolWorker(); workers.push(worker); return worker; } });
    const fallbackService = makeService();
    const buffer = generatedBuffer(33001);
    buffer.getChannelData(0)[127] = NaN;
    buffer.getChannelData(0)[128] = Infinity;
    buffer.getChannelData(1)[33000] = -14;
    const original = buffer.getChannelData(0).slice();
    workerService.ensureSource('source', buffer);
    fallbackService.ensureSource('source', buffer);
    const fromWorker = await settled(workerService, 'source', buffer);
    const fromFallback = await settled(fallbackService, 'source', buffer);
    expect(fromWorker.pyramid).toEqual(structuredClone(fromFallback.pyramid));
    expect(fromWorker.stats.fingerprint).toBe(fromFallback.stats.fingerprint);
    expect(buffer.getChannelData(0)).toEqual(original);
    expect(buffer.getChannelData(0).buffer.byteLength).toBe(buffer.length * 4);
    expect(workers[0].terminated).toBe(true);
    expect(workers[0].transfers).not.toContain(buffer.getChannelData(0).buffer);
    expect(workerService.getStats()).toMatchObject({ fallbackJobs: 0, workerFailures: 0, peakStagingBytes: WAVEFORM_CHUNK_SAMPLES * 4 });
    expect(fallbackService.getStats().chunksCopied).toBe(6);
  });

  it.each(['construct', 'post', 'error', 'messageerror', 'timeout'])('recovers from worker %s failure', async (failure) => {
    const terminate = vi.fn();
    const workerFactory = () => {
      if (failure === 'construct') throw new Error('CSP blocked worker');
      return {
        terminate,
        postMessage() {
          if (failure === 'post') throw new Error('clone error');
          if (failure === 'error') queueMicrotask(() => this.onerror?.({ message: 'module load failed' }));
          if (failure === 'messageerror') queueMicrotask(() => this.onmessageerror?.());
        },
      };
    };
    const service = makeService({ workerFactory, workerTimeoutMs: 5 });
    const buffer = generatedBuffer(300);
    service.ensureSource('a', buffer);
    expect((await settled(service, 'a', buffer)).pyramid).toEqual(buildPyramid(buffer));
    expect(service.getStats()).toMatchObject({ workerFailures: 1, fallbackJobs: 1 });
    if (failure !== 'construct') expect(terminate).toHaveBeenCalledOnce();
  });

  it('rejects malformed worker results and rebuilds cooperatively rather than publishing them', async () => {
    const worker = new ProtocolWorker();
    const originalHandler = worker.handler;
    worker.handler = async (event) => {
      if (event.data.type === 'finish') {
        worker.onmessage({ data: { type: 'result', jobId: event.data.jobId, requestId: event.data.requestId, pyramid: {} } });
      } else await originalHandler(event);
    };
    const service = makeService({ workerFactory: () => worker });
    const buffer = generatedBuffer(300);
    service.ensureSource('a', buffer);
    expect((await settled(service, 'a', buffer)).pyramid).toEqual(buildPyramid(buffer));
    expect(service.getStats()).toMatchObject({ workerFailures: 1, fallbackJobs: 1 });
  });

  it('terminates a blocked worker immediately on release, without stale publication', async () => {
    const worker = { postMessage: vi.fn(), terminate: vi.fn() };
    const service = makeService({ workerFactory: () => worker });
    const listener = vi.fn();
    service.subscribe(listener);
    const buffer = generatedBuffer();
    service.ensureSource('a', buffer);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce(), { interval: 5 });
    service.releaseSource('a', buffer);
    expect(worker.terminate).toHaveBeenCalledOnce();
    await idle(service);
    expect(listener.mock.calls.map(([event]) => event.type)).toEqual(['loading', 'removed']);
    expect(service.getStats()).toMatchObject({ jobsCompleted: 0, sources: 0 });
  });

  it('preserves fallback summaries when WebCrypto rejects', async () => {
    vi.stubGlobal('crypto', { subtle: { digest: vi.fn().mockRejectedValue(new Error('Crypto denied')) } });
    const service = makeService();
    const buffer = generatedBuffer(300);
    service.ensureSource('a', buffer);
    const ready = await settled(service, 'a', buffer);
    expect(ready.status).toBe('ready');
    expect(ready.stats.fingerprint).toBeUndefined();
    expect(ready.pyramid).toEqual(buildPyramid(buffer));
  });

  it('yields once per bounded chunk without WebCrypto and does not attempt persistence with weak identity', async () => {
    vi.stubGlobal('crypto', {});
    const yieldControl = vi.fn(async () => {});
    const persistence = { load: vi.fn(), save: vi.fn() };
    const service = makeService({ persistence, yieldControl });
    const buffer = generatedBuffer(WAVEFORM_CHUNK_SAMPLES * 2 + 3, 1);
    service.ensureSource('a', buffer);
    const ready = await settled(service, 'a', buffer);
    expect(ready.stats.fingerprint).toBeUndefined();
    expect(yieldControl).toHaveBeenCalledTimes(3);
    expect(persistence.load).not.toHaveBeenCalled();
    expect(persistence.save).not.toHaveBeenCalled();
  });
});

describe('verified persistence through the source service', () => {
  it('never trusts unversioned same-ID same-shaped objects and preserves content hashing', async () => {
    const rows = new Map();
    const storage = {
      get: async (key) => rows.get(key),
      put: async (row) => { rows.set(row.key, structuredClone(row)); return true; },
      touch: async () => {}, delete: async (key) => rows.delete(key),
    };
    const persistence = createWaveformPersistence({ storage, yieldControl: async () => {} });
    const service = makeService({ persistence });
    const original = generatedBuffer(17000, 1);
    service.ensureSource('same', original);
    const first = await settled(service, 'same', original);
    await idle(service);
    const changed = generatedBuffer(17000, 1);
    changed.getChannelData(0)[16001] = 19;
    service.ensureSource('same', changed);
    const second = await settled(service, 'same', changed);
    await idle(service);
    expect(second.stats.sourcePeak).toBe(19);
    expect(first.stats.fingerprint).not.toBe(second.stats.fingerprint);
    expect(persistence.getStats().hits).toBe(0);
    service.clear();
    const decodedAgain = generatedBuffer(17000, 1);
    service.ensureSource('same', decodedAgain);
    const third = await settled(service, 'same', decodedAgain);
    await idle(service);
    expect(third.pyramid).toEqual(first.pyramid);
    expect(persistence.getStats().hits).toBe(0);
    expect(service.getStats().samplesScanned).toBe(17000 * 3);
  });

  it('keeps usable summaries when cache reads and writes reject', async () => {
    const persistence = { load: vi.fn().mockRejectedValue(new Error('blocked')), save: vi.fn().mockRejectedValue(new Error('full')) };
    const service = makeService({ persistence });
    const buffer = generatedBuffer();
    service.ensureSource('a', buffer);
    expect((await settled(service, 'a', buffer)).status).toBe('ready');
    await idle(service);
    expect(service.getStats().errors).toBe(0);
    expect(persistence.save).toHaveBeenCalledOnce();
  });
});
